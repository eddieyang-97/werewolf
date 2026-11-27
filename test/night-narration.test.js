import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDeck } from '../server/deal.js';
import { matchRules } from '../server/match-rules.js';
import { nightChoiceDuration } from '../server/night-actions.js';
import { createRooms, tokenKey } from '../server/rooms.js';
import { openStore } from '../server/store.js';

// Start from a ready, deterministically dealt room. Each request uses the seat's own session.
function table(t, board, lineup, { persistent = false, customRules, bots = [] } = {}) {
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
      ...(bots.includes(assignment?.role) ? { bot: true } : { key: tokenKey(token), tab: randomUUID(), lastSeen: now, receipts: [] }),
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
  function poll(player, seen, nightCuePlaybackComplete = true) {
    return rooms.sync(code, player.token, player.record.tab, { seenNightCue: seen?.nightCue, nightCuePlaybackComplete }).match;
  }
  function play(player, kind, choice) {
    const { matchId, window } = poll(player);
    return act(player, 'match-choice', { matchId, window, kind, choice });
  }
  function elapse(milliseconds = nightChoiceDuration, online = players) {
    while (milliseconds > 0) {
      const tick = Math.min(milliseconds, 5_000);
      now += tick;
      milliseconds -= tick;
      for (const player of online) if (!player.record.bot) poll(player);
    }
  }
  function nextCue(seen, narrator = host) {
    poll(narrator, seen);
    elapse();
    return poll(narrator, seen);
  }
  function disconnect(player) {
    rooms.disconnect(code, player.token, player.record.tab);
  }
  function restart() {
    store.close();
    store = openStore(path);
    rooms = createRooms(store, () => now, matchRules);
  }
  const state = () => store.room(code, now, room => ({ value: room.match }));
  return { players, host, role, spectator, act, poll, play, elapse, nextCue, restart, disconnect, state };
}

function assertCue(view, round, role) {
  assert.deepEqual(view.nightCue, { matchId: view.canAbandon, round, role });
}

test('only the current host can advance an observed cue, and an accepted choice survives restart and retry', t => {
  const { host, role, players, spectator, act, poll, play, elapse, nextCue, restart } =
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
  assert.deepEqual(poll(host, first), first);
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
  const wolfCue = nextCue(first, successor);
  assertCue(wolfCue, 1, 'wolf');
  assert.equal(poll(wolf).actions[0].action, 'knife');
  play(wolf, 'night-action', null);
  elapse();
  assert.deepEqual(poll(successor, first).nightCue, wolfCue.nightCue);
  assert.equal(nextCue(wolfCue, successor).nightCue.role, 'seer');
  const result = act(successor, 'match-abandon', { matchId });
  assert.equal(result.phase, 'finished');
  assert.equal(result.nightCue, undefined);
});

test('a no-knife first night waits for private wolf confirmation without a narrated timeout', t => {
  const { host, role, act, poll, play, elapse } = table(t, 'custom', ['wolf', 'wolfKing', 'villager', 'villager'], {
    customRules: { victoryMode: 'town', firstNightKnife: 'disabled' },
  });
  const wolf = role('wolf');
  const king = role('wolfKing');
  const opening = act(host, 'match-start', { nightNarration: true });
  assertCue(opening, 1, 'wolf');
  assert.equal(opening.self.teammates, undefined);
  assert.deepEqual(poll(wolf).actions, [{
    kind: 'night-action', action: 'wolf-recognition', options: ['confirm'],
  }]);
  poll(host, opening);
  elapse(nightChoiceDuration * 3);
  assert.deepEqual(poll(host, opening), opening);
  assert.equal(poll(king).actions[0].action, 'wolf-recognition');
  assert.throws(() => play(wolf, 'night-action', host.record.seat), { code: 'MATCH_ACTION' });
  assert.throws(() => play(host, 'night-action', 'confirm'), { code: 'MATCH_ACTION' });
  play(wolf, 'night-action', 'confirm');
  assert.deepEqual(poll(host, opening, false), opening);
  assert.equal(poll(king).actions, undefined);

  const dawn = poll(host, opening);
  assert.equal(dawn.phase, 'dawn');
  assert.equal(dawn.nightCue, undefined);
  assert.equal(dawn.self.teammates, undefined);
  assert.deepEqual(poll(king).self.teammates, [wolf.record.seat]);
});

test('late delivery and unfinished speech cannot use up the first cue window', t => {
  const { host, role, act, poll, play, elapse } =
    table(t, 'custom', ['guard', 'wolf', 'seer', 'villager']);
  const first = act(host, 'match-start', { nightNarration: true });
  play(role('guard'), 'night-action', null);

  elapse(nightChoiceDuration * 3);
  assertCue(poll(host, first, false), 1, 'guard');
  elapse(nightChoiceDuration * 3);
  assertCue(poll(host, first, false), 1, 'guard');
  assertCue(poll(host, first), 1, 'guard');
  elapse(nightChoiceDuration - 1);
  assertCue(poll(host, first), 1, 'guard');
  elapse(1);
  assertCue(poll(host, first), 1, 'wolf');
});

test('bots take their narrated turns without closing a cue or taking a shared choice from a human', t => {
  const { host, role, act, poll, play, nextCue, state } = table(t, 'custom',
    ['guard', 'wolf', 'wolfKing', 'seer', 'hunter', 'villager'], { bots: ['guard', 'wolf', 'seer'] });
  const wolfKing = role('wolfKing');
  const guard = act(host, 'match-start', { nightNarration: true });
  assertCue(guard, 1, 'guard');
  assert.equal(state().night.step, null); // The bot acted in the start transaction.

  const wolf = nextCue(guard);
  assertCue(wolf, 1, 'wolf');
  assert.equal(poll(wolfKing).actions[0].action, 'knife');
  play(wolfKing, 'night-action', null);
  assertCue(poll(host), 1, 'wolf');

  const seer = nextCue(wolf);
  assertCue(seer, 1, 'seer');
  assert.equal(state().night.step, null); // The newly opened cue was processed in the same sync.
  const botSeer = state().players.find(player => player.seat === role('seer').record.seat);
  assert.equal(botSeer.privateEvents.length, 1);
  assert.equal(botSeer.privateEvents[0].kind, 'seer');
  assert.deepEqual(seer.self.inspections, []);

  const hunter = nextCue(seer);
  assertCue(hunter, 1, 'hunter');
  play(role('hunter'), 'night-action', 'confirm');
  assert.equal(nextCue(hunter).phase, 'dawn');
});

test('an offline unrelated seat pauses the window, and an unanswered required choice falls back at expiry', t => {
  const { host, role, act, poll, nextCue, elapse, disconnect, players } =
    table(t, 'custom', ['wolf', 'seer', 'villager', 'villager']);
  const seer = role('seer');
  const villager = players.find(player => player !== host && player.record.assignment.role === 'villager');
  const first = act(host, 'match-start', { nightNarration: true });
  const cue = nextCue(first);
  assertCue(cue, 1, 'seer');
  const { matchId, window, actions: [action] } = poll(seer);

  poll(host, cue);
  elapse(8_000);
  const running = poll(seer).actions[0].nightTimer;
  assert.equal(running.deadline - running.serverNow, nightChoiceDuration - 8_000);
  assert.equal(poll(villager).actions, undefined);
  disconnect(villager);
  elapse(nightChoiceDuration * 3, players.filter(player => player !== villager));
  assertCue(poll(host, cue), 1, 'seer');
  assert.equal(poll(seer).window, window);
  assert.deepEqual(poll(seer).actions[0].nightTimer, { remaining: nightChoiceDuration - 8_000 });
  poll(villager);
  poll(host, cue);
  elapse(nightChoiceDuration - 8_000 - 1);
  assertCue(poll(host, cue), 1, 'seer');
  const finalTick = poll(seer).actions[0].nightTimer;
  assert.equal(finalTick.deadline - finalTick.serverNow, 1);
  elapse(1);
  assert.equal(poll(seer).actions, undefined);
  assert.equal(poll(seer).window, undefined);
  assert.throws(() => act(seer, 'match-choice', { matchId, window, kind: 'night-action', choice: action.options[0] }),
    { code: 'MATCH_ACTION' });
  const dawn = poll(host, cue);
  assert.equal(dawn.phase, 'dawn');
  assert.deepEqual(dawn.self.inspections, []);
  const [result] = poll(seer).self.inspections;
  assert.equal(result.kind, 'seer');
  assert.ok(action.options.includes(result.seat));
  assert.equal(poll(seer).self.inspections.length, 1);
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

for (const copied of ['medium', 'villager']) test(`the Mechanical Wolf cue has the same duration after copying ${copied}`, t => {
  const { host, role, players, act, poll, play, nextCue, elapse } = table(t, 'mechanical');
  const mechanical = role('mechanical');
  const medium = role('medium');
  let view = act(host, 'match-start', { nightNarration: true });
  for (const [id, choice] of [['guard', null], ['wolf', null], ['witch', null],
    ['mechanical', role(copied).record.seat], ['medium', mechanical.record.seat], ['hunter', 'confirm']]) {
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
  assert.equal(poll(mechanical).actions?.[0].action, copied === 'medium' ? 'medium' : undefined);
  assert.equal(poll(medium).actions, undefined);
  assert.equal(view.self.copied, undefined);
  poll(host, view);
  elapse(nightChoiceDuration - 1);
  assertCue(poll(host, view), 2, 'mechanical');
  elapse(1);
  assertCue(poll(host, view), 2, 'medium');
  assert.equal(poll(mechanical).self.inspections.length, copied === 'medium' ? 1 : 0);
  assert.equal(poll(medium).actions[0].action, 'medium');
});
