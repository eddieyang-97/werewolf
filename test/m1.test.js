import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { describe } from 'node:test';
import jpeg from 'jpeg-js';
import { Client } from 'pg';
import { thiefDraw } from '../public/boards.js';
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
  assert.deepEqual(room.seats[0], room.self);
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
    expected = ['wolf', 'wolf', 'wolf', 'thief', 'villager', 'villager', 'villager', 'villager', 'masked',
      ...thiefPowerRoles.filter(role => role !== drawn)];
  }
  assert.deepEqual(assignments.map(card => card.role).sort(), [...expected].sort());
  for (const card of assignments) {
    if (card.role !== 'thief') assert.equal(card.extra, undefined);
  }
}

test('each Thief draw preserves the four ordinary power roles and 14 cards', () => {
  assert.deepEqual([...thiefDraw].sort(), [...thiefPowerRoles].sort());
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
    assert.equal(deck.filter(card => card.role === 'wolf').length, 3);
    assertRoster('thief', deck);
  }
});

function photo(color) {
  const data = Buffer.alloc(128 * 128 * 4, color);
  return jpeg.encode({ width: 128, height: 128, data }, 80).data.toString('base64');
}

describe('room HTTP', { concurrency: 4 }, () => {
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
    assert.equal(recovered.self.acknowledged, true);
    assert.equal(recovered.self.host, index === 0);
    assert.equal((await roomApi(base, code, original, 'sync', {}, 409)).code, 'TAKEN_OVER');
    assert.deepEqual((await action(base, code, replacement, { type: 'reveal' })).assignment, cards[index].assignment);
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
});
