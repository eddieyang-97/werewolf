import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeck } from '../server/deal.js';
import { abandonMatch, controllerView, executeMatchChoice, startMatch } from '../server/match-controller.js';
import { matchRules } from '../server/match-rules.js';
import { isWolf, playerAt } from '../server/match-state.js';

function createRoom(board, draw, lineup) {
  return {
    board, hostId: '1', dealt: true,
    guests: buildDeck(board, () => draw, lineup).map((assignment, index) => ({
      id: String(index + 1), seat: index + 1, assignment, revealed: true, acknowledged: true,
    })),
  };
}

for (const lastWolf of [false, true]) {
  test(`custom Wolf King exile ${lastWolf ? 'ends the match before the shot' : 'grants a private shot after last words'}`, () => {
    const room = createRoom('custom', undefined, ['wolfKing', 'seer', 'medium', 'villager', 'villager',
      ...(lastWolf ? [] : ['wolf'])]);
    const [king, seer, medium, host, victim, wolf] = room.guests;
    room.hostId = host.id;
    const play = (guest, kind, choice) => {
      const action = controls(room, guest).actions?.find(entry => entry.kind === kind);
      assert.ok(action, `${kind} must be available to seat ${guest.seat} in ${room.match.phase}`);
      choose(room, guest, action, choice);
    };
    startMatch(room, matchRules);
    const { match } = room;
    const knife = controls(room, king);
    assert.equal(knife.actions[0].action, 'knife');
    assert.ok(!knife.actions[0].options.includes(king.seat));
    assert.equal(controls(room, host).self.teammates, undefined);
    assert.equal(executeMatchChoice(room, king, { matchId: knife.matchId, window: knife.window,
      kind: 'night-action', choice: king.seat }, matchRules), false);
    if (wolf) {
      assert.deepEqual(controls(room, wolf).self.teammates, [king.seat]);
      assert.deepEqual(knife.self.teammates, [wolf.seat]);
      assert.ok(!controls(room, wolf).actions[0].options.includes(king.seat));
    }
    play(king, 'night-action', null);
    play(seer, 'night-action', king.seat);
    play(medium, 'night-action', king.seat);
    assert.equal(controls(room, seer).self.inspections[0].team, 'wolves');
    assert.equal(controls(room, medium).self.inspections[0].claws, 2);
    assert.deepEqual(controls(room, host).self.inspections, []);
    assert.equal(controls(room, king).self.canSelfDestruct, true);
    play(host, 'open-election');
    for (const guest of room.guests) play(guest, 'candidacy', false);
    play(host, 'publish-night');
    while (match.phase === 'discussion') play(host, 'finish-speech');
    play(host, 'open-exile');
    for (const guest of room.guests) play(guest, 'vote', guest === king ? null : king.seat);
    if (lastWolf) {
      assert.equal(match.winner, 'village');
      assert.equal(controls(room, king).actions, undefined);
    } else {
      assert.equal(match.phase, 'last-words');
      play(host, 'finish-speech');
      assert.equal(controls(room, host).phase, 'death-resolution');
      assert.equal(controls(room, host).actions, undefined);
      assert.equal(controls(room, king).actions[0].role, 'wolfKing');
      play(king, 'shoot', victim.seat);
      assert.equal(match.phase, 'last-words');
      assert.equal(controls(room, host).speaker, victim.seat);
      assert.equal(match.history.at(-1).kind, 'shot');
      play(host, 'finish-speech');
      play(host, 'next-night');
      assert.deepEqual(match.night.wolves, [wolf.seat]);
    }
  });
}

function controls(room, guest) {
  return controllerView(room.match, guest.seat, room.hostId === guest.id, matchRules);
}

function choose(room, guest, action, choice, now) {
  const { matchId, window } = controls(room, guest);
  assert.equal(executeMatchChoice(room, guest, { matchId, window, kind: action.kind, choice }, matchRules, now), true);
}

function playAction(room, guest, kind, choice) {
  const action = controls(room, guest).actions?.find(entry => entry.kind === kind);
  assert.ok(action, `${kind} must be available to seat ${guest.seat} in ${room.match.phase}`);
  choose(room, guest, action, choice);
}

test('host recovery changes the badge and formal departures only at ordinary day checkpoints', () => {
  const room = createRoom('custom', undefined, ['wolfKing', 'wolf', 'seer', 'hunter', 'villager', 'villager']);
  const [king, wolf, seer, hunter, originalSheriff, host] = room.guests;
  room.hostId = host.id;
  startMatch(room, matchRules);
  const { match } = room;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  const hostCommand = (kind, choice) => ({ matchId: match.id, window: match.window, kind, choice });
  const recovery = (guest, command) => executeMatchChoice(room, guest, command, matchRules);
  assert.equal(recovery(host, hostCommand('host-eliminate', wolf.seat)), false);
  play(king, 'night-action', null);
  play(seer, 'night-action', king.seat);
  play(hunter, 'night-action', 'confirm');
  play(host, 'open-election');
  assert.equal(recovery(host, hostCommand('host-eliminate', wolf.seat)), false);
  for (const guest of room.guests) play(guest, 'candidacy', guest === originalSheriff);
  play(host, 'publish-night');
  assert.equal(match.phase, 'speech-direction');
  assert.equal(match.sheriff, originalSheriff.seat);
  assert.equal(controls(room, originalSheriff).hostActions, undefined);

  const transfer = hostCommand('host-transfer-badge', hunter.seat);
  assert.equal(recovery(originalSheriff, transfer), false);
  assert.equal(recovery(host, { ...transfer, choice: originalSheriff.seat }), false);
  const staleDirection = hostCommand('direction', 1);
  assert.equal(recovery(host, transfer), true);
  assert.equal(recovery(hunter, staleDirection), false);
  assert.equal(recovery(originalSheriff, hostCommand('direction', 1)), false);
  assert.equal(controls(room, hunter).actions[0].kind, 'direction');
  assert.deepEqual(match.history.at(-1), { round: 1, phase: 'day', kind: 'badge', seat: hunter.seat });

  assert.equal(recovery(host, hostCommand('host-eliminate', hunter.seat)), true);
  assert.equal(match.sheriff, null);
  assert.equal(match.phase, 'discussion');
  assert.ok(!match.day.order.includes(hunter.seat));
  assert.equal(controls(room, wolf).departed.includes(hunter.seat), true);
  assert.equal(controls(room, wolf).roster, undefined);
  assert.equal(controls(room, hunter).actions, undefined);
  assert.equal(recovery(host, hostCommand('host-eliminate', wolf.seat)), false);
  while (match.phase === 'discussion') play(host, 'finish-speech');

  assert.equal(recovery(host, hostCommand('host-eliminate', hunter.seat)), false);
  assert.equal(recovery(host, hostCommand('host-transfer-badge', wolf.seat)), false);
  assert.equal(recovery(host, hostCommand('host-eliminate', king.seat)), true);
  assert.equal(match.phase, 'exile-open');
  assert.equal(controls(room, king).actions, undefined);
  assert.equal(recovery(host, hostCommand('host-eliminate', wolf.seat)), true);
  assert.equal(match.winner, 'village');
  assert.deepEqual(controls(room, host).departed, [king.seat, wolf.seat, hunter.seat]);
  assert.equal(match.history.at(-1).kind, 'host-elimination');
  assert.equal(controls(room, host).hostActions, undefined);
});

test('late wolves can still see their Night 1 teammates privately after recognition advances play', () => {
  const room = createRoom('custom', undefined, ['wolf', 'wolfKing', 'villager', 'villager']);
  room.customRules = { victoryMode: 'town', firstNightKnife: 'disabled' };
  room.sheriffMode = 'none';
  const [wolf, king, host] = room.guests;
  room.hostId = host.id;
  startMatch(room, matchRules);

  playAction(room, wolf, 'night-action', 'confirm');
  const lateView = controls(room, king);
  assert.equal(lateView.phase, 'dawn');
  assert.deepEqual(lateView.self.teammates, [wolf.seat]);
  assert.equal(lateView.self.nightAction, undefined);

  playAction(room, host, 'publish-night');
  assert.deepEqual(controls(room, king).self.teammates, [wolf.seat]);
  assert.equal(controls(room, host).self.teammates, undefined);
  assert.equal(controllerView(room.match, null, false, matchRules).self, undefined);

  abandonMatch(room.match);
  assert.equal(controls(room, king).self.teammates, undefined);
});

test('custom no-knife Night 1 preserves private wolf recognition and Witch self-save works on a later night', () => {
  const room = createRoom('custom', undefined, ['wolfKing', 'wolf', 'witch', 'villager', 'villager']);
  room.customRules = { firstNightKnife: 'disabled', witchSelfSave: 'allowed' };
  room.sheriffMode = 'none';
  const [king, wolf, witch, host] = room.guests;
  room.hostId = host.id;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  startMatch(room, matchRules);
  const { match } = room;
  const recognition = controls(room, king);
  assert.deepEqual(recognition.self.teammates, [wolf.seat]);
  assert.deepEqual(controls(room, wolf).self.teammates, [king.seat]);
  assert.equal(controls(room, host).self.teammates, undefined);
  assert.equal(controls(room, witch).actions, undefined);
  assert.equal(executeMatchChoice(room, king, { matchId: recognition.matchId, window: recognition.window,
    kind: 'night-action', choice: witch.seat }, matchRules), false);
  play(wolf, 'night-action', 'confirm');
  const firstNight = controls(room, witch);
  assert.equal(firstNight.self.wolfTarget, null);
  assert.ok(firstNight.actions[0].options.includes(`poison:${wolf.seat}`));
  assert.ok(!firstNight.actions[0].options.includes('save'));
  play(witch, 'night-action', null);
  play(host, 'publish-night');
  play(king, 'self-destruct');
  play(host, 'next-night');

  assert.equal(controls(room, wolf).actions[0].action, 'knife');
  play(wolf, 'night-action', witch.seat);
  const targeted = controls(room, witch);
  assert.equal(targeted.self.wolfTarget, witch.seat);
  assert.ok(targeted.actions[0].options.includes('save'));
  play(witch, 'night-action', 'save');
  assert.deepEqual(match.day.deaths, []);
  assert.equal(playerAt(match, witch.seat).used.antidote, true);
  assert.equal(playerAt(match, witch.seat).used.poison, undefined);

  play(host, 'publish-night');
  while (match.phase === 'discussion') play(host, 'finish-speech');
  play(host, 'open-exile');
  for (const guest of room.guests.filter(guest => guest !== king)) play(guest, 'vote', null);
  play(host, 'next-night');
  play(wolf, 'night-action', witch.seat);
  const spent = controls(room, witch);
  assert.equal(spent.self.wolfTarget, undefined);
  assert.ok(!spent.actions[0].options.includes('save'));
  assert.equal(executeMatchChoice(room, witch, { matchId: spent.matchId, window: spent.window,
    kind: 'night-action', choice: 'save' }, matchRules), false);
  play(witch, 'night-action', null);
  assert.equal(match.winner, 'wolves');
});

test('custom town elimination continues after the only god dies and ends on the last good death', () => {
  const room = createRoom('custom', undefined, ['wolf', 'witch', 'mixed']);
  room.customRules = { victoryMode: 'town' };
  room.sheriffMode = 'none';
  const [wolf, witch, mixed] = room.guests;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  startMatch(room, matchRules);
  play(mixed, 'night-action', wolf.seat);
  play(wolf, 'night-action', witch.seat);
  play(witch, 'night-action', null);
  assert.equal(room.match.winner, undefined);
  play(wolf, 'publish-night');
  play(wolf, 'finish-speech');
  while (room.match.phase === 'discussion') play(wolf, 'finish-speech');
  play(wolf, 'open-exile');
  play(wolf, 'vote', null);
  play(mixed, 'vote', null);
  play(wolf, 'next-night');
  play(wolf, 'night-action', mixed.seat);
  assert.equal(room.match.winner, 'wolves');
  assert.equal(room.match.phase, 'finished');
});

test('Magician redirects private actions while preserving nominated seats and the swap limit', () => {
  const room = createRoom('custom', undefined, ['magician', 'wolf', 'villager', 'witch', 'seer', 'villager', 'medium', 'wolf']);
  room.sheriffMode = 'none';
  const [magician, wolf, victim, witch, seer, host, medium] = room.guests;
  room.hostId = host.id;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  startMatch(room, matchRules);
  const { match } = room;
  const swap = controls(room, magician);
  assert.equal(swap.actions[0].action, 'swap');
  assert.equal(swap.actions[0].multiple, true);
  assert.ok(swap.actions[0].options.includes(magician.seat));
  assert.equal(controls(room, host).actions, undefined);
  for (const choice of [[wolf.seat], [wolf.seat, wolf.seat], [wolf.seat, victim.seat, magician.seat]]) {
    assert.equal(executeMatchChoice(room, magician, { matchId: swap.matchId, window: swap.window,
      kind: 'night-action', choice }, matchRules), false);
  }
  play(magician, 'night-action', [wolf.seat, victim.seat]);
  play(wolf, 'night-action', wolf.seat);
  assert.equal(controls(room, witch).self.wolfTarget, wolf.seat);
  assert.equal(controls(room, host).self.wolfTarget, undefined);
  play(witch, 'night-action', null);
  play(seer, 'night-action', victim.seat);
  play(medium, 'night-action', wolf.seat);
  assert.deepEqual(controls(room, seer).self.inspections, [{ kind: 'seer', round: 1, seat: victim.seat, team: 'wolves' }]);
  assert.deepEqual(controls(room, medium).self.inspections, [{ kind: 'medium', round: 1, seat: wolf.seat, role: 'villager' }]);
  assert.equal(playerAt(match, wolf.seat).death, undefined);
  assert.deepEqual(match.day.deaths.map(({ seat }) => seat), [victim.seat]);
  play(host, 'publish-night');
  while (['last-words', 'discussion'].includes(match.phase)) play(host, 'finish-speech');
  play(host, 'open-exile');
  for (const guest of room.guests.filter(guest => guest !== victim)) play(guest, 'vote', null);
  play(host, 'next-night');
  const nextSwap = controls(room, magician).actions[0];
  assert.equal(nextSwap.action, 'swap');
  assert.ok(!nextSwap.options.includes(wolf.seat));
  assert.ok(nextSwap.options.includes(witch.seat));
  play(magician, 'night-action', []);
  assert.equal(match.night.swap, undefined);
});

test('a night charm follows a poisoned Wolf Beauty and blocks the Hunter gun', () => {
  const room = createRoom('custom', undefined, ['wolfBeauty', 'wolf', 'witch', 'hunter', 'guard', 'villager', 'villager']);
  room.sheriffMode = 'none';
  const [beauty, wolf, witch, hunter, guard, host] = room.guests;
  room.hostId = host.id;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  startMatch(room, matchRules);
  const { match } = room;
  play(guard, 'night-action', hunter.seat);
  const knife = controls(room, beauty);
  assert.deepEqual(knife.self.teammates, [wolf.seat]);
  assert.equal(knife.actions[0].action, 'knife');
  assert.ok(!knife.actions[0].options.includes(beauty.seat));
  play(beauty, 'night-action', null);
  assert.equal(controls(room, beauty).actions[0].action, 'charm');
  assert.equal(controls(room, host).actions, undefined);
  play(beauty, 'night-action', hunter.seat);
  play(witch, 'night-action', `poison:${beauty.seat}`);
  assert.equal(controls(room, hunter).self.nightAction.canShoot, false);
  play(hunter, 'night-action', 'confirm');
  assert.deepEqual(controls(room, host).departed, []);
  assert.equal(controls(room, beauty).self.canSelfDestruct, false);
  play(host, 'publish-night');
  assert.deepEqual(controls(room, host).departed, [beauty.seat, hunter.seat]);
  while (match.phase === 'last-words') play(host, 'finish-speech');
  assert.equal(match.phase, 'discussion');
});

test('Wolf Beauty may pick the same target after a night with no legal charm', () => {
  const room = createRoom('custom', undefined, ['wolfBeauty', 'villager', 'villager']);
  room.customRules = { victoryMode: 'town' };
  room.sheriffMode = 'none';
  const [beauty, target, victim] = room.guests;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  const nextNight = () => {
    play(beauty, 'publish-night');
    while (['last-words', 'discussion'].includes(room.match.phase)) play(beauty, 'finish-speech');
    play(beauty, 'open-exile');
    for (const guest of [beauty, target]) play(guest, 'vote', null);
    play(beauty, 'next-night');
  };
  startMatch(room, matchRules);
  play(beauty, 'night-action', victim.seat);
  play(beauty, 'night-action', target.seat);
  nextNight();
  play(beauty, 'night-action', null);
  assert.equal(room.match.phase, 'dawn');
  assert.equal(room.match.night.charm, undefined);
  nextNight();
  play(beauty, 'night-action', null);
  assert.deepEqual(controls(room, beauty).actions[0].options, [target.seat]);
});

for (const duel of [false, true]) {
  test(`Wolf Beauty's daytime charm ${duel ? 'is cancelled by a Knight duel' : 'follows exile last words'}`, () => {
    const room = createRoom('custom', undefined, ['wolfBeauty', 'wolf', 'knight', 'hunter', 'villager', 'villager']);
    room.sheriffMode = 'none';
    const [beauty, wolf, knight, hunter, host] = room.guests;
    room.hostId = host.id;
    const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
    startMatch(room, matchRules);
    const { match } = room;
    play(wolf, 'night-action', null);
    play(beauty, 'night-action', hunter.seat);
    play(hunter, 'night-action', 'confirm');
    assert.equal(controls(room, knight).actions, undefined);
    play(host, 'publish-night');
    if (duel) {
      play(knight, 'duel', beauty.seat);
      assert.equal(playerAt(match, hunter.seat).death, undefined);
      assert.equal(match.history.at(-1).kind, 'duel');
    } else {
      while (match.phase === 'discussion') play(host, 'finish-speech');
      play(host, 'open-exile');
      assert.ok(!controls(room, knight).actions.some(action => action.kind === 'duel'));
      for (const guest of room.guests) play(guest, 'vote', guest === beauty ? null : beauty.seat);
      assert.equal(match.phase, 'last-words');
      assert.equal(playerAt(match, hunter.seat).death, undefined);
      play(host, 'finish-speech');
      assert.equal(playerAt(match, hunter.seat).death.cause, 'charm');
    }
    assert.equal(match.phase, 'next-night');
  });
}

for (const lastWolf of [false, true]) {
  test(`a Knight duel against the Wolf King ${lastWolf ? 'ends play immediately' : 'allows the Wolf King to shoot'}`, () => {
    const room = createRoom('custom', undefined, ['wolfKing', 'knight', 'seer', 'villager', 'villager',
      ...(lastWolf ? [] : ['wolf'])]);
    room.sheriffMode = 'none';
    const [king, knight, seer, host] = room.guests;
    room.hostId = host.id;
    const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
    startMatch(room, matchRules);
    const { match } = room;
    play(king, 'night-action', null);
    play(seer, 'night-action', king.seat);
    play(host, 'publish-night');
    play(knight, 'duel', king.seat);
    if (lastWolf) {
      assert.equal(match.winner, 'village');
      assert.equal(controls(room, king).actions, undefined);
    } else {
      assert.equal(controls(room, king).actions[0].kind, 'shoot');
      assert.equal(controls(room, host).phase, 'death-resolution');
      play(king, 'shoot', null);
      assert.equal(match.phase, 'next-night');
      assert.equal(playerAt(match, knight.seat).used.duel, true);
    }
  });
}

test('an incorrect Knight duel against Mixed Blood has last words and resumes day play', () => {
  const room = createRoom('custom', undefined, ['knight', 'wolf', 'mixed', 'seer', 'villager']);
  const [knight, wolf, mixed, seer, host] = room.guests;
  room.hostId = host.id;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  startMatch(room, matchRules);
  const { match } = room;
  play(mixed, 'night-action', wolf.seat);
  play(wolf, 'night-action', null);
  play(seer, 'night-action', wolf.seat);
  play(host, 'open-election');
  assert.ok(!controls(room, knight).actions.some(action => action.kind === 'duel'));
  for (const guest of room.guests) play(guest, 'candidacy', false);
  play(host, 'publish-night');
  const speaker = controls(room, host).speaker;
  play(knight, 'duel', mixed.seat);
  assert.equal(match.phase, 'last-words');
  assert.equal(controls(room, host).speaker, knight.seat);
  assert.equal(playerAt(match, mixed.seat).death, undefined);
  play(host, 'finish-speech');
  if (speaker !== knight.seat) assert.equal(controls(room, host).speaker, speaker);
  while (match.phase === 'discussion') play(host, 'finish-speech');
  play(host, 'open-exile');
  assert.equal(match.phase, 'exile-vote');
  assert.ok(!match.day.ballot.voters.includes(knight.seat));
});

for (const transferBadge of [true, false]) {
  test(`a sheriff Knight's failed duel clears their nomination when the badge is ${transferBadge ? 'transferred' : 'destroyed'}`, () => {
    const room = createRoom('custom', undefined, ['knight', 'wolf', 'wolf', 'fool', 'villager', 'villager']);
    const [knight, oldTarget, newTarget, successor, host, good] = room.guests;
    room.hostId = host.id;
    const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
    startMatch(room, matchRules);
    const { match } = room;
    play(oldTarget, 'night-action', null);
    play(host, 'open-election');
    for (const guest of room.guests) play(guest, 'candidacy', guest === knight);
    play(host, 'publish-night');
    play(knight, 'direction', 1);
    while (match.phase === 'discussion') play(host, 'finish-speech');
    play(host, 'open-nomination');
    play(knight, 'nominate', [oldTarget.seat]);
    assert.equal(match.phase, 'exile-locked');
    play(knight, 'duel', good.seat);
    play(host, 'finish-speech');
    play(knight, 'badge', transferBadge ? successor.seat : null);
    assert.equal(match.phase, transferBadge ? 'nomination' : 'exile-locked');
    assert.equal(match.day.nominations, undefined);
    assert.equal(controls(room, oldTarget).self.canSelfDestruct, false);
    if (transferBadge) play(successor, 'nominate', [newTarget.seat]);
    play(host, 'open-exile');
    for (const guest of room.guests.filter(guest => guest !== knight)) {
      const target = guest === successor ? newTarget.seat : guest === host ? oldTarget.seat : null;
      play(guest, 'vote', target);
    }
    const ballot = match.history.findLast(event => event.kind === 'exile-vote').ballot;
    assert.deepEqual(ballot.groups, [
      { seat: oldTarget.seat, count: 1, voters: [host.seat] },
      { seat: newTarget.seat, count: transferBadge ? 1.5 : 1, voters: [successor.seat] },
    ]);
    assert.equal(playerAt(match, newTarget.seat).death?.cause, transferBadge ? 'exile' : undefined);
  });
}

test('a successful Knight duel settles the Masked departure before the next night', () => {
  const room = createRoom('custom', undefined, ['knight', 'wolf', 'wolf', 'masked', 'villager', 'villager']);
  room.sheriffMode = 'none';
  const [knight, wolf, , masked, host] = room.guests;
  room.hostId = host.id;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  startMatch(room, matchRules);
  const { match } = room;
  play(wolf, 'night-action', masked.seat);
  play(host, 'publish-night');
  assert.equal(playerAt(match, masked.seat).death, undefined);
  play(knight, 'duel', wolf.seat);
  assert.equal(match.phase, 'next-night');
  assert.equal(playerAt(match, masked.seat).death.time, 'delayed');
  assert.deepEqual(controls(room, host).departed, [wolf.seat, masked.seat]);
});

for (const outcome of ['shoot', 'transfer', 'last-wolf']) {
  test(`a pending Masked departure during a Wolf King duel preserves ${outcome === 'last-wolf' ? 'immediate victory' : outcome === 'shoot' ? 'shot eligibility' : 'badge eligibility'}`, () => {
    const room = createRoom('custom', undefined, ['knight', 'wolfKing', 'masked', 'villager', 'villager',
      ...(outcome === 'last-wolf' ? [] : ['wolf'])]);
    const [knight, king, masked, host] = room.guests;
    room.hostId = host.id;
    const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
    startMatch(room, matchRules);
    const { match } = room;
    play(king, 'night-action', masked.seat);
    play(host, 'open-election');
    for (const guest of room.guests) play(guest, 'candidacy', guest === king);
    play(host, 'publish-night');
    play(king, 'direction', 1);
    assert.equal(playerAt(match, masked.seat).death, undefined);
    play(knight, 'duel', king.seat);
    assert.equal(playerAt(match, masked.seat).death, undefined);
    if (outcome === 'last-wolf') {
      assert.equal(match.winner, 'village');
      assert.deepEqual(controls(room, host).departed, [king.seat]);
      assert.equal(controls(room, king).actions, undefined);
      return;
    }
    assert.deepEqual(controls(room, host).departed, [king.seat]);
    assert.ok(controls(room, king).actions.find(action => action.kind === 'shoot').options.includes(masked.seat));
    if (outcome === 'shoot') {
      play(king, 'shoot', masked.seat);
      assert.equal(controls(room, host).speaker, masked.seat);
      assert.equal(playerAt(match, masked.seat).death.cause, 'shot');
      play(host, 'finish-speech');
      play(king, 'badge', host.seat);
      assert.deepEqual(match.history.slice(-3).map(event => event.kind), ['duel', 'shot', 'badge']);
    } else {
      play(king, 'shoot', null);
      assert.equal(playerAt(match, masked.seat).death, undefined);
      play(king, 'badge', masked.seat);
      assert.equal(playerAt(match, masked.seat).death.time, 'delayed');
      assert.equal(match.sheriff, masked.seat);
      play(masked, 'badge', host.seat);
      assert.deepEqual(match.history.slice(-4).map(event => event.kind), ['duel', 'badge', 'departed', 'badge']);
    }
    assert.equal(match.sheriff, host.seat);
    assert.equal(match.phase, 'next-night');
  });
}

for (const sheriffMode of ['double', 'single']) {
  test(`${sheriffMode} badge mode applies its self-destruct limit across D1 and D2`, () => {
    const room = createRoom('custom', undefined, ['wolfKing', 'wolf', 'wolf', 'seer', 'villager', 'villager', 'villager']);
    room.sheriffMode = sheriffMode;
    const [king, secondWolf, , seer, host, victim, candidate] = room.guests;
    room.hostId = host.id;
    const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
    startMatch(room, matchRules);
    const { match } = room;
    play(king, 'night-action', victim.seat);
    play(seer, 'night-action', king.seat);
    play(host, 'open-election');
    for (const guest of room.guests) play(guest, 'candidacy', [king, host, candidate].includes(guest));
    const order = match.election.order.filter(seat => seat !== king.seat);
    play(king, 'self-destruct');
    assert.equal(match.phase, 'last-words');
    assert.equal(controls(room, host).speaker, victim.seat);
    assert.deepEqual(match.history.find(event => event.kind === 'night-result').seats, [victim.seat]);
    assert.equal(match.election.status, sheriffMode === 'single' ? 'completed' : 'postponed');
    play(host, 'finish-speech');
    play(host, 'next-night');
    play(secondWolf, 'night-action', null);
    play(seer, 'night-action', secondWolf.seat);

    if (sheriffMode === 'double') {
      play(host, 'open-election');
      assert.deepEqual(match.election.speakers, order);
      play(secondWolf, 'self-destruct');
      assert.equal(match.phase, 'next-night');
    } else {
      assert.deepEqual(controls(room, host).actions.map(action => action.kind), ['publish-night']);
      play(host, 'publish-night');
      assert.equal(match.phase, 'discussion');
    }
    assert.equal(match.sheriff, null);
    assert.equal(match.election.status, 'completed');
    assert.equal(match.history.filter(event => event.kind === 'sheriff').length, 1);
    assert.equal(match.history.filter(event => event.kind === 'night-result').length, 2);
  });
}

test('no badge skips the election and runs ordinary exile with one vote per player', () => {
  const room = createRoom('custom', undefined, ['wolf', 'wolf', 'seer', 'villager', 'villager']);
  room.sheriffMode = 'none';
  const [wolf, secondWolf, seer, host, other] = room.guests;
  room.hostId = host.id;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  startMatch(room, matchRules);
  play(wolf, 'night-action', null);
  play(seer, 'night-action', wolf.seat);
  const dawn = controls(room, host);
  assert.deepEqual(dawn.actions.map(action => action.kind), ['publish-night']);
  assert.equal(executeMatchChoice(room, host, { matchId: dawn.matchId, window: dawn.window, kind: 'open-election' }, matchRules), false);
  play(host, 'publish-night');
  assert.equal(room.match.phase, 'discussion');
  assert.equal(controls(room, secondWolf).self.canSelfDestruct, true);
  while (room.match.phase === 'discussion') play(host, 'finish-speech');
  assert.deepEqual(controls(room, host).actions.map(action => action.kind), ['open-exile']);
  play(host, 'open-exile');
  const ballotView = controls(room, host);
  assert.equal(ballotView.hostActions, undefined);
  assert.equal(executeMatchChoice(room, host, { matchId: ballotView.matchId, window: ballotView.window,
    kind: 'host-eliminate', choice: wolf.seat }, matchRules), false);
  assert.equal(controls(room, secondWolf).self.canSelfDestruct, false);
  for (const guest of room.guests) play(guest, 'vote', guest === host || guest === other ? wolf.seat : null);
  const ballot = room.match.history.find(event => event.kind === 'exile-vote').ballot;
  assert.deepEqual(ballot.groups, [{ seat: wolf.seat, count: 2, voters: [host.seat, other.seat] }]);
  assert.equal(room.match.sheriff, null);
  assert.equal(room.match.election, undefined);
});

function choiceFor(room, action) {
  const { match } = room;
  if (action.kind === 'nominate') return [];
  if (action.kind === 'vote') return action.options.find(seat => seat && isWolf(playerAt(match, seat))) ?? null;
  if (action.kind === 'candidacy') throw new Error('Candidacy should be set for each player');
  if (action.action === 'thief-start') return 'power';
  if (action.options?.includes(null)) return null;
  return action.options?.[0];
}

for (const [board, draw] of [['classic'], ['mechanical'], ['thief', 0], ['thief', 1], ['thief', 2], ['thief', 3]]) {
  test(`${board}${draw === undefined ? '' : ` draw ${draw + 1}`} runs Night 1 through victory and rematch`, () => {
    const room = createRoom(board, draw);
    startMatch(room, matchRules);
    const { match } = room;
    const guestOrder = room.guests.map(guest => guest.id);
    const sheriff = match.players.find(player => player.role === 'villager').seat;
    const visited = new Set();
    let timerStarted = false;
    const advancesNormally = ({ kind }) => !['self-destruct', 'start-timer', 'withdraw', 'close-vote'].includes(kind);
    for (let step = 0; match.winner === undefined && step < 450; step++) {
      visited.add(match.phase);
      const current = room.guests.map(guest => ({ guest, actions: controls(room, guest).actions ?? [] }))
        .find(({ actions }) => actions.some(advancesNormally));
      assert.ok(current, `No available action during ${match.phase}`);
      const action = current.actions.find(advancesNormally);
      const choice = action.kind === 'candidacy' ? current.guest.seat === sheriff : choiceFor(room, action);
      if (!timerStarted && action.kind === 'finish-speech') {
        const timer = current.actions.find(entry => entry.kind === 'start-timer');
        choose(room, current.guest, timer, 60, 10_000);
        assert.deepEqual(match.timer, { deadline: 70_000 });
        timerStarted = true;
      }
      choose(room, current.guest, action, choice);
    }
    assert.equal(timerStarted, true);
    assert.equal(match.winner, 'village');
    assert.equal(match.round, 4);
    for (const phase of ['dawn', 'night', 'sheriff-signup', 'discussion', 'nomination', 'exile-vote', 'last-words', 'next-night']) {
      assert.ok(visited.has(phase), phase);
    }
    assert.equal(match.history.filter(entry => entry.kind === 'night-result').length, 4);
    assert.equal(match.history.filter(entry => entry.kind === 'exile').length, 4);
    assert.equal(controls(room, room.guests[1]).roster.length, 12);
    const host = room.guests[0];
    const rematch = controls(room, host).actions.find(action => action.kind === 'rematch');
    choose(room, host, rematch);
    assert.equal(room.match, undefined);
    assert.equal(room.dealt, false);
    assert.deepEqual(room.guests.map(guest => guest.id), guestOrder);
    assert.ok(room.guests.every(guest => guest.assignment === undefined && !guest.revealed && !guest.acknowledged));
  });
}

test('the last wolf exploding before dawn publication wins for good before Masked can die', () => {
  const room = createRoom('thief', 3); // The Thief draws Medium.
  const [wolfA, wolfB, lastWolf, host] = room.guests;
  room.hostId = host.id;
  const guestWith = role => room.guests.find(guest => guest.assignment.role === role);
  const thief = guestWith('thief');
  const masked = guestWith('masked');
  const poisoner = guestWith('poisoner');
  const dreamer = guestWith('dreamer');
  const hunter = guestWith('hunter');

  startMatch(room, matchRules);
  const { match } = room;
  function play(guest, kind, choice, nightAction) {
    const action = controls(room, guest).actions?.find(entry => entry.kind === kind && entry.action === nightAction);
    assert.ok(action, `${kind} ${nightAction ?? ''} must be available to seat ${guest.seat} in ${match.phase}`);
    choose(room, guest, action, choice);
  }
  const night = (guest, action, choice) => play(guest, 'night-action', choice, action);
  function exile(target) {
    while (match.phase === 'discussion' || match.phase === 'last-words') play(host, 'finish-speech');
    play(host, 'open-exile');
    for (const guest of room.guests) {
      if (!playerAt(match, guest.seat).death) play(guest, 'vote', guest === target ? null : target.seat);
    }
    assert.equal(match.phase, 'last-words');
    play(host, 'finish-speech');
  }

  night(thief, 'thief-start', 'power');
  night(dreamer, 'dreamer', null);
  night(poisoner, 'poison', wolfA.seat);
  night(thief, 'medium', wolfA.seat);
  night(hunter, 'gun-check', 'confirm');
  play(host, 'open-election');
  for (const guest of room.guests) play(guest, 'candidacy', false);
  play(host, 'publish-night');
  exile(thief);

  play(host, 'next-night');
  night(dreamer, 'dreamer', poisoner.seat);
  night(wolfB, 'knife', dreamer.seat);
  night(hunter, 'gun-check', 'confirm');
  play(host, 'publish-night');
  exile(hunter);
  play(hunter, 'shoot', wolfB.seat);
  play(host, 'finish-speech');

  play(host, 'next-night');
  night(lastWolf, 'knife', masked.seat);
  assert.equal(match.phase, 'dawn');
  assert.equal(match.day.published, undefined);
  assert.deepEqual(match.players.filter(player => !player.death).map(player => player.role),
    ['wolfKing', 'villager', 'villager', 'villager', 'villager', 'masked']);
  assert.equal(playerAt(match, masked.seat).delayedDeath.cause, 'wolfKnife');

  play(lastWolf, 'self-destruct');
  const result = controls(room, masked);
  assert.equal(result.phase, 'finished');
  assert.equal(result.winner, 'village');
  assert.equal(playerAt(match, masked.seat).death, undefined);
  assert.equal(result.departed.includes(masked.seat), false);
  assert.equal(result.departed.includes(lastWolf.seat), true);
  assert.ok(result.history.some(event => event.round === 3 && event.kind === 'explosion' && event.seat === lastWolf.seat));
  assert.deepEqual(result.history.find(event => event.round === 3 && event.kind === 'night-result').seats, []);
});

test('Thief preset Wolf King retains red-wolf knife rights, reports double claws and can shoot before inheritance', () => {
  const room = createRoom('thief', 2); // Thief holds Hunter; Medium and Poisoner are ordinary gods.
  const [wolfA, wolfB, king, host, victim] = room.guests;
  room.hostId = host.id;
  const guestWith = role => room.guests.find(guest => guest.assignment.role === role);
  const thief = guestWith('thief');
  const medium = guestWith('medium');
  const dreamer = guestWith('dreamer');
  const poisoner = guestWith('poisoner');
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  const night = (guest, action, choice) => {
    const control = controls(room, guest).actions?.find(entry => entry.action === action);
    assert.ok(control, `${action} must be available to seat ${guest.seat}`);
    choose(room, guest, control, choice);
  };
  startMatch(room, matchRules);
  const { match } = room;
  function exile(target) {
    while (['last-words', 'discussion'].includes(match.phase)) play(host, 'finish-speech');
    play(host, 'open-exile');
    for (const guest of room.guests) {
      if (!playerAt(match, guest.seat).death) play(guest, 'vote', guest === target ? null : target.seat);
    }
    assert.equal(match.phase, 'last-words');
    play(host, 'finish-speech');
  }

  assert.deepEqual(match.night.wolves, []);
  assert.deepEqual(controls(room, king).self.teammates, [wolfA.seat, wolfB.seat]);
  assert.deepEqual(controls(room, wolfB).self.teammates, [wolfA.seat, king.seat]);
  assert.equal(controls(room, thief).self.teammates, undefined);
  night(thief, 'thief-start', 'common');
  night(dreamer, 'dreamer', null);
  night(poisoner, 'poison', wolfA.seat);
  night(medium, 'medium', king.seat);
  assert.equal(controls(room, medium).self.inspections[0].claws, 2);
  play(host, 'open-election');
  for (const guest of room.guests) play(guest, 'candidacy', false);
  play(host, 'publish-night');
  exile(wolfB);

  play(host, 'next-night');
  assert.deepEqual(match.night.wolves, [king.seat]);
  night(dreamer, 'dreamer', null);
  const knife = controls(room, king).actions.find(action => action.action === 'knife');
  assert.ok(!knife.options.includes(king.seat));
  assert.ok(!controls(room, thief).actions?.some(action => action.action === 'knife'));
  night(king, 'knife', null);
  night(medium, 'medium', thief.seat);
  assert.equal(controls(room, medium).self.inspections.at(-1).role, 'hunter');
  night(thief, 'gun-check', 'confirm');
  play(host, 'publish-night');
  exile(king);
  assert.equal(controls(room, king).actions[0].role, 'wolfKing');
  play(king, 'shoot', victim.seat);
  assert.equal(match.phase, 'last-words');
  play(host, 'finish-speech');

  play(host, 'next-night');
  assert.deepEqual(match.night.wolves, [thief.seat]);
  night(dreamer, 'dreamer', null);
  assert.ok(controls(room, thief).actions.some(action => action.action === 'knife'));
});

test('the Witch privately sees the normal knife while retaining the antidote and can use only one potion', () => {
  const room = createRoom('mechanical');
  startMatch(room, matchRules);
  const play = (role, value) => {
    const guest = room.guests.find(person => person.assignment.role === role);
    const [control] = controls(room, guest).actions;
    choose(room, guest, control, value);
    return guest;
  };
  play('guard', null);
  const witch = room.guests.find(person => person.assignment.role === 'witch');
  play('wolf', witch.seat);
  const view = controls(room, witch);
  assert.equal(view.self.wolfTarget, witch.seat);
  assert.equal(view.actions[0].options.includes('save'), false);
  assert.ok(controls(room, room.guests[0]).self.wolfTarget === undefined);
  const { matchId, window } = view;
  const kind = 'night-action';
  assert.equal(executeMatchChoice(room, witch, { matchId, window, kind, choice: ['save', 'poison:1'] }, matchRules), false);
  choose(room, witch, view.actions[0], 'poison:1');
  assert.equal(executeMatchChoice(room, witch, { matchId, window, kind, choice: 'poison:2' }, matchRules), false);
  assert.deepEqual(room.match.night.poisons, [{ source: witch.seat, target: 1, witch: true }]);
});

test('an abandoned round reveals no private roster and allows the host to keep the same seats', () => {
  const room = createRoom('thief', 0);
  startMatch(room, matchRules);
  abandonMatch(room.match);
  const { winner, roster } = controls(room, room.guests[1]);
  assert.equal(winner, 'abandoned');
  assert.equal(roster, undefined);
  const host = room.guests[0];
  choose(room, host, controls(room, host).actions[0]);
  assert.equal(room.match, undefined);
  assert.equal(room.guests.length, 12);
});

test('individual ballots stay private until resolved, then publish voter groups and the sheriff weight', () => {
  const room = createRoom('classic');
  startMatch(room, matchRules);
  const { match } = room;
  match.phase = 'exile-vote';
  match.sheriff = 1;
  match.day = { nominations: [5], ballot: { voters: [1, 2, 3, 4], targets: [5, 6], votes: {} } };
  for (const [index, value] of [5, 5, 6, null].entries()) {
    const guest = room.guests[index];
    const view = controls(room, guest);
    const next = view.actions.find(action => action.kind === 'vote');
    choose(room, guest, next, value);
    if (index < 3) {
      const hostView = controls(room, room.guests[0]);
      assert.deepEqual(hostView.voteProgress, { received: index + 1, expected: 4, pending: [1, 2, 3, 4].slice(index + 1) });
      const watcher = controls(room, room.guests[4]);
      assert.equal(watcher.history.length, 0);
      assert.equal(watcher.voteProgress, undefined);
      assert.equal(hostView.actions.some(action => action.kind === 'close-vote'), true);
    }
  }
  const event = controls(room, room.guests[4]).history.find(item => item.kind === 'exile-vote');
  assert.deepEqual(event.ballot, {
    groups: [{ seat: 5, count: 2.5, voters: [1, 2] }, { seat: 6, count: 1, voters: [3] }],
    abstained: [4],
  });
});

test('host can close regular and runoff sheriff and exile ballots with only outstanding seats abstaining', () => {
  const room = createRoom('custom', undefined, ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager']);
  const [wolf, otherWolf, seer, voter, waiting, host] = room.guests;
  room.hostId = host.id;
  const play = (guest, kind, choice) => playAction(room, guest, kind, choice);
  const checkClose = (phase, pending, ballot) => {
    const view = controls(room, host);
    assert.equal(view.phase, phase);
    assert.deepEqual(view.voteProgress.pending, pending);
    assert.equal(controls(room, voter).voteProgress, undefined);
    const command = { kind: 'close-vote', matchId: view.matchId, window: view.window };
    assert.equal(executeMatchChoice(room, voter, command, matchRules), false);
    play(host, 'close-vote');
    const published = controls(room, voter).history.findLast(event => event.ballot);
    assert.deepEqual(published.ballot, ballot);
    assert.equal(published.runoff, phase.includes('runoff'));
    assert.equal(executeMatchChoice(room, host, command, matchRules), false);
  };
  startMatch(room, matchRules);
  const { match } = room;
  play(wolf, 'night-action', null);
  play(seer, 'night-action', wolf.seat);
  play(host, 'open-election');
  for (const guest of room.guests) play(guest, 'candidacy', guest === wolf || guest === otherWolf);
  while (match.phase === 'sheriff-speech') play(host, 'finish-speech');
  play(seer, 'vote', wolf.seat);
  play(voter, 'vote', otherWolf.seat);
  play(waiting, 'vote', null);
  const tie = [{ seat: wolf.seat, count: 1, voters: [seer.seat] }, { seat: otherWolf.seat, count: 1, voters: [voter.seat] }];
  checkClose('sheriff-vote', [host.seat], { groups: tie, abstained: [waiting.seat, host.seat] });
  while (match.phase === 'sheriff-runoff-speech') play(host, 'finish-speech');
  const eligible = [seer.seat, voter.seat, waiting.seat, host.seat];
  checkClose('sheriff-runoff-vote', eligible, { groups: [], abstained: eligible });
  assert.equal(match.sheriff, null);
  play(host, 'publish-night');
  while (match.phase === 'discussion') play(host, 'finish-speech');
  play(host, 'open-exile');
  play(seer, 'vote', wolf.seat);
  play(voter, 'vote', otherWolf.seat);
  checkClose('exile-vote', [wolf.seat, otherWolf.seat, waiting.seat, host.seat], {
    groups: tie, abstained: [wolf.seat, otherWolf.seat, waiting.seat, host.seat],
  });
  while (match.phase === 'exile-runoff-speech') play(host, 'finish-speech');
  play(host, 'vote', wolf.seat);
  const remaining = [wolf.seat, otherWolf.seat, seer.seat, voter.seat, waiting.seat];
  checkClose('exile-runoff-vote', remaining, { groups: [{ seat: wolf.seat, count: 1, voters: [host.seat] }], abstained: remaining });
  assert.equal(match.phase, 'last-words');
  assert.equal(controls(room, voter).speaker, wolf.seat);
});
