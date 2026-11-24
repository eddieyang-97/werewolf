# Werewolf

Mobile Werewolf for friends. M1 supports account-free rooms, invite links, seating, private role distribution, and reconnect. See [requirements](REQUIREMENTS.md) for the three board presets and milestone scope.

## Local development

Use Node.js 24.

```sh
npm ci
npm test
npm start
```

Open `http://localhost:3000`. The server uses `.data/rooms.sqlite` by default. Set `ROOM_DB_PATH` for a different SQLite file, or `DATABASE_URL` for PostgreSQL.

## Render playtest

The Blueprint runs a free web service backed by a free PostgreSQL database on Render's private network. The database keeps rooms available across web-service restarts. Render's free database expires 30 days after creation.
