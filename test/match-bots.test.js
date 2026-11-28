import assert from 'node:assert/strict';
import test from 'node:test';
import { progressBots } from '../server/match-bots.js';
import { controllerView, executeMatchChoice, startMatch } from '../server/match-controller.js';
import { matchRules } from '../server/match-rules.js';
import { publicSpeaker } from '../server/match-view.js';

function roomWithRoles(roles, humanSeats, sheriffMode, firstNightKnife = 'disabled') {
  const guests = roles.map((role, index) => ({
    id: String(index + 1), seat: index + 1, assignment: { role }, bot: !humanSeats.includes(index + 1),
  }));
  const room = {
    board: 'custom', hostId: guests[0].id, guests, sheriffMode,
    customRules: { victoryMode: 'town', firstNightKnife },
  };
  startMatch(room, matchRules);
  return room;
}

function playChoice(room, seat, kind, choice, now = 0) {
  const { match } = room;
  const guest = room.guests.find(guest => guest.seat === seat);
  const command = { kind, matchId: match.id, window: match.window, choice };
  assert.equal(executeMatchChoice(room, guest, command, matchRules, now), true);
}

test('bots use legal swaps and ballots without taking over a human wolf or speaker', () => {
  const room = roomWithRoles(['wolf', 'wolf', 'magician', 'villager', 'villager'], [1], 'none');
  const { guests } = room;
  const [host, bot] = guests;
  let now = 0;
  const { match } = room;
  const command = (kind, choice) => ({ kind, matchId: match.id, window: match.window, choice });
  const play = (kind, choice) => playChoice(room, host.seat, kind, choice, now);
  const advance = (choose = limit => limit > guests.length ? 1 : 0) => progressBots(room, matchRules, now, choose);

  assert.equal(advance(limit => limit === 2 ? 1 : 0), true);
  assert.deepEqual(match.night.swap, [1, 2]);
  assert.equal(match.night.step.kind, 'wolf-recognition');
  assert.deepEqual(match.night.step.seats, [1, 2]);
  assert.equal(advance(), false);
  play('night-action', 'confirm');
  advance();
  assert.equal(advance(), false);
  assert.equal(match.phase, 'dawn');
  play('publish-night');

  let sawHumanSpeaker = false;
  let botSpeeches = 0;
  while (match.phase === 'discussion') {
    const speaker = publicSpeaker(match);
    if (speaker === host.seat) {
      sawHumanSpeaker = true;
      assert.equal(executeMatchChoice(room, bot, command('finish-speech'), matchRules, now), false);
      advance();
      assert.equal(advance(), false);
      play('finish-speech');
    } else {
      advance();
      now += 3_600;
      assert.equal(advance(), false);
      assert.equal(publicSpeaker(match), speaker);
      now += 2_400;
      assert.equal(advance(limit => limit - 1), true);
      botSpeeches++;
    }
  }
  assert.equal(sawHumanSpeaker, true);
  assert.equal(botSpeeches, guests.length - 1);
  assert.equal(match.phase, 'exile-open');
  play('open-exile');
  assert.equal(advance(), true);
  const view = controllerView(match, host.seat, true, matchRules);
  assert.deepEqual(view.voteProgress, { received: 4, expected: 5, pending: [1] });
  assert.equal(view.history.some(event => event.kind === 'exile-vote'), false);
  play('vote', bot.seat);
  play('reveal-exile-vote');
  assert.deepEqual(match.history.find(event => event.kind === 'exile-vote').ballot.groups.find(group => group.seat === 1).voters,
    [2, 3, 4, 5]);
});

test('a large bot ballot builds choices in batches and resumes after a saved poll', () => {
  const botCount = 128;
  let room = roomWithRoles(['wolfBeauty', ...Array(botCount).fill('villager')], [1], 'none');
  playChoice(room, 1, 'night-action', 'confirm');
  playChoice(room, 1, 'night-action', 2);
  playChoice(room, 1, 'publish-night');
  while (room.match.phase === 'discussion') playChoice(room, 1, 'finish-speech');
  playChoice(room, 1, 'open-exile');

  let targetLists = 0;
  const rules = {
    ...matchRules,
    ballotTargets(ballot, seat) {
      targetLists++;
      return matchRules.ballotTargets(ballot, seat);
    },
  };
  const poll = () => {
    targetLists = 0;
    const changed = progressBots(room, rules, 0, () => 0);
    assert.ok(targetLists <= 32, `one poll built ${targetLists} target lists`);
    return changed;
  };
  assert.equal(poll(), true);
  const firstVotes = { ...room.match.day.ballot.votes };
  let votesCast = Object.keys(firstVotes).length;
  assert.ok(votesCast > 0 && votesCast < botCount);
  assert.ok(!room.match.history.some(event => event.kind === 'exile-vote'));
  room = JSON.parse(JSON.stringify(room));
  while (votesCast < botCount) {
    assert.equal(poll(), true);
    const total = Object.keys(room.match.day.ballot.votes).length;
    assert.ok(total > votesCast);
    votesCast = total;
  }
  assert.equal(poll(), false);
  for (const [seat, target] of Object.entries(firstVotes)) assert.equal(room.match.day.ballot.votes[seat], target);
  assert.ok(!Object.hasOwn(room.match.day.ballot.votes, 1));
  playChoice(room, 1, 'vote', null);
  playChoice(room, 1, 'reveal-exile-vote');
  const ballot = room.match.history.find(event => event.kind === 'exile-vote').ballot;
  assert.deepEqual(ballot.groups, [{ seat: 1, count: botCount, voters: room.guests.slice(1).map(bot => bot.seat) }]);
  assert.deepEqual(ballot.abstained, [1]);
});

test('a wolf bot on the exile PK list waits before interrupting the runoff', () => {
  const room = roomWithRoles(['villager', 'wolf', 'wolf', 'wolf', 'villager'], [1, 4, 5], 'none');
  const { match } = room;
  playChoice(room, 4, 'night-action', 'confirm');
  playChoice(room, 1, 'publish-night');
  playChoice(room, 1, 'open-exile');
  for (const [index, target] of [2, 3, 2, 3, null].entries()) playChoice(room, index + 1, 'vote', target);
  playChoice(room, 1, 'reveal-exile-vote');

  const openedAt = 10_000;
  assert.equal(progressBots(room, matchRules, openedAt, () => 0), true);
  assert.equal(match.phase, 'exile-runoff-speech');
  assert.equal(publicSpeaker(match), null);
  const host = controllerView(match, 1, true, matchRules);
  assert.deepEqual(host.exileRunoffCandidates.toSorted((a, b) => a - b), [2, 3]);
  assert.ok(host.actions.some(action => action.kind === 'open-exile'));
  const wolf = controllerView(match, 4, false, matchRules);
  assert.ok(wolf.actions.some(action => action.kind === 'self-destruct'));
  assert.equal(progressBots(room, matchRules, openedAt + 5_999, () => assert.fail('bots must still be waiting')), false);
  assert.equal(match.phase, 'exile-runoff-speech');

  assert.equal(progressBots(room, matchRules, openedAt + 6_000, () => 0), true);
  assert.ok(match.history.some(event => event.kind === 'explosion' && [2, 3].includes(event.seat)));
});

test('bot-only sheriff voting stays open for a human interruption in both rounds', () => {
  const room = roomWithRoles(['wolf', 'villager', 'villager', 'villager'], [1, 2], 'single');
  const { match } = room;
  const play = (seat, kind, choice) => playChoice(room, seat, kind, choice);
  play(1, 'night-action', 'confirm');
  play(1, 'open-election');
  for (const { seat, bot } of room.guests) play(seat, 'candidacy', !bot);
  for (const phase of ['sheriff-speech', 'sheriff-runoff-speech']) {
    assert.equal(progressBots(room, matchRules, 10_000, () => 1), false);
    assert.equal(match.phase, phase);
    play(1, 'open-sheriff-vote');
    const ballotPhase = phase.replace('speech', 'vote');
    const openedAt = phase === 'sheriff-speech' ? 0 : 10_000;
    const advance = (now, choose = () => assert.fail('bots must wait before rolling any action')) =>
      progressBots(room, matchRules, now, choose);

    assert.equal(match.phase, ballotPhase);
    assert.equal(advance(openedAt), true);
    assert.equal(advance(openedAt + 3_600), false);
    const hostView = controllerView(match, 1, true, matchRules);
    assert.equal(hostView.phase, ballotPhase);
    assert.ok(hostView.actions.some(action => action.kind === 'self-destruct'));
    assert.deepEqual(hostView.voteProgress, { received: 0, expected: 2, pending: [3, 4] });
    assert.equal(controllerView(match, 2, false, matchRules).actions, undefined);

    if (phase === 'sheriff-speech') {
      let nextTarget = 0;
      assert.equal(advance(10_000, () => nextTarget++), true);
      assert.equal(match.phase, 'sheriff-runoff-speech');
    } else {
      play(1, 'self-destruct');
      assert.equal(match.sheriff, null);
      assert.equal(match.history.filter(event => event.kind === 'sheriff-vote').length, 1);
      assert.equal(match.history.some(event => event.kind === 'explosion' && event.seat === 1), true);
    }
  }
});

test('a poisoned bot wolf can pass once, then interrupt the election in a new window without speaking', () => {
  let room = roomWithRoles(['villager', 'wolf', 'wolf', 'witch'], [1, 3, 4], 'single', 'enabled');
  playChoice(room, 3, 'night-action', null);
  playChoice(room, 4, 'night-action', 'poison:2');
  assert.equal(room.match.phase, 'dawn');
  assert.equal(room.match.players[1].death.cause, 'poison');
  assert.equal(publicSpeaker(room.match), null);
  let passes = 0;
  assert.equal(progressBots(room, matchRules, 0, () => { passes++; return 1; }), true);
  assert.equal(passes, 1);
  assert.equal(room.match.phase, 'dawn');
  room = JSON.parse(JSON.stringify(room));
  assert.equal(progressBots(room, matchRules, 2_000, () => assert.fail('the saved pass must not reroll')), false);
  playChoice(room, 1, 'open-election');
  assert.equal(room.match.phase, 'sheriff-signup');
  assert.equal(progressBots(room, matchRules, 3_000, () => 0), true);
  assert.equal(room.match.sheriff, null);
  assert.equal(room.match.history.some(event => event.kind === 'explosion' && event.seat === 2), true);
});
