import { openStore } from './store.js';
import { openPostgresStore } from './postgres-store.js';
import { createApp } from './http.js';

const { PORT = '3000', DATABASE_URL, ROOM_DB_PATH, RENDER, RENDER_GIT_COMMIT } = process.env;
if (RENDER === 'true' && !DATABASE_URL && !ROOM_DB_PATH) {
  throw new Error('Configure durable room storage on Render');
}
const store = DATABASE_URL ? await openPostgresStore(DATABASE_URL) : openStore(ROOM_DB_PATH ?? '.data/rooms.sqlite');
await store.purge(Date.now());
const sweep = setInterval(async () => {
  try {
    await store.purge(Date.now());
  } catch (error) {
    console.error('Room expiry sweep failed:', error.code ?? error.name);
  }
}, 60_000);
const app = createApp(store, { revision: RENDER_GIT_COMMIT });
app.listen(Number(PORT), '0.0.0.0', () => console.log(`Werewolf listening on port ${PORT}`));

function stop() {
  clearInterval(sweep);
  app.close(() => store.close());
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
