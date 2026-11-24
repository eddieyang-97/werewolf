import { Pool } from 'pg';

const table = 'werewolf_rooms';
const purge = `DELETE FROM ${table} WHERE expires_at <= $1`;

export async function openPostgresStore(connectionString) {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  pool.on('error', error => console.error('Postgres connection failed:', error.code ?? error.name));
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        code TEXT PRIMARY KEY,
        creation_key TEXT NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS werewolf_room_expiry ON ${table}(expires_at);
    `);
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    async create(candidate, key, now) {
      await pool.query(purge, [now]);
      const inserted = await pool.query(`
        INSERT INTO ${table} (code, creation_key, expires_at, data)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING data
      `, [candidate.code, key, candidate.expiresAt, candidate]);
      if (inserted.rowCount) return inserted.rows[0].data;

      const existing = await pool.query(
        `SELECT data FROM ${table} WHERE creation_key = $1 AND expires_at > $2`, [key, now],
      );
      return existing.rows[0]?.data ?? null;
    },

    async room(code, now, action) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT data FROM ${table} WHERE code = $1 AND expires_at > $2 FOR UPDATE`, [code, now],
        );
        const room = rows[0]?.data ?? null;
        const { value, changed } = action(room);
        if (room && changed) {
          await client.query(
            `UPDATE ${table} SET expires_at = $2, data = $3 WHERE code = $1`, [code, room.expiresAt, room],
          );
        }
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    purge(now) { return pool.query(purge, [now]); },
    ready() { return pool.query('SELECT 1'); },
    close() { return pool.end(); },
  };
}
