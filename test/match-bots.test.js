import assert from 'node:assert/strict';
import test from 'node:test';
import { progressBots } from '../server/match-bots.js';
import { controllerView, executeMatchChoice, startMatch } from '../server/match-controller.js';
import { matchRules } from '../server/match-rules.js';
import { publicSpeaker } from '../server/match-view.js';

test('bots use legal swaps and ballots without taking over a human wolf or speaker', () => {
  const guests = ['wolf', 'wolf', 'magician', 'villager', 'villager'].map((role, index) => ({
    id: String(index + 1), seat: index + 1, assignment: { role }, bot: index !== 0,
  }));
  const [host, bot] = guests;
  const room = {
    board: 'custom', hostId: host.id, guests, sheriffMode: 'none',
    customRules: { victoryMode: 'town', firstNightKnife: 'disabled' },
  };
  let now = 0;
  startMatch(room, matchRules);
  const { match } = room;
  const command = (kind, choice) => ({ kind, matchId: match.id, window: match.window, choice });
  const play = (kind, choice) => assert.equal(executeMatchChoice(room, host, command(kind, choice), matchRules, now), true);
  const advance = (choose = () => 0) => progressBots(room, matchRules, now, choose);

  assert.equal(advance(limit => limit === 2 ? 1 : 0), true);
  assert.deepEqual(match.night.swap, [1, 2]);
  assert.equal(match.night.step.kind, 'wolf-recognition');
  assert.deepEqual(match.night.step.seats, [1, 2]);
  assert.equal(advance(), false);
  play('night-action', 'confirm');
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
      assert.equal(advance(), false);
      play('finish-speech');
    } else {
      advance();
      assert.equal(advance(), false);
      assert.equal(publicSpeaker(match), speaker);
      now += 2_000;
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
  assert.deepEqual(match.history.find(event => event.kind === 'exile-vote').ballot.groups.find(group => group.seat === 1).voters,
    [2, 3, 4, 5]);
});
