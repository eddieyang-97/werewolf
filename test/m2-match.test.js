import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeck } from '../server/deal.js';
import { abandonMatch, controllerView, executeMatchChoice, startMatch } from '../server/match-controller.js';
import { matchRules } from '../server/match-rules.js';
import { isWolf, playerAt } from '../server/match-state.js';

function createRoom(board, draw) {
  return {
    board, hostId: '1', dealt: true,
    guests: buildDeck(board, () => draw).map((assignment, index) => ({
      id: String(index + 1), seat: index + 1, assignment, revealed: true, acknowledged: true,
    })),
  };
}

function controls(room, guest) {
  return controllerView(room.match, guest.seat, room.hostId === guest.id, matchRules);
}

function choose(room, guest, action, choice, now) {
  const { matchId, window } = controls(room, guest);
  assert.equal(executeMatchChoice(room, guest, { matchId, window, kind: action.kind, choice }, matchRules, now), true);
}

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
    ['wolf', 'villager', 'villager', 'villager', 'villager', 'masked']);
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
