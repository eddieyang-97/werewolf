# Werewolf

Mobile Werewolf for friends. Create an account-free room, invite friends, and play a 12-player preset or a custom lineup of at least three players from the first night through rematch. Each phone receives its own roles and actions. Players can reconnect to their seat and view completed ballots in the match history. See [requirements](REQUIREMENTS.md) for the lineups and rules.

## Local development

Use Node.js 24.

```sh
npm ci
npm test
npm start
```

Open `http://localhost:3000`. The server uses `.data/rooms.sqlite` by default. Set `ROOM_DB_PATH` for a different SQLite file, or `DATABASE_URL` for PostgreSQL.

### Playtest on your own

Create a room and tap **用机器人填满空位**. To add just one bot, open **房主操作 → 添加机器人** and choose an empty seat. You can remove individual bots there before dealing.

Tap **发放身份**, view your own role and confirm **准备就绪**, then tap **开始游戏**. Bots automatically ready up, choose legal actions and votes at random, and finish their speaking turns. You play your own seat and advance the game with the usual host controls. **再来一局** keeps the bots seated for the next deal.

## Tests and merges

`npm test` runs the rule and SQLite HTTP tests. To iterate on the room tests, run `node --test test/m1.test.js`. Independent cases run in parallel with ephemeral HTTP ports and separate stores.

To also run the shared deal, concurrency, restart, custom lineup, and spectator handoff scenarios against PostgreSQL, start a disposable local database. The test user needs permission to create schemas. Each scenario creates and removes its own schema, including when multiple suites run against the same test database.

```sh
docker run --rm -d --name werewolf-test-postgres -p 127.0.0.1:55432:5432 -e POSTGRES_USER=werewolf -e POSTGRES_PASSWORD=werewolf_test -e POSTGRES_DB=werewolf_test postgres:18
docker exec werewolf-test-postgres pg_isready -h 127.0.0.1 -U werewolf -d werewolf_test
# Once PostgreSQL is accepting connections:
WEREWOLF_TEST_POSTGRES_URL=postgresql://werewolf:werewolf_test@127.0.0.1:55432/werewolf_test npm test
docker stop werewolf-test-postgres
```

In PowerShell, set `$env:WEREWOLF_TEST_POSTGRES_URL` to the same URL before running `npm test`. The tests use this dedicated loopback URL and ignore the app's `DATABASE_URL`.

Run `npm run test:browser` with Google Chrome installed to test remembered profiles and the solo bot playtest flow against a local SQLite server.

The GitHub Actions **Tests** check runs both storage backends and the Chrome regression on pull requests to `main` and pushes to `main`. GitHub currently requires Pro or public visibility to enforce status checks on this repository. Wait for **Tests** to pass on the latest PR revision before merging. If branch protection becomes available, require this check on `main`.

For client/API changes, smoke-test the affected browser flow. For a milestone or material deployment, verify the live revision and database readiness at `/healthz`, then exercise the relevant [acceptance criteria](REQUIREMENTS.md) on real phones with independent sessions. Record the deployment revision, observed results, and gaps. [M1 acceptance](REQUIREMENTS.md#m1-acceptance) still requires checks on iPhone Safari and Android Chrome, including invite, deal, reconnect, and deployed restart persistence. Use isolated test rooms and obtain authorization before restarting the deployed service.

## Render playtest

The Blueprint configures a free web service and a free PostgreSQL database on Render's private network. The database keeps rooms available across web-service restarts. Render's free database expires 30 days after creation.

Render handles deployments from `main`. The Blueprint sets auto-deploy to **After CI Checks Pass**. Verify this setting on the live service before relying on it to gate deployments.

### Exile ballots during rollback

Before rolling back to a revision that predates manual **开票**, let active rooms finish and publish their ordinary and PK exile ballots. On an older revision a room can stay in voting with a full ballot count and no result action. If that happens, redeploy a revision that supports manual **开票** using the same PostgreSQL database. The host can resume the same room and publish the saved votes.
