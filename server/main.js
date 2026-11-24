import { openStore } from './store.js';
import { createApp } from './http.js';

const { PORT = '3000', ROOM_DB_PATH, RENDER, RENDER_GIT_COMMIT } = process.env;
if (RENDER === 'true' && !ROOM_DB_PATH) {
  throw new Error('ROOM_DB_PATH must point to persistent storage on Render');
}
const store = openStore(ROOM_DB_PATH ?? '.data/rooms.sqlite');
store.purge(Date.now());
const sweep = setInterval(() => store.purge(Date.now()), 60_000);
const app = createApp(store, { revision: RENDER_GIT_COMMIT });
app.listen(Number(PORT), '0.0.0.0', () => console.log(`Werewolf listening on port ${PORT}`));

function stop() {
  clearInterval(sweep);
  app.close(() => store.close());
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
