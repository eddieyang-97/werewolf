# Werewolf

Mobile Werewolf for friends. M1 supports account-free rooms, invite links, seating, private role distribution, and reconnect. See [requirements](REQUIREMENTS.md) for the three board presets and milestone scope.

## Local development

Use Node.js 24.

```sh
npm ci
npm test
npm start
```

Open `http://localhost:3000`. The server uses `.data/rooms.sqlite` by default. Set `ROOM_DB_PATH` to use a different database file. On Render the path must point to durable storage.
