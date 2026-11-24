# Werewolf

Mobile Werewolf for friends. Create an account-free room, invite friends, and play any of the three 12-player presets from the first night through rematch. Each phone receives its own roles and actions. Players can reconnect to their seat and view completed ballots in the match history. See [requirements](REQUIREMENTS.md) for the presets and rules.

## Local development

Use Node.js 24.

```sh
npm ci
npm test
npm start
```

Open `http://localhost:3000`. The server uses `.data/rooms.sqlite` by default. Set `ROOM_DB_PATH` for a different SQLite file, or `DATABASE_URL` for PostgreSQL.

## Tests and merges

`npm test` runs the rule and SQLite HTTP tests. To iterate on the room tests, run `node --test test/m1.test.js`. Independent cases run in parallel with ephemeral HTTP ports and separate stores.

To also run the shared deal, concurrency, and restart scenarios against PostgreSQL, start a disposable local database. The test user needs permission to create schemas. Each scenario creates and removes its own schema, including when multiple suites run against the same test database.

```sh
docker run --rm -d --name werewolf-test-postgres -p 127.0.0.1:55432:5432 -e POSTGRES_USER=werewolf -e POSTGRES_PASSWORD=werewolf_test -e POSTGRES_DB=werewolf_test postgres:18
docker exec werewolf-test-postgres pg_isready -h 127.0.0.1 -U werewolf -d werewolf_test
# Once PostgreSQL is accepting connections:
WEREWOLF_TEST_POSTGRES_URL=postgresql://werewolf:werewolf_test@127.0.0.1:55432/werewolf_test npm test
docker stop werewolf-test-postgres
```

In PowerShell, set `$env:WEREWOLF_TEST_POSTGRES_URL` to the same URL before running `npm test`. The tests use this dedicated loopback URL and ignore the app's `DATABASE_URL`.

The GitHub Actions **Tests** check runs both storage backends on pull requests to `main` and pushes to `main`. GitHub currently requires Pro or public visibility to enforce status checks on this repository. Wait for **Tests** to pass on the latest PR revision before merging. If branch protection becomes available, require this check on `main`.

For client/API changes, smoke-test the affected browser flow. For a milestone or material deployment, verify the live revision and database readiness at `/healthz`, then exercise the relevant [acceptance criteria](REQUIREMENTS.md) on real phones with independent sessions. Record the deployment revision, observed results, and gaps. [M1 acceptance](REQUIREMENTS.md#m1-acceptance) still requires checks on iPhone Safari and Android Chrome, including invite, deal, reconnect, and deployed restart persistence. Use isolated test rooms and obtain authorization before restarting the deployed service.

## Render playtest

The Blueprint configures a free web service and a free PostgreSQL database on Render's private network. The database keeps rooms available across web-service restarts. Render's free database expires 30 days after creation.

Render handles deployments from `main`. The Blueprint sets auto-deploy to **After CI Checks Pass**. Verify this setting on the live service before relying on it to gate deployments.
