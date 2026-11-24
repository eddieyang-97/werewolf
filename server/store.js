import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      creation_key TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS room_expiry ON rooms(expires_at);
  `);
  const select = db.prepare('SELECT data FROM rooms WHERE code = ? AND expires_at > ?');
  const selectCreation = db.prepare('SELECT data FROM rooms WHERE creation_key = ? AND expires_at > ?');
  const insert = db.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
  const update = db.prepare('UPDATE rooms SET expires_at = ?, data = ? WHERE code = ?');
  const purge = db.prepare('DELETE FROM rooms WHERE expires_at <= ?');

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    create(candidate, key, now) {
      return transaction(() => {
        purge.run(now);
        const existing = selectCreation.get(key, now);
        if (existing) return JSON.parse(existing.data);
        const result = insert.run(candidate.code, key, candidate.expiresAt, JSON.stringify(candidate));
        return result.changes ? candidate : null;
      });
    },
    room(code, now, action) {
      return transaction(() => {
        const raw = select.get(code, now);
        const room = raw ? JSON.parse(raw.data) : null;
        const { value, changed } = action(room);
        if (room && changed) update.run(room.expiresAt, JSON.stringify(room), code);
        return value;
      });
    },
    purge(now) { purge.run(now); },
    close() { db.close(); },
  };
}
