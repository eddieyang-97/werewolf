import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { thiefDraw } from '../public/boards.js';
import { buildDeck } from '../server/deal.js';
import { createApp } from '../server/http.js';
import { matchRules } from '../server/match-rules.js';
import { openStore } from '../server/store.js';

async function start(path = ':memory:', clock = Date.now, matchRules) {
  const store = openStore(path);
  const app = createApp(store, { clock, matchRules });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  return {
    base: `http://127.0.0.1:${app.address().port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        app.close(error => error ? reject(error) : resolve());
        app.closeIdleConnections();
      });
      store.close();
    },
  };
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

test('each Thief draw preserves the four ordinary power roles and 14 cards', () => {
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
  }
});

test('custom room capacity and private deal survive restart and rematch', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'werewolf-custom-'));
  const path = join(directory, 'room.sqlite');
  const clock = () => 10_000;
  let server = await start(path, clock, matchRules);
  t.after(async () => {
    await server.close();
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  });
  let { base } = server;
  const host = browser();
  const create = { tab: host.tab, board: 'custom', name: '房主' };
  const lineup = ['villager', 'villager', 'wolf', 'wolfKing', 'seer'];
  assert.equal((await fetch(`${base}/create/custom`)).status, 200);
  for (const invalid of [null, [], ['wolf', 'seer', 'seer', 'villager'], ['wolf', 'seer', 'thief', 'villager'],
    ['wolf', 'villager'], ['wolf', 'guard', 'dreamer', 'villager'], [...lineup, ...Array(8).fill('villager')]]) {
    const result = await json(base, '/api/rooms', host, { ...create, lineup: invalid }, 400);
    assert.equal(result.code, 'LINEUP');
  }
  const { code } = await json(base, '/api/rooms', host, { ...create, lineup }, 201);
  const retry = await json(base, '/api/rooms', host, { ...create, lineup: ['wolf', 'seer', 'villager'] }, 201);
  assert.equal(retry.code, code);
  const status = await json(base, `/api/rooms/${code}`);
  assert.deepEqual(status.lineup, lineup);
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
    assert.ok(room.seats.every(seat => !Object.hasOwn(seat, 'assignment')));
    await action(base, code, participant, { type: 'acknowledge' });
    return assignment;
  }));
  assert.deepEqual(assignments.map(card => card.role).sort(), [...lineup].sort());
  await action(base, code, spectator, { type: 'reveal' }, 403);
  await server.close();
  server = await start(path, clock, matchRules);
  base = server.base;
  const resumed = await roomApi(base, code, host, 'resume');
  assert.deepEqual(resumed.lineup, lineup);
  assert.equal(resumed.canStart, true);
  assert.deepEqual((await action(base, code, host, { type: 'reveal' })).assignment, assignments[0]);
  await action(base, code, host, deal);
  await action(base, code, host, { type: 'match-start' });
  const kingIndex = assignments.findIndex(card => card.role === 'wolfKing');
  const kingView = await roomApi(base, code, participants[kingIndex], 'sync');
  assert.equal(kingView.match.actions[0].action, 'knife');
  assert.ok(!kingView.match.actions[0].options.includes(kingIndex + 1));
  assert.equal((await roomApi(base, code, spectator, 'sync')).match.self, undefined);
  const hostMatch = (await roomApi(base, code, host, 'sync')).match;
  const abandoned = await action(base, code, host, { type: 'match-abandon', matchId: hostMatch.canAbandon });
  const { matchId, window } = abandoned.room.match;
  const rematch = await action(base, code, host, { type: 'match-choice', matchId, window, kind: 'rematch' });
  assert.deepEqual(rematch.room.lineup, lineup);
  assert.equal(rematch.room.seats.length, lineup.length);
  assert.equal(rematch.room.canDeal, true);
});

for (const board of ['mechanical', 'classic', 'thief']) {
  test(`${board} completes an account-free 12-seat deal and private acknowledgement`, async t => {
    const { base, close } = await start();
    t.after(close);
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
    const first = await action(base, code, host, request);
    assert.equal(first.room.state, 'dealt');
    assert.doesNotMatch(JSON.stringify(first), /assignment|extra|token|receipts/);
    assert.equal((await action(base, code, host, request)).room.state, 'dealt');
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
    const drawn = assignments.find(card => card.role === 'thief')?.extra?.[0];
    const expected = buildDeck(board, () => thiefDraw.indexOf(drawn));
    assert.deepEqual(assignments.map(card => card.role).sort(), expected.map(card => card.role).sort());
    assert.equal(assignments.reduce((count, card) => count + 1 + (card.extra?.length ?? 0), 0), board === 'thief' ? 14 : 12);
    assert.equal((await roomApi(base, code, host, 'sync')).state, 'ready');
    assert.equal((await roomApi(base, code, browser(), 'resume', {}, 401)).code, 'SESSION_ENDED');
  });
}

test('seat claims serialize, and host removal revokes the old credential', async t => {
  const { base, close } = await start();
  t.after(close);
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
  const hostView = await roomApi(base, code, host, 'sync');
  const winner = hostView.seats[0].id === joined.self.id ? first : second;
  const other = winner === first ? second : first;
  const command = { type: 'remove', target: hostView.seats[0].id };
  assert.equal((await action(base, code, other, command, 403)).code, 'HOST_ONLY');
  assert.equal((await action(base, code, host, command)).room.seats[0], null);
  assert.equal((await roomApi(base, code, winner, 'resume', {}, 401)).code, 'SESSION_ENDED');
  assert.equal((await roomApi(base, code, winner, 'join', { name: '新昵称' }, 401)).code, 'SESSION_ENDED');
  assert.equal((await action(base, code, other, { type: 'seat', seat: 1 })).room.self.seat, 1);
});

function photo(color) {
  const data = Buffer.alloc(128 * 128 * 4, color);
  return jpeg.encode({ width: 128, height: 128, data }, 80).data.toString('base64');
}

test('room avatars are optional and follow the guest on edit, reconnect and removal', async t => {
  const { base, close } = await start();
  t.after(close);
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

test('a concurrent removal and deal cannot both change the roster', async t => {
  const { base, close } = await start();
  t.after(close);
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
});

test('the same private assignment and acknowledgement survive a restart and tab takeover', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'werewolf-test-'));
  const path = join(directory, 'room.sqlite');
  let server = await start(path);
  t.after(async () => {
    await server.close();
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  });
  const { code, host } = await setup(server.base, 'thief', photo(45));
  const hostAvatar = (await roomApi(server.base, code, host, 'sync')).self.avatar;
  const participants = await fill(server.base, code, host);
  await action(server.base, code, host, { type: 'deal' });
  const cards = await Promise.all(participants.map(person => action(server.base, code, person, { type: 'reveal' })));
  const index = cards.findIndex(result => result.assignment.role === 'thief');
  assert.notEqual(index, -1);
  const original = participants[index];
  await action(server.base, code, original, { type: 'acknowledge' });
  const oldBoot = (await json(server.base, '/healthz')).boot;
  await server.close();
  server = await start(path);
  assert.notEqual((await json(server.base, '/healthz')).boot, oldBoot);
  const replacement = { token: original.token, tab: randomUUID() };
  const recovered = await roomApi(server.base, code, replacement, 'resume');
  assert.equal(recovered.self.seat, index + 1);
  assert.equal(recovered.self.acknowledged, true);
  assert.equal(recovered.self.host, index === 0);
  assert.equal((await roomApi(server.base, code, original, 'sync', {}, 409)).code, 'TAKEN_OVER');
  assert.deepEqual((await action(server.base, code, replacement, { type: 'reveal' })).assignment, cards[index].assignment);
  const hostReplacement = { token: host.token, tab: randomUUID() };
  const hostView = await roomApi(server.base, code, hostReplacement, 'resume');
  assert.equal(hostView.self.host, true);
  assert.equal(hostView.self.avatar, hostAvatar);
  assert.equal((await fetch(new URL(hostAvatar, server.base))).status, 200);
});

test('room expires after 24 hours without a connected player', async t => {
  let now = Date.now();
  const { base, close } = await start(':memory:', () => now);
  t.after(close);
  const { code, host } = await setup(base, 'classic');
  await roomApi(base, code, host, 'disconnect');
  now += 24 * 60 * 60 * 1000;
  assert.equal((await roomApi(base, code, host, 'resume', {}, 404)).code, 'ROOM_GONE');
});

test('M2 launch gates, private choices, and their receipts survive the room server restarting', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'werewolf-match-'));
  const path = join(directory, 'room.sqlite');
  const fixtureRules = {
    nightChoices: match => [null, ...match.night.alive],
    applyNightChoice(match, player, kind, target) {
      assert.equal(kind, 'knife');
      match.night.knife = target;
      return true;
    },
  };
  let server = await start(path, Date.now, fixtureRules);
  t.after(async () => {
    await server.close();
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  });
  const { code, host } = await setup(server.base, 'mechanical');
  assert.equal((await action(server.base, code, host, { type: 'match-start' }, 409)).code, 'NOT_READY');
  const players = await fill(server.base, code, host);
  await action(server.base, code, host, { type: 'deal' });
  const cards = await Promise.all(players.map(async person => {
    const { assignment } = await action(server.base, code, person, { type: 'reveal' });
    await action(server.base, code, person, { type: 'acknowledge' });
    return assignment.role;
  }));
  const guard = players[cards.indexOf('guard')];
  const outsider = players[cards.findIndex((role, index) => role === 'villager' && index !== 0)];
  assert.equal((await action(server.base, code, outsider, { type: 'match-start' }, 403)).code, 'HOST_ONLY');
  await roomApi(server.base, code, outsider, 'disconnect');
  assert.equal((await action(server.base, code, host, { type: 'match-start' }, 409)).code, 'NOT_READY');
  await roomApi(server.base, code, outsider, 'sync');
  await action(server.base, code, host, { type: 'match-start' });
  const waiting = (await roomApi(server.base, code, outsider, 'sync')).match;
  assert.equal(waiting.phase, 'night');
  assert.equal(waiting.actions, undefined);
  assert.equal(waiting.window, undefined);
  const pending = (await roomApi(server.base, code, guard, 'sync')).match;
  assert.equal(pending.self.nightAction.kind, 'guard');
  assert.deepEqual(pending.actions.map(item => item.action), ['guard']);
  const command = { type: 'match-choice', matchId: pending.matchId, window: pending.window, kind: 'night-action', choice: 1 };
  assert.equal((await action(server.base, code, outsider, command, 409)).code, 'MATCH_ACTION');
  await server.close();
  server = await start(path, Date.now, fixtureRules);
  const replacement = { ...guard, tab: randomUUID() };
  const restored = (await roomApi(server.base, code, replacement, 'resume')).match;
  assert.equal(restored.window, pending.window);
  assert.deepEqual(restored.actions, pending.actions);
  assert.equal((await action(server.base, code, guard, command, 409)).code, 'TAKEN_OVER');
  const id = randomUUID();
  const first = await action(server.base, code, replacement, { ...command, id });
  assert.equal(first.room.match.self.nightAction, undefined);
  assert.deepEqual(await action(server.base, code, replacement, { ...command, id }), first);
  assert.equal((await action(server.base, code, replacement, { ...command, id, choice: 2 }, 409)).code, 'ACTION_ID');
  assert.equal((await action(server.base, code, replacement, command, 409)).code, 'MATCH_ACTION');
  const knife = (await roomApi(server.base, code, players[cards.indexOf('wolf')], 'sync')).match;
  assert.equal(knife.actions[0].action, 'knife');
  assert.notEqual(knife.window, pending.window);
});

function spectatorTest(name, run, { persistent = false } = {}) {
  test(name, async () => {
    const directory = persistent ? mkdtempSync(join(tmpdir(), 'werewolf-spectator-')) : null;
    const path = directory ? join(directory, 'room.sqlite') : ':memory:';
    let server;
    async function restart({ clock, matchRules }) {
      await server?.close();
      server = await start(path, clock, matchRules);
      return server.base;
    }
    try {
      await run(restart);
    } finally {
      await server?.close();
      if (directory) rmSync(directory, { recursive: true });
    }
  });
}

spectatorTest('spectators survive the deal and a replacement reviews the existing role before kickoff', async start => {
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

spectatorTest('host approval atomically hands off an offline seat and its private match action', async start => {
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
  for (const player of players.slice(3)) await choose(player, (await sync(player)).match, 'vote', null);
  const published = (await sync(remaining)).match.history.find(event => event.kind === 'sheriff-vote');
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
}, { persistent: true });
