import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDeck } from '../server/deal.js';
import { matchRules } from '../server/match-rules.js';
import { createRooms, tokenKey } from '../server/rooms.js';
import { openStore } from '../server/store.js';

// Start from a ready, deterministically dealt room. Each request uses the seat's own session.
function table(t, board, lineup, { persistent = false, customRules } = {}) {
  let now = Date.now();
  const code = 'ABCDEF';
  const dir = persistent ? mkdtempSync(join(tmpdir(), 'werewolf-narration-')) : null;
  const path = dir ? join(dir, 'room.sqlite') : ':memory:';
  let store = openStore(path);
  let rooms = createRooms(store, () => now, matchRules);
  t.after(() => {
    store.close();
    if (dir) rmSync(dir, { recursive: true });
  });

  function guest(seat, assignment) {
    const token = randomBytes(32).toString('hex');
    return { token, record: { id: randomUUID(), name: seat ? `玩家${seat}` : '观众', seat,
      key: tokenKey(token), tab: randomUUID(), lastSeen: now, receipts: [],
      ...(seat ? { assignment, revealed: true, acknowledged: true } : { spectator: true }) } };
  }
  const players = buildDeck(board, () => 1, lineup).map((assignment, i) => guest(i + 1, assignment));
  const role = id => players.find(player => player.record.assignment.role === id);
  const host = role('villager');
  const spectator = guest(null);
  store.create({ code, board, ...(board === 'custom' ? { lineup, customRules, sheriffMode: 'none' } : {}), hostId: host.record.id, dealt: true,
    guests: [...players, spectator].map(player => player.record), expiresAt: now + 86_400_000 }, host.record.key, now);

  function act(player, type, details = {}) {
    return rooms.action(code, player.token, player.record.tab, { id: randomUUID(), type, ...details }).room.match;
  }
  function poll(player, seen) {
    return rooms.sync(code, player.token, player.record.tab, { seenNightCue: seen?.nightCue }).match;
  }
  function play(player, kind, choice) {
    const { matchId, window } = poll(player);
    return act(player, 'match-choice', { matchId, window, kind, choice });
  }
  function elapse() { now += 1_000_000; }
  function nextCue(seen, narrator = host) {
    elapse();
    return poll(narrator, seen);
  }
  function restart() {
    store.close();
    store = openStore(path);
    rooms = createRooms(store, () => now, matchRules);
  }
  return { players, host, role, spectator, act, poll, play, elapse, nextCue, restart };
}

function assertCue(view, round, role) {
  assert.deepEqual(view.nightCue, { matchId: view.canAbandon, round, role });
}

test('only the current host can advance an observed cue, and an accepted late choice survives restart and retry', t => {
  const { host, role, players, spectator, act, poll, play, elapse, restart } =
    table(t, 'custom', ['guard', 'wolf', 'seer', 'villager', 'villager'], { persistent: true });
  const successor = players.find(player => player !== host && player.record.assignment.role === 'villager');
  const guard = role('guard');
  const wolf = role('wolf');
  const startId = randomUUID();
  const first = act(host, 'match-start', { id: startId, nightNarration: true });
  assert.equal(first.nightNarration, true);
  assertCue(first, 1, 'guard');
  assert.equal(first.window, undefined);
  assert.deepEqual(act(host, 'match-start', { id: startId, nightNarration: true }), first);
  assert.throws(() => act(host, 'match-start', { id: startId, nightNarration: false }), { code: 'ACTION_ID' });

  for (const player of [guard, wolf, spectator]) {
    const view = poll(player);
    assert.equal(view.nightNarration, undefined);
    assert.equal(view.nightCue, undefined);
  }
  const { matchId, window } = poll(guard);
  const command = { id: randomUUID(), matchId, window, kind: 'night-action', choice: guard.record.seat };
  elapse();
  assert.deepEqual(poll(host, first), first); // No timeout may take away the Guard's choice.
  act(guard, 'match-choice', command);
  restart();
  assert.equal(act(guard, 'match-choice', command).actions, undefined);
  assert.throws(() => act(guard, 'match-choice', { ...command, id: randomUUID() }), { code: 'MATCH_ACTION' });
  assert.deepEqual(poll(host), first);
  poll(successor);
  assert.equal(act(host, 'host-transfer', { target: successor.record.id }).nightCue, undefined);
  assert.deepEqual(poll(successor).nightCue, first.nightCue);

  elapse();
  assert.equal(poll(host, first).nightCue, undefined);
  assert.equal(poll(spectator, first).actions, undefined);
  assert.equal(poll(wolf).actions, undefined);
  assert.deepEqual(poll(successor).nightCue, first.nightCue);
  assert.deepEqual(poll(successor, { nightCue: { ...first.nightCue, matchId: randomUUID() } }).nightCue, first.nightCue);
  const wolfCue = poll(successor, first);
  assertCue(wolfCue, 1, 'wolf');
  assert.equal(poll(wolf).actions[0].action, 'knife');
  play(wolf, 'night-action', null);
  elapse();
  assert.deepEqual(poll(successor, first).nightCue, wolfCue.nightCue);
  assert.equal(poll(successor, wolfCue).nightCue.role, 'seer');
  const result = act(successor, 'match-abandon', { matchId });
  assert.equal(result.phase, 'finished');
  assert.equal(result.nightCue, undefined);
});

test('a no-knife first night calls the wolves for private recognition and preserves their teammates at dawn', t => {
  const { host, role, act, poll, play, nextCue } = table(t, 'custom', ['wolf', 'wolfKing', 'villager', 'villager'], {
    customRules: { victoryMode: 'town', firstNightKnife: 'disabled' },
  });
  const wolf = role('wolf');
  const king = role('wolfKing');
  const opening = act(host, 'match-start', { nightNarration: true });
  assertCue(opening, 1, 'wolf');
  assert.equal(opening.self.teammates, undefined);
  assert.deepEqual(poll(wolf).actions, [{ kind: 'night-action', action: 'wolf-recognition', options: ['confirm'] }]);
  assert.throws(() => play(wolf, 'night-action', host.record.seat), { code: 'MATCH_ACTION' });
  play(wolf, 'night-action', 'confirm');
  assert.deepEqual(poll(host, opening), opening);

  const dawn = nextCue(opening);
  assert.equal(dawn.phase, 'dawn');
  assert.equal(dawn.nightCue, undefined);
  assert.equal(dawn.self.teammates, undefined);
  assert.deepEqual(poll(king).self.teammates, [wolf.record.seat]);
});

test('a custom second night still calls a depleted Poisoner and a dead Seer', t => {
  const { host, role, players, spectator, act, poll, play, nextCue } =
    table(t, 'custom', ['wolf', 'poisoner', 'seer', 'hunter', 'villager', 'villager']);
  const seer = role('seer');
  const poisoner = role('poisoner');
  const victim = players.at(-1);
  let view = act(host, 'match-start', { nightNarration: true });
  for (const [id, choice] of [['wolf', seer.record.seat], ['poisoner', victim.record.seat],
    ['seer', role('wolf').record.seat], ['hunter', 'confirm']]) {
    assertCue(view, 1, id);
    play(role(id), 'night-action', choice);
    assert.deepEqual(poll(host, view), view);
    view = nextCue(view);
  }
  assert.equal(view.phase, 'dawn');
  assert.equal(view.nightCue, undefined);
  view = play(host, 'publish-night');
  assert.deepEqual(view.departed.toSorted(), [seer.record.seat, victim.record.seat].toSorted());
  while (['last-words', 'discussion'].includes(view.phase)) view = play(host, 'finish-speech');
  play(host, 'open-exile');
  for (const voter of players.filter(player => player !== seer && player !== victim)) play(voter, 'vote', null);
  view = play(host, 'next-night');
  assertCue(view, 2, 'wolf');
  play(role('wolf'), 'night-action', null);
  for (const id of ['poisoner', 'seer']) {
    view = nextCue(view);
    assertCue(view, 2, id);
    assert.equal(view.window, undefined);
    assert.equal(poll(role(id)).actions, undefined);
    assert.equal(poll(spectator).nightCue, undefined);
    assert.deepEqual(poll(host, view), view);
  }
  view = nextCue(view);
  assertCue(view, 2, 'hunter');
  assert.equal(poll(role('hunter')).actions[0].action, 'gun-check');
});

test('Thief night one calls the missing power and omits the ordinary knife regardless of the private form', t => {
  const { host, role, act, poll, play, nextCue } = table(t, 'thief');
  const thief = role('thief');
  assert.equal(thief.record.assignment.extra[0], 'dreamer');
  let view = act(host, 'match-start', { nightNarration: true });
  for (const [id, choice] of [['thief', 'common'], ['dreamer'], ['poisoner', null],
    ['medium', thief.record.seat], ['hunter', 'confirm']]) {
    assertCue(view, 1, id);
    assert.equal(poll(role('wolf')).actions, undefined);
    if (id === 'dreamer') assert.equal(poll(thief).actions, undefined);
    else play(role(id), 'night-action', choice);
    view = nextCue(view);
  }
  assert.equal(view.phase, 'dawn');
});

test('the Mechanical Wolf keeps its own public call after copying the Medium', t => {
  const { host, role, players, act, poll, play, nextCue } = table(t, 'mechanical');
  const mechanical = role('mechanical');
  const medium = role('medium');
  let view = act(host, 'match-start', { nightNarration: true });
  for (const [id, choice] of [['guard', null], ['wolf', null], ['witch', null],
    ['mechanical', medium.record.seat], ['medium', mechanical.record.seat], ['hunter', 'confirm']]) {
    assertCue(view, 1, id);
    play(role(id), 'night-action', choice);
    view = nextCue(view);
  }
  play(host, 'open-election');
  for (const player of players) play(player, 'candidacy', false);
  view = play(host, 'publish-night');
  while (view.phase === 'discussion') view = play(host, 'finish-speech');
  play(host, 'open-exile');
  for (const player of players) play(player, 'vote', null);
  view = play(host, 'next-night');
  for (const id of ['guard', 'wolf', 'witch']) {
    assertCue(view, 2, id);
    play(role(id), 'night-action', null);
    view = nextCue(view);
  }
  assertCue(view, 2, 'mechanical');
  assert.equal(poll(mechanical).actions[0].action, 'medium');
  assert.equal(poll(medium).actions, undefined);
  assert.equal(view.self.copied, undefined);
  play(mechanical, 'night-action', medium.record.seat);
  assertCue(nextCue(view), 2, 'medium');
  assert.equal(poll(medium).actions[0].action, 'medium');
});
