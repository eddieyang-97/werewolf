import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import jpeg from 'jpeg-js';
import { Client } from 'pg';
import { boards, thiefDraw } from '../public/boards.js';
import { buildDeck } from '../server/deal.js';
import { createApp } from '../server/http.js';
import { matchRules } from '../server/match-rules.js';
import { openPostgresStore } from '../server/postgres-store.js';
import { openStore } from '../server/store.js';

const postgresTestUrl = process.env.WEREWOLF_TEST_POSTGRES_URL;

function sqliteFixture(t, persistent) {
  if (!persistent) return () => openStore(':memory:');
  const directory = mkdtempSync(join(tmpdir(), 'werewolf-test-'));
  t.after(() => rmSync(directory, { recursive: true }));
  return () => openStore(join(directory, 'room.sqlite'));
}

async function postgresFixture(t) {
  const url = new URL(postgresTestUrl);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' &&
      url.pathname.length > 1 && !url.search && !url.hash,
    'WEREWOLF_TEST_POSTGRES_URL must point to a disposable PostgreSQL database on 127.0.0.1 without URL options',
  );
  const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5_000 });
  const schema = `werewolf_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
  } catch (error) {
    await client.end();
    throw error;
  }
  t.after(async () => {
    try {
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await client.end();
    }
  });
  url.searchParams.set('options', `-c search_path=${schema}`);
  return () => openPostgresStore(url.href);
}

async function withServer(open, run) {
  let store;
  let app;
  async function close() {
    try {
      if (app?.listening) {
        await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
      }
    } finally {
      app = undefined;
      const previous = store;
      store = undefined;
      await previous?.close();
    }
  }
  try {
    await run(async options => {
      await close();
      store = await open();
      app = createApp(store, options);
      app.listen(0, '127.0.0.1');
      await once(app, 'listening');
      return `http://127.0.0.1:${app.address().port}`;
    });
  } finally {
    await close();
  }
}

function roomTest(name, run, { postgres = false, persistent = false } = {}) {
  test(`SQLite: ${name}`, t => withServer(sqliteFixture(t, persistent), run));
  if (postgres && postgresTestUrl !== undefined) {
    test(`PostgreSQL: ${name}`, async t => withServer(await postgresFixture(t), run));
  }
}

function browser() {
  return { token: randomBytes(32).toString('hex'), tab: randomUUID() };
}

async function json(base, path, participant, body, status = 200) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(participant ? { Authorization: `Bearer ${participant.token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok([status].flat().includes(response.status), JSON.stringify(result));
  return result;
}

function roomApi(base, code, participant, operation, body = {}, status = 200) {
  return json(base, `/api/rooms/${code}/${operation}`, participant, { tab: participant.tab, ...body }, status);
}

function action(base, code, participant, command, status = 200) {
  return roomApi(base, code, participant, 'action', { command: { id: randomUUID(), ...command } }, status);
}

async function setup(base, board, avatar) {
  const host = browser();
  const { code } = await json(base, '/api/rooms', host, { tab: host.tab, board, name: '房主', avatar }, 201);
  assert.equal((await json(base, '/api/rooms', host, { tab: host.tab, board, name: '房主' }, 201)).code, code);
  const room = await roomApi(base, code, host, 'resume');
  assert.equal(room.self.seat, 1);
  assert.deepEqual(room.self, { ...room.seats[0], revealed: false });
  return { code, host };
}

async function fill(base, code, host) {
  const guests = Array.from({ length: 11 }, browser);
  await Promise.all(guests.map(async (guest, index) => {
    await roomApi(base, code, guest, 'join', { name: `玩家${index + 2}` });
    await action(base, code, guest, { type: 'seat', seat: index + 2 });
  }));
  return [host, ...guests];
}

// Expected rosters come from REQUIREMENTS.md, not the production dealer or UI previews.
const thiefPowerRoles = ['poisoner', 'dreamer', 'hunter', 'medium'];
const expectedRoles = {
  classic: ['wolf', 'wolf', 'wolf', 'wolf', 'villager', 'villager', 'villager', 'mixed', 'seer', 'witch', 'hunter', 'fool'],
  mechanical: ['wolf', 'wolf', 'wolf', 'mechanical', 'villager', 'villager', 'villager', 'villager', 'medium', 'witch', 'guard', 'hunter'],
};

function assertRoster(board, assignments) {
  let expected = expectedRoles[board];
  if (board === 'thief') {
    const thief = assignments.find(card => card.role === 'thief');
    assert.ok(thief);
    const drawn = thief.extra?.[0];
    assert.ok(thiefPowerRoles.includes(drawn), 'Thief must draw an eligible power role');
    assert.deepEqual(thief.extra, [drawn, 'villager']);
    expected = ['wolf', 'wolf', 'wolfKing', 'thief', 'villager', 'villager', 'villager', 'villager', 'masked',
      ...thiefPowerRoles.filter(role => role !== drawn)];
  }
  assert.deepEqual(assignments.map(card => card.role).sort(), [...expected].sort());
  for (const card of assignments) {
    if (card.role !== 'thief') assert.equal(card.extra, undefined);
  }
}

test('each Thief draw preserves the four ordinary power roles and 14 cards', () => {
  assert.deepEqual([...thiefDraw].sort(), [...thiefPowerRoles].sort());
  assert.deepEqual(boards.thief.preview.filter(role => ['wolf', 'wolfKing', 'thief'].includes(role)).sort(),
    ['thief', 'wolf', 'wolf', 'wolfKing']);
  for (const [index, choice] of thiefDraw.entries()) {
    const deck = buildDeck('thief', count => {
      assert.equal(count, 4);
      return index;
    });
    const thief = deck.find(card => card.role === 'thief');
    assert.deepEqual(thief.extra, [choice, 'villager']);
    assert.equal(deck.length, 12);
    assert.equal(deck.length + thief.extra.length, 14);
    assert.equal(deck.some(card => card.role === choice), false);
    assert.equal(deck.filter(card => card.role === 'masked').length, 1);
    assert.equal(deck.filter(card => card.role === 'villager').length, 4);
    assert.equal(deck.filter(card => card.role === 'wolf').length, 2);
    assert.equal(deck.filter(card => card.role === 'wolfKing').length, 1);
    assertRoster('thief', deck);
  }
});

function photo(color) {
  const data = Buffer.alloc(128 * 128 * 4, color);
  return jpeg.encode({ width: 128, height: 128, data }, 80).data.toString('base64');
}

describe('room HTTP', { concurrency: 4 }, () => {
  roomTest('host transfer preserves seats and moves force-end authority across retry and restart', async start => {
    const options = { matchRules };
    let base = await start(options);
    const [host, successor, other] = Array.from({ length: 3 }, browser);
    const { code } = await json(base, '/api/rooms', host, {
      tab: host.tab, board: 'custom', lineup: ['wolf', 'seer', 'villager'], name: '房主',
    }, 201);
    const act = (player, command, status) => action(base, code, player, command, status);
    const sync = player => roomApi(base, code, player, 'sync');
    for (const [index, guest] of [successor, other].entries()) {
      await roomApi(base, code, guest, 'join', { name: `玩家${index + 2}` });
      await act(guest, { type: 'seat', seat: index + 2 });
    }
    await act(host, { type: 'deal' });
    const cards = await Promise.all([host, successor, other].map(async player => {
      const { assignment } = await act(player, { type: 'reveal' });
      await act(player, { type: 'acknowledge' });
      return assignment;
    }));
    const { room: started } = await act(host, { type: 'match-start' });
    const target = started.seats[1].id;
    const transfer = { type: 'host-transfer', target, id: randomUUID() };
    assert.equal((await act(other, transfer, 403)).code, 'HOST_ONLY');
    await roomApi(base, code, successor, 'disconnect');
    assert.equal((await act(host, transfer, 409)).code, 'HOST_TARGET');
    await sync(successor);
    const { room: moved } = await act(host, transfer);
    assert.equal(moved.self.host, false);
    assert.equal(moved.match.canAbandon, undefined);
    assert.deepEqual(moved.seats.map(seat => seat.id), started.seats.map(seat => seat.id));

    base = await start(options);
    assert.equal((await act(host, transfer)).room.seats[1].host, true);
    const restored = await sync(successor);
    assert.equal(restored.self.host, true);
    assert.equal(restored.match.phase, started.match.phase);
    assert.equal(restored.match.canAbandon, started.match.canAbandon);
    assert.deepEqual((await act(host, { type: 'reveal' })).assignment, cards[0]);
    assert.deepEqual((await act(successor, { type: 'reveal' })).assignment, cards[1]);

    const finish = { type: 'match-abandon', matchId: restored.match.canAbandon, winner: 'village', id: randomUUID() };
    assert.equal((await act(host, finish, 403)).code, 'HOST_ONLY');
    assert.equal((await act(successor, { ...finish, winner: 'third' }, 409)).code, 'MATCH_ACTION');
    assert.equal((await act(successor, finish)).room.match.winner, 'village');
    assert.equal((await act(successor, finish)).room.match.forced, true);
    assert.equal((await act(successor, { ...finish, winner: 'wolves' }, 409)).code, 'ACTION_ID');
    const finished = (await sync(other)).match;
    assert.equal(finished.forced, true);
    assert.deepEqual(finished.roster.map(card => card.role), cards.map(card => card.role));
  }, { postgres: true, persistent: true });

  for (const board of ['mechanical', 'classic', 'thief']) {
    roomTest(`${board} completes an account-free 12-seat deal and private acknowledgement`, async start => {
      const base = await start();
      const { code, host } = await setup(base, board);
      const invite = await fetch(`${base}/room/${code}`);
      assert.equal(invite.status, 200);
      assert.match(await invite.text(), /lang="zh-CN"/);
      const participants = await fill(base, code, host);
      assert.equal((await roomApi(base, code, browser(), 'join', { name: '新朋友' }, 409)).code, 'FULL');
      assert.equal((await action(base, code, participants[1], { type: 'deal' }, 403)).code, 'HOST_ONLY');
      await roomApi(base, code, participants[1], 'disconnect');
      assert.equal((await action(base, code, host, { type: 'deal' }, 409)).code, 'NOT_READY');
      await roomApi(base, code, participants[1], 'sync');
      const request = { id: randomUUID(), type: 'deal' };
      const [first, retry] = await Promise.all([
        action(base, code, host, request),
        action(base, code, host, request),
      ]);
      assert.equal(first.room.state, 'dealt');
      assert.doesNotMatch(JSON.stringify(first), /assignment|extra|token|receipts/);
      assert.deepEqual(retry, first);
      assert.equal((await action(base, code, host, { type: 'deal' }, 409)).code, 'LOCKED');
      assert.equal((await action(base, code, host, { type: 'remove', target: first.room.seats[1].id }, 409)).code, 'LOCKED');
      assert.equal((await action(base, code, host, { type: 'acknowledge' }, 409)).code, 'NOT_REVEALED');
      const assignments = await Promise.all(participants.map(async (person, index) => {
        const { room, assignment } = await action(base, code, person, { type: 'reveal' });
        assert.equal(room.self.seat, index + 1);
        assert.doesNotMatch(JSON.stringify(room), /assignment|extra|token|receipts/);
        await action(base, code, person, { type: 'acknowledge' });
        return assignment;
      }));
      assertRoster(board, assignments);
      assert.equal(assignments.reduce((count, card) => count + 1 + (card.extra?.length ?? 0), 0), board === 'thief' ? 14 : 12);
      assert.equal((await roomApi(base, code, host, 'sync')).state, 'ready');
      assert.equal((await roomApi(base, code, browser(), 'resume', {}, 401)).code, 'SESSION_ENDED');
    }, { postgres: true });
  }

  roomTest('seat claims serialize, and host removal revokes the old credential', async start => {
    const base = await start();
    const { code, host } = await setup(base, 'classic');
    const first = browser();
    const second = browser();
    const joined = await roomApi(base, code, first, 'join', { name: '玩家甲' });
    await roomApi(base, code, second, 'join', { name: '玩家乙' });
    assert.equal((await action(base, code, first, { type: 'seat', seat: 1 }, 409)).code, 'OCCUPIED');
    await action(base, code, host, { type: 'seat', seat: 12 });
    assert.equal((await json(base, '/api/rooms', host, { tab: host.tab, board: 'classic', name: '房主' }, 201)).code, code);
    assert.equal((await roomApi(base, code, host, 'sync')).self.seat, 12);
    const requests = [first, second].map(guest => fetch(`${base}/api/rooms/${code}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab: guest.tab, command: { id: randomUUID(), type: 'seat', seat: 1 } }),
    }));
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const claims = await Promise.all(responses.map(response => response.json()));
    assert.equal(claims[responses.findIndex(response => response.status === 409)].code, 'OCCUPIED');
    const hostView = await roomApi(base, code, host, 'sync');
    const winner = hostView.seats[0].id === joined.self.id ? first : second;
    const other = winner === first ? second : first;
    const command = { type: 'remove', target: hostView.seats[0].id };
    assert.equal((await action(base, code, other, command, 403)).code, 'HOST_ONLY');
    assert.equal((await action(base, code, host, command)).room.seats[0], null);
    assert.equal((await roomApi(base, code, winner, 'resume', {}, 401)).code, 'SESSION_ENDED');
    assert.equal((await roomApi(base, code, winner, 'join', { name: '新昵称' }, 401)).code, 'SESSION_ENDED');
    assert.equal((await action(base, code, other, { type: 'seat', seat: 1 })).room.self.seat, 1);
  }, { postgres: true });

  roomTest('room avatars are optional and follow the guest on edit, reconnect and removal', async start => {
    const base = await start();
    const original = photo(14);
    const { code, host } = await setup(base, 'classic', original);
    const hostAvatar = (await roomApi(base, code, host, 'sync')).self.avatar;
    assert.ok(hostAvatar);
    assert.equal(Object.hasOwn(await json(base, `/api/rooms/${code}`), 'seats'), false);
    const guest = browser();
    const invalid = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    assert.equal((await roomApi(base, code, guest, 'join', { name: '玩家甲', avatar: invalid }, 400)).code, 'AVATAR');
    const joined = await roomApi(base, code, guest, 'join', { name: '玩家甲', avatar: original });
    assert.equal(joined.seats[0].avatar, hostAvatar);
    const image = await fetch(new URL(joined.self.avatar, base));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.equal(jpeg.decode(Buffer.from(await image.arrayBuffer())).width, 128);
    const command = { type: 'avatar', id: randomUUID(), avatar: photo(180) };
    const replacement = (await action(base, code, guest, command)).room.self.avatar;
    assert.notEqual(replacement, joined.self.avatar);
    assert.equal((await action(base, code, guest, command)).room.self.avatar, replacement);
    assert.equal((await fetch(new URL(joined.self.avatar, base))).status, 404);
    assert.equal((await roomApi(base, code, { ...guest, tab: randomUUID() }, 'resume')).self.avatar, replacement);
    assert.equal((await roomApi(base, code, host, 'sync')).waiting[0].avatar, replacement);
    assert.equal((await action(base, code, host, { type: 'avatar', avatar: null })).room.self.avatar, null);
    await action(base, code, host, { type: 'remove', target: joined.self.id });
    assert.equal((await fetch(new URL(replacement, base))).status, 404);
  });

  roomTest('profile responses reflect saved details across retries and stay scoped to the requesting guest', async start => {
    let base = await start();
    const host = browser();
    const creation = { tab: host.tab, board: 'classic', name: ' Ｈost ', avatar: photo(14) };
    const { code, profile } = await json(base, '/api/rooms', host, creation, 201);
    assert.equal(profile.name, 'Host');
    assert.ok(profile.avatar);
    assert.deepEqual(await json(base, '/api/rooms', host, { ...creation, name: 'Changed', avatar: null }, 201), { code, profile });

    const guest = browser();
    const admission = { name: ' Ｇuest ', avatar: photo(180) };
    const joined = await roomApi(base, code, guest, 'join', admission);
    assert.equal(joined.profile.name, 'Guest');
    assert.ok(joined.profile.avatar);
    assert.notEqual(joined.profile.avatar, profile.avatar);
    assert.equal(joined.seats[0].avatar.startsWith(`/api/rooms/${code}/avatar/`), true);
    const retry = await roomApi(base, code, guest, 'join', { name: 'Changed', avatar: null });
    assert.deepEqual(retry.profile, joined.profile);

    const recovered = { ...guest, tab: randomUUID() };
    assert.deepEqual((await roomApi(base, code, recovered, 'resume', { includeProfile: true })).profile, joined.profile);
    assert.equal((await roomApi(base, code, host, 'sync')).profile, undefined);
    assert.equal((await roomApi(base, code, recovered, 'resume')).profile, undefined);
    const pendingAvatarId = randomUUID();
    assert.equal((await roomApi(base, code, recovered, 'sync', { pendingAvatarId })).profile, undefined);
    const removed = await action(base, code, recovered, { id: pendingAvatarId, type: 'avatar', avatar: null });
    assert.deepEqual(removed.profile, { name: 'Guest', avatar: null });
    assert.equal(removed.room.self.avatar, null);
    assert.equal((await roomApi(base, code, host, 'sync', { pendingAvatarId })).profile, undefined);
    assert.deepEqual((await roomApi(base, code, recovered, 'sync', { pendingAvatarId })).profile, removed.profile);
    base = await start();
    const reloaded = { ...guest, tab: randomUUID() };
    assert.deepEqual((await roomApi(base, code, reloaded, 'resume', { pendingAvatarId })).profile, removed.profile);
    await action(base, code, reloaded, { type: 'avatar', avatar: photo(55) });
    assert.equal((await roomApi(base, code, reloaded, 'sync', { pendingAvatarId })).profile, undefined);
  }, { postgres: true, persistent: true });

  roomTest('a concurrent removal and deal cannot both change the roster', async start => {
    const base = await start();
    const { code, host } = await setup(base, 'mechanical');
    const participants = await fill(base, code, host);
    const before = await roomApi(base, code, host, 'sync');
    const [removed, dealt] = await Promise.all([
      action(base, code, host, { type: 'remove', target: before.seats[1].id }, [200, 409]),
      action(base, code, host, { type: 'deal' }, [200, 409]),
    ]);
    const after = await roomApi(base, code, host, 'sync');
    if (removed.room) {
      assert.equal(dealt.code, 'NOT_READY');
      assert.equal(after.state, 'lobby');
      assert.equal(after.seats[1], null);
      assert.equal((await roomApi(base, code, participants[1], 'resume', {}, 401)).code, 'SESSION_ENDED');
    } else {
      assert.equal(removed.code, 'LOCKED');
      assert.equal(dealt.room.state, 'dealt');
      assert.equal(after.seats[1].id, before.seats[1].id);
    }
  }, { postgres: true });

  roomTest('the same private assignment and acknowledgement survive a restart and tab takeover', async start => {
    let base = await start();
    const { code, host } = await setup(base, 'thief', photo(45));
    const hostAvatar = (await roomApi(base, code, host, 'sync')).self.avatar;
    const participants = await fill(base, code, host);
    await action(base, code, host, { type: 'deal' });
    const cards = await Promise.all(participants.map(person => action(base, code, person, { type: 'reveal' })));
    const index = cards.findIndex(result => result.assignment.role === 'thief');
    assert.notEqual(index, -1);
    const original = participants[index];
    await action(base, code, original, { type: 'acknowledge' });
    const oldBoot = (await json(base, '/healthz')).boot;
    base = await start();
    assert.notEqual((await json(base, '/healthz')).boot, oldBoot);
    const replacement = { token: original.token, tab: randomUUID() };
    const recovered = await roomApi(base, code, replacement, 'resume');
    assert.equal(recovered.self.seat, index + 1);
    assert.equal(recovered.self.revealed, true);
    assert.equal(recovered.self.acknowledged, true);
    assert.equal(recovered.self.host, index === 0);
    assert.equal((await roomApi(base, code, original, 'sync', {}, 409)).code, 'TAKEN_OVER');
    assert.deepEqual((await action(base, code, replacement, { type: 'reveal' })).assignment, cards[index].assignment);
    const unready = await roomApi(base, code, participants[(index + 1) % participants.length], 'sync');
    assert.equal(unready.self.revealed, true);
    assert.equal(unready.self.acknowledged, false);
    const hostReplacement = { token: host.token, tab: randomUUID() };
    const hostView = await roomApi(base, code, hostReplacement, 'resume');
    assert.equal(hostView.self.host, true);
    assert.equal(hostView.self.avatar, hostAvatar);
    const avatar = await fetch(new URL(hostAvatar, base));
    assert.equal(avatar.status, 200);
    await avatar.arrayBuffer();
  }, { postgres: true, persistent: true });

  roomTest('room expires after 24 hours without a connected player', async start => {
    let now = Date.now();
    const base = await start({ clock: () => now });
    const { code, host } = await setup(base, 'classic');
    await roomApi(base, code, host, 'disconnect');
    now += 24 * 60 * 60 * 1000;
    assert.equal((await roomApi(base, code, host, 'resume', {}, 404)).code, 'ROOM_GONE');
  });

  roomTest('M2 launch gates, private choices, and their receipts survive the room server restarting', async start => {
    let base = await start({ matchRules });
    const { code, host } = await setup(base, 'mechanical');
    assert.equal((await action(base, code, host, { type: 'match-start' }, 409)).code, 'NOT_READY');
    const players = await fill(base, code, host);
    await action(base, code, host, { type: 'deal' });
    const cards = await Promise.all(players.map(async person => {
      const { assignment } = await action(base, code, person, { type: 'reveal' });
      await action(base, code, person, { type: 'acknowledge' });
      return assignment.role;
    }));
    const guard = players[cards.indexOf('guard')];
    const outsider = players[cards.findIndex((role, index) => role === 'villager' && index !== 0)];
    assert.equal((await action(base, code, outsider, { type: 'match-start' }, 403)).code, 'HOST_ONLY');
    await roomApi(base, code, outsider, 'disconnect');
    assert.equal((await action(base, code, host, { type: 'match-start' }, 409)).code, 'NOT_READY');
    await roomApi(base, code, outsider, 'sync');
    await action(base, code, host, { type: 'match-start' });
    const waiting = (await roomApi(base, code, outsider, 'sync')).match;
    assert.equal(waiting.phase, 'night');
    assert.equal(waiting.actions, undefined);
    assert.equal(waiting.window, undefined);
    const pending = (await roomApi(base, code, guard, 'sync')).match;
    assert.equal(pending.self.nightAction.kind, 'guard');
    assert.deepEqual(pending.actions.map(item => item.action), ['guard']);
    const command = { type: 'match-choice', matchId: pending.matchId, window: pending.window, kind: 'night-action', choice: 1 };
    assert.equal((await action(base, code, outsider, command, 409)).code, 'MATCH_ACTION');
    base = await start({ matchRules });
    const replacement = { ...guard, tab: randomUUID() };
    const restored = (await roomApi(base, code, replacement, 'resume')).match;
    assert.equal(restored.window, pending.window);
    assert.deepEqual(restored.actions, pending.actions);
    assert.equal((await action(base, code, guard, command, 409)).code, 'TAKEN_OVER');
    const id = randomUUID();
    const first = await action(base, code, replacement, { ...command, id });
    assert.equal(first.room.match.self.nightAction, undefined);
    assert.deepEqual(await action(base, code, replacement, { ...command, id }), first);
    assert.equal((await action(base, code, replacement, { ...command, id, choice: 2 }, 409)).code, 'ACTION_ID');
    assert.equal((await action(base, code, replacement, command, 409)).code, 'MATCH_ACTION');
    const knife = (await roomApi(base, code, players[cards.indexOf('wolf')], 'sync')).match;
    assert.equal(knife.actions[0].action, 'knife');
    assert.notEqual(knife.window, pending.window);
  }, { postgres: true, persistent: true });

  roomTest('custom room rules, capacity and private deal survive restart and rematch', async start => {
    const clock = () => 10_000;
    let base = await start({ clock, matchRules });
    const host = browser();
    const create = { tab: host.tab, board: 'custom', name: '房主' };
    const lineup = ['villager', 'villager', 'wolf', 'wolfKing', 'wolfBeauty', 'seer', 'magician', 'knight'];
    assert.equal((await fetch(`${base}/create/custom`)).status, 200);
    for (const invalid of [null, [], ['wolf', 'seer', 'seer', 'villager'], ['wolf', 'seer', 'thief', 'villager'],
      ['mechanical', 'knight', 'villager'], ['wolfBeauty', 'magician', 'magician', 'villager'],
      ['wolf', 'villager'], ['wolf', 'guard', 'dreamer', 'villager'], [...lineup, ...Array(8).fill('villager')]]) {
      const result = await json(base, '/api/rooms', host, { ...create, lineup: invalid }, 400);
      assert.equal(result.code, 'LINEUP');
    }
    for (const sheriffMode of [null, 'invalid', 'toString']) {
      const result = await json(base, '/api/rooms', host, { ...create, lineup, sheriffMode }, 400);
      assert.equal(result.code, 'SHERIFF_MODE');
    }
    for (const customRules of [null, [], 'town', { unknown: 'town' }, { victoryMode: 'toString' },
      { firstNightKnife: false }, { witchSelfSave: ['allowed'] }]) {
      const result = await json(base, '/api/rooms', host, { ...create, lineup, customRules }, 400);
      assert.equal(result.code, 'CUSTOM_RULES');
    }
    const presetRules = await json(base, '/api/rooms', host, { ...create, board: 'classic', customRules: {} }, 400);
    assert.equal(presetRules.code, 'CUSTOM_RULES');
    const defaultHost = browser();
    const defaultRoom = await json(base, '/api/rooms', defaultHost, { ...create, tab: defaultHost.tab, lineup }, 201);
    const defaults = await json(base, `/api/rooms/${defaultRoom.code}`);
    assert.equal(defaults.sheriffMode, 'double');
    assert.deepEqual(defaults.customRules, { victoryMode: 'side', firstNightKnife: 'enabled', witchSelfSave: 'forbidden' });
    for (const townLineup of [['wolf', 'villager', 'villager'], ['wolf', 'seer', 'witch']]) {
      const townHost = browser();
      const request = { ...create, tab: townHost.tab, lineup: townLineup };
      assert.equal((await json(base, '/api/rooms', townHost, request, 400)).code, 'LINEUP');
      const townRoom = await json(base, '/api/rooms', townHost, { ...request, customRules: { victoryMode: 'town' } }, 201);
      const town = await json(base, `/api/rooms/${townRoom.code}`);
      assert.deepEqual(town.lineup, townLineup);
      assert.deepEqual(town.customRules, { ...defaults.customRules, victoryMode: 'town' });
    }
    const customRules = { victoryMode: 'town', firstNightKnife: 'disabled', witchSelfSave: 'allowed' };
    const { code } = await json(base, '/api/rooms', host, { ...create, lineup, sheriffMode: 'none', customRules }, 201);
    const retry = await json(base, '/api/rooms', host, { ...create, lineup: ['wolf', 'seer', 'villager'], sheriffMode: 'single' }, 201);
    assert.equal(retry.code, code);
    const status = await json(base, `/api/rooms/${code}`);
    assert.deepEqual(status.lineup, lineup);
    assert.equal(status.sheriffMode, 'none');
    assert.deepEqual(status.customRules, customRules);
    assert.equal(status.full, false);
    assert.equal((await roomApi(base, code, host, 'resume')).seats.length, lineup.length);
    await action(base, code, host, { type: 'deal' }, 409);
    await action(base, code, host, { type: 'seat', seat: lineup.length + 1 }, 400);

    const guests = Array.from({ length: lineup.length - 1 }, browser);
    for (const [index, guest] of guests.entries()) {
      await roomApi(base, code, guest, 'join', { name: `玩家${index + 2}` });
      await action(base, code, guest, { type: 'seat', seat: index + 2 });
    }
    assert.equal((await json(base, `/api/rooms/${code}`)).full, true);
    assert.equal((await roomApi(base, code, browser(), 'join', { name: '访客' }, 409)).code, 'FULL');
    const spectator = browser();
    assert.equal((await roomApi(base, code, spectator, 'join', { name: '观众', spectate: true })).self.spectator, true);
    const deal = { type: 'deal', id: randomUUID() };
    await action(base, code, host, deal);
    const participants = [host, ...guests];
    const assignments = await Promise.all(participants.map(async participant => {
      const { room, assignment } = await action(base, code, participant, { type: 'reveal' });
      assert.equal(room.self.revealed, true);
      assert.ok(room.seats.every(seat => !Object.hasOwn(seat, 'assignment') && !Object.hasOwn(seat, 'revealed')));
      assert.ok(room.seats.every(seat => !seat.acknowledged));
      return assignment;
    }));
    await Promise.all(guests.map(guest => action(base, code, guest, { type: 'acknowledge' })));
    const waitingForHost = await roomApi(base, code, host, 'sync');
    assert.equal(waitingForHost.state, 'dealt');
    assert.equal(waitingForHost.self.revealed, true);
    assert.equal(waitingForHost.self.acknowledged, false);
    assert.equal((await action(base, code, host, { type: 'match-start' }, 409)).code, 'NOT_READY');
    const { room: ready } = await action(base, code, host, { type: 'acknowledge' });
    assert.equal(ready.canStart, true);
    assert.deepEqual(assignments.map(card => card.role).sort(), [...lineup].sort());
    await action(base, code, spectator, { type: 'reveal' }, 403);
    base = await start({ clock, matchRules });
    const resumed = await roomApi(base, code, host, 'resume');
    assert.deepEqual(resumed.lineup, lineup);
    assert.equal(resumed.sheriffMode, 'none');
    assert.deepEqual(resumed.customRules, customRules);
    assert.equal(resumed.canStart, true);
    assert.deepEqual((await action(base, code, host, { type: 'reveal' })).assignment, assignments[0]);
    await action(base, code, host, deal);
    await action(base, code, host, { type: 'match-start' });
    const magician = participants[assignments.findIndex(card => card.role === 'magician')];
    const swapView = (await roomApi(base, code, magician, 'sync')).match;
    assert.equal(swapView.actions[0].action, 'swap');
    const villagers = assignments.flatMap((card, index) => card.role === 'villager' ? [index + 1] : []);
    const swap = { type: 'match-choice', matchId: swapView.matchId, window: swapView.window,
      kind: 'night-action', choice: villagers, id: randomUUID() };
    const swapped = await action(base, code, magician, swap);
    base = await start({ clock, matchRules });
    assert.deepEqual(await action(base, code, magician, swap), swapped);
    const kingIndex = assignments.findIndex(card => card.role === 'wolfKing');
    const kingView = await roomApi(base, code, participants[kingIndex], 'resume');
    assert.equal(kingView.match.actions[0].action, 'wolf-recognition');
    assert.deepEqual(kingView.match.actions[0].options, ['confirm']);
    assert.deepEqual(kingView.match.self.teammates, assignments.flatMap((card, index) =>
      ['wolf', 'wolfBeauty'].includes(card.role) ? [index + 1] : []));
    await action(base, code, participants[kingIndex], { type: 'match-choice', matchId: kingView.match.matchId,
      window: kingView.match.window, kind: 'night-action', choice: 'confirm' });
    const beauty = participants[assignments.findIndex(card => card.role === 'wolfBeauty')];
    const charmView = (await roomApi(base, code, beauty, 'sync')).match;
    assert.equal(charmView.actions[0].action, 'charm');
    await action(base, code, beauty, { type: 'match-choice', matchId: charmView.matchId,
      window: charmView.window, kind: 'night-action', choice: villagers[0] });
    const seer = participants[assignments.findIndex(card => card.role === 'seer')];
    const seerView = (await roomApi(base, code, seer, 'sync')).match;
    await action(base, code, seer, { type: 'match-choice', matchId: seerView.matchId, window: seerView.window,
      kind: 'night-action', choice: kingIndex + 1 });
    const spectatorView = await roomApi(base, code, spectator, 'sync');
    assert.equal(spectatorView.match.self, undefined);
    assert.deepEqual(spectatorView.customRules, customRules);
    const hostMatch = (await roomApi(base, code, host, 'sync')).match;
    assert.deepEqual(hostMatch.actions.map(item => item.kind).filter(kind => kind !== 'self-destruct'), ['publish-night']);
    const abandoned = await action(base, code, host, { type: 'match-abandon', matchId: hostMatch.canAbandon });
    const { matchId, window } = abandoned.room.match;
    const rematch = await action(base, code, host, { type: 'match-choice', matchId, window, kind: 'rematch' });
    assert.deepEqual(rematch.room.lineup, lineup);
    assert.equal(rematch.room.sheriffMode, 'none');
    assert.deepEqual(rematch.room.customRules, customRules);
    assert.equal(rematch.room.seats.length, lineup.length);
    assert.equal(rematch.room.self.revealed, false);
    assert.equal(rematch.room.self.acknowledged, false);
    assert.equal(rematch.room.canDeal, true);
  }, { postgres: true, persistent: true });

  roomTest('spectators survive the deal and a replacement reviews the existing role before kickoff', async start => {
    const base = await start({ matchRules });
    const { code, host } = await setup(base, 'classic');
    const spectator = browser();
    const admission = { name: '旁观者', spectate: true };
    assert.equal((await roomApi(base, code, spectator, 'join', admission, 409)).code, 'SEATS_AVAILABLE');
    const players = await fill(base, code, host);
    const initial = await roomApi(base, code, host, 'sync');
    const watching = await roomApi(base, code, spectator, 'join', admission);
    assert.equal(watching.self.seat, null);
    assert.equal(watching.self.spectator, true);
    assert.deepEqual(watching.seats, initial.seats);
    assert.equal(watching.spectatorCount, 1);
    assert.equal((await action(base, code, spectator, { type: 'seat', seat: 2 }, 403)).code, 'SPECTATOR_ONLY');
    assert.equal((await roomApi(base, code, players[1], 'join', admission)).self.seat, 2);
    await action(base, code, host, { type: 'deal' });
    const assignments = await Promise.all(players.map(async player => {
      const { assignment } = await action(base, code, player, { type: 'reveal' });
      await action(base, code, player, { type: 'acknowledge' });
      return assignment;
    }));
    assert.equal((await roomApi(base, code, spectator, 'sync')).state, 'ready');
    await roomApi(base, code, players[1], 'disconnect');
    const target = initial.seats[1].id;
    await action(base, code, spectator, { type: 'replacement-request', target });
    const { replacementRequests: [request] } = await roomApi(base, code, host, 'sync');
    const approval = await action(base, code, host, { type: 'replacement-approve', target: request.id });
    assert.equal(approval.room.state, 'dealt');
    assert.equal(approval.room.seats[1].id, watching.self.id);
    assert.equal((await action(base, code, spectator, { type: 'acknowledge' }, 409)).code, 'NOT_REVEALED');
    assert.deepEqual((await action(base, code, spectator, { type: 'reveal' })).assignment, assignments[1]);
    await action(base, code, spectator, { type: 'acknowledge' });
    await action(base, code, host, { type: 'match-start' });
    assert.equal((await roomApi(base, code, players[1], 'resume')).self.spectator, true);
  });

  roomTest('host approval atomically hands off an offline seat and its private match action', async start => {
    let now = Date.now();
    const options = { matchRules, clock: () => now };
    let base = await start(options);
    const { code, host } = await setup(base, 'mechanical');
    const players = await fill(base, code, host);
    const act = (player, type, details = {}, status = 200) => action(base, code, player, { type, ...details }, status);
    const sync = player => roomApi(base, code, player, 'sync');
    const disconnect = player => roomApi(base, code, player, 'disconnect');
    const choose = (player, match, kind, choice) => act(player, 'match-choice', {
      kind, choice, matchId: match.matchId, window: match.window,
    });
    await act(host, 'deal');
    const assignments = await Promise.all(players.map(async player => {
      const { assignment } = await act(player, 'reveal');
      await act(player, 'acknowledge');
      return assignment;
    }));
    await act(host, 'match-start');
    const guard = assignments.findIndex(card => card.role === 'guard');
    if (guard === 0) await choose(host, (await sync(host)).match, 'night-action', null);
    const index = guard || assignments.findIndex(card => card.role === 'wolf');
    const original = players[index];
    const privateState = await sync(original);
    const pending = privateState.match;
    const target = privateState.self.id;
    assert.ok(pending.actions.some(entry => entry.kind === 'night-action'));

    const [watcher, alternate] = [browser(), browser()];
    const [watching, otherWatching] = await Promise.all([watcher, alternate].map((person, i) =>
      roomApi(base, code, person, 'join', { name: `观战${i + 1}`, spectate: true })));
    const { self, actions, window, matchId, ...publicMatch } = pending;
    assert.ok(self);
    assert.deepEqual(watching.match, publicMatch);
    assert.deepEqual(watching.seats, privateState.seats);
    for (const type of ['reveal', 'avatar', 'match-choice', 'replacement-approve']) {
      assert.equal((await act(watcher, type, {}, 403)).code, 'SPECTATOR_ONLY');
    }
    assert.equal((await act(watcher, 'replacement-request', { target }, 409)).code, 'REPLACEMENT_UNAVAILABLE');
    await disconnect(host);
    assert.equal((await act(watcher, 'replacement-request', { target: watching.seats[0].id }, 409)).code, 'REPLACEMENT_UNAVAILABLE');

    now += 15_001;
    await Promise.all(players.filter(player => player !== original).map(sync));
    assert.equal((await sync(watcher)).seats[index].connected, false);
    await sync(alternate);
    const request = person => act(person, 'replacement-request', { target });
    assert.equal((await request(watcher)).room.self.replacementSeat, index + 1);
    assert.equal((await sync(alternate)).replacementRequests, undefined);
    const [stale] = (await sync(host)).replacementRequests;
    assert.equal((await act(players.find((player, i) => i !== 0 && i !== index), 'replacement-approve', { target: stale.id }, 403)).code, 'HOST_ONLY');
    await roomApi(base, code, original, 'resume');
    assert.equal((await sync(watcher)).self.replacementSeat, null);
    await disconnect(original);
    assert.equal((await act(host, 'replacement-approve', { target: stale.id }, 409)).code, 'REPLACEMENT_UNAVAILABLE');
    await request(watcher);
    await act(watcher, 'replacement-cancel');
    assert.deepEqual((await sync(host)).replacementRequests, []);
    await Promise.all([request(watcher), request(alternate)]);
    const candidates = (await sync(host)).replacementRequests;
    await disconnect(alternate);
    const unavailable = candidates.find(entry => entry.name === otherWatching.self.name);
    assert.equal((await act(host, 'replacement-approve', { target: unavailable.id }, 409)).code, 'REPLACEMENT_UNAVAILABLE');
    await sync(alternate);

    base = await start(options);
    const approvals = candidates.map(entry => ({ id: randomUUID(), type: 'replacement-approve', target: entry.id }));
    const outcomes = await Promise.all(approvals.map(command => action(base, code, host, command, [200, 409])));
    const accepted = outcomes.findIndex(result => result.room);
    assert.notEqual(accepted, -1);
    assert.equal(outcomes[1 - accepted].code, 'REPLACEMENT_UNAVAILABLE');
    const promoted = candidates[accepted].name === watching.self.name ? watcher : alternate;
    const remaining = promoted === watcher ? alternate : watcher;
    const approval = await action(base, code, host, approvals[accepted]);
    assert.equal(approval.room.seats[index].name, candidates[accepted].name);
    assert.deepEqual(approval.room.replacementRequests, []);
    assert.equal(approval.room.match.self.nightAction, undefined);

    const old = await roomApi(base, code, original, 'resume');
    assert.equal(old.self.seat, null);
    assert.equal(old.self.spectator, true);
    assert.equal(old.self.canRequestReplacement, false);
    assert.deepEqual(old.match, publicMatch);
    assert.equal((await act(original, 'reveal', {}, 403)).code, 'SPECTATOR_ONLY');
    assert.equal((await act(original, 'match-choice', { matchId, window, kind: 'night-action', choice: null }, 403)).code, 'SPECTATOR_ONLY');
    assert.equal((await act(original, 'replacement-request', { target }, 409)).code, 'REPLACEMENT_UNAVAILABLE');
    assert.deepEqual((await sync(remaining)).match, publicMatch);

    base = await start(options);
    const resumed = await roomApi(base, code, promoted, 'resume');
    assert.equal(resumed.self.seat, index + 1);
    assert.deepEqual(resumed.match, pending);
    assert.deepEqual((await act(promoted, 'reveal')).assignment, assignments[index]);
    await choose(promoted, resumed.match, 'night-action', null);
    players[index] = promoted;

    while ((await sync(host)).match.phase === 'night') {
      const views = await Promise.all(players.map(sync));
      const actor = views.findIndex(view => view.match.actions?.some(entry => entry.kind === 'night-action'));
      assert.notEqual(actor, -1);
      const { match } = views[actor];
      const { options: choices } = match.actions.find(entry => entry.kind === 'night-action');
      await choose(players[actor], match, 'night-action', choices.includes(null) ? null : choices[0]);
    }
    await choose(host, (await sync(host)).match, 'open-election');
    for (const [i, player] of players.entries()) {
      await choose(player, (await sync(player)).match, 'candidacy', i < 2);
    }
    for (let i = 0; i < 2; i++) await choose(host, (await sync(host)).match, 'finish-speech');
    await choose(players[2], (await sync(players[2])).match, 'vote', 1);
    const duringVote = (await sync(remaining)).match;
    assert.equal(duringVote.phase, 'sheriff-vote');
    assert.equal(duringVote.voteProgress, undefined);
    assert.equal(duringVote.actions, undefined);
    assert.ok(duringVote.history.every(event => !event.ballot));
    for (const player of players.slice(3, -1)) await choose(player, (await sync(player)).match, 'vote', null);
    const hostBallot = (await sync(host)).match;
    const lastVoter = players.at(-1);
    const { matchId: ballotId, window: ballotWindow } = hostBallot;
    assert.deepEqual(hostBallot.voteProgress, { received: 9, expected: 10, pending: [12] });
    assert.equal((await sync(lastVoter)).match.voteProgress, undefined);
    const close = { id: randomUUID(), type: 'match-choice', matchId: ballotId, window: ballotWindow, kind: 'close-vote' };
    assert.equal((await action(base, code, lastVoter, close, 409)).code, 'MATCH_ACTION');
    const last = { id: randomUUID(), type: 'match-choice', matchId: ballotId, window: ballotWindow, kind: 'vote', choice: null };
    const commands = [[host, close], [lastVoter, last]];
    const settlements = await Promise.all(commands.map(([player, command]) => action(base, code, player, command, [200, 409])));
    const completed = settlements.findIndex(result => result.room);
    assert.notEqual(completed, -1);
    assert.equal(settlements[1 - completed].code, 'MATCH_ACTION');
    const [actor, acceptedCommand] = commands[completed];
    const replay = await action(base, code, actor, acceptedCommand);
    assert.equal(replay.room.match.phase, 'dawn');
    const ballots = (await sync(remaining)).match.history.filter(event => event.kind === 'sheriff-vote');
    assert.equal(ballots.length, 1);
    const [published] = ballots;
    assert.deepEqual(published.ballot.groups, [{ seat: 1, count: 1, voters: [3] }]);
    assert.equal(published.ballot.abstained.length, 9);

    const { match: { canAbandon } } = await sync(host);
    const abandoned = await act(host, 'match-abandon', { matchId: canAbandon });
    const afterFinish = await sync(remaining);
    assert.equal(afterFinish.match.winner, 'abandoned');
    assert.equal(afterFinish.match.roster, undefined);
    assert.equal(afterFinish.self.canRequestReplacement, false);
    await choose(host, abandoned.room.match, 'rematch');
    assert.equal((await sync(promoted)).self.seat, index + 1);
    assert.equal((await sync(original)).self.canRequestReplacement, true);
  }, { postgres: true, persistent: true });
});
