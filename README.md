# Werewolf

Mobile Werewolf for friends. Create an account-free room, invite friends, and play a 12-player preset or a 3–12-player custom lineup from the first night through rematch. Each phone receives its own roles and actions. Players can reconnect to their seat and view completed ballots in the match history. See [requirements](REQUIREMENTS.md) for the lineups and rules.

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
