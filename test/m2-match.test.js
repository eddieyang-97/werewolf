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
    for (let step = 0; match.winner === undefined && step < 450; step++) {
      visited.add(match.phase);
      const current = room.guests.map(guest => ({ guest, actions: controls(room, guest).actions ?? [] }))
        .find(({ actions }) => actions.some(action => !['self-destruct', 'start-timer', 'withdraw'].includes(action.kind)));
      assert.ok(current, `No available action during ${match.phase}`);
      const action = current.actions.find(entry => !['self-destruct', 'start-timer', 'withdraw'].includes(entry.kind));
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
      assert.deepEqual(hostView.voteProgress, { received: index + 1, expected: 4 });
      const watcher = controls(room, room.guests[4]);
      assert.equal(watcher.history.length, 0);
      assert.equal(watcher.voteProgress, undefined);
      assert.equal(hostView.actions?.some(action => action.kind === 'close-vote'), undefined);
    }
  }
  const event = controls(room, room.guests[4]).history.find(item => item.kind === 'exile-vote');
  assert.deepEqual(event.ballot, {
    groups: [{ seat: 5, count: 2.5, voters: [1, 2] }, { seat: 6, count: 1, voters: [3] }],
    abstained: [4],
  });
});
