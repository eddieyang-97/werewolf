import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceDeathFlow, advanceDiscussion, advanceRunoff, canSelfDestruct, closeExileVote,
  openExileVote, publishNight, resolveBadge, resolveGun, selfDestruct,
} from '../server/match-day.js';
import {
  advanceElectionSpeech, closeElectionVote, collectCandidacies, electionDue,
  interruptElection, startElection, withdrawCandidacy,
} from '../server/match-election.js';
import { createMatch, formalDeaths, playerAt, winningSide } from '../server/match-state.js';
import { matchView } from '../server/match-view.js';
import { electionVoters, exileWeight, tallyVotes } from '../server/match-vote.js';
import {
  advanceNight, applyNightEffect, beginNight, fixedChoices, gunReport, mechanicalNightOrder,
} from '../server/night-actions.js';
import { knifeOwners, mediumResult, nightDeaths, settleNightDeaths } from '../server/night-resolution.js';

const defaults = ['wolf', 'wolf', 'wolf', 'mechanical', 'guard', 'witch', 'medium', 'hunter', 'villager', 'villager', 'villager', 'villager'];

function setup(board = 'mechanical', roles = defaults) {
  return createMatch(board, roles.map((role, index) => ({
    seat: index + 1,
    assignment: typeof role === 'string' ? { role } : role,
  })));
}

function dawn(match, deaths = []) {
  match.round = 1;
  match.phase = 'dawn';
  match.day = { deaths: formalDeaths(match, deaths), interrupted: false };
}

test('Mechanical Wolf preserves the fixed night schedule and inherits ordinary knife on the next night', () => {
  const match = setup();
  beginNight(match, mechanicalNightOrder);
  assert.deepEqual(match.night.step, { kind: 'guard', seats: [5] });
  assert.deepEqual(knifeOwners(match, match.players), [1, 2, 3]);
  applyNightEffect(match, playerAt(match, 5), 'guard', null);
  advanceNight(match);
  assert.deepEqual(match.night.step, { kind: 'knife', seats: [1, 2, 3] });
  formalDeaths(match, [1, 2, 3].map(seat => ({ seat, cause: 'poison', time: 'night' })));
  assert.deepEqual(match.night.wolves, [1, 2, 3]);
  beginNight(match, mechanicalNightOrder);
  advanceNight(match);
  assert.deepEqual(match.night.step, { kind: 'knife', seats: [4] });
});

test('Mechanical Wolf learns once, reports the copied role, and activates the copied guard on a later night', () => {
  const match = setup();
  beginNight(match, mechanicalNightOrder);
  const mechanical = playerAt(match, 4);
  assert.deepEqual(mediumResult(mechanical), { claws: 2 });
  for (let i = 0; i < 3; i++) advanceNight(match);
  assert.deepEqual(match.night.step, { kind: 'learn', seats: [4] });
  applyNightEffect(match, mechanical, 'learn', 5);
  advanceNight(match);
  assert.deepEqual(match.night.step, { kind: 'medium', seats: [7] });
  assert.deepEqual(mediumResult(mechanical), { role: 'guard', mechanical: true });
  beginNight(match, mechanicalNightOrder);
  for (let i = 0; i < 3; i++) advanceNight(match);
  assert.deepEqual(match.night.step, { kind: 'mechanical-guard', seats: [4] });
  applyNightEffect(match, mechanical, 'mechanical-guard', 4);
  assert.equal(fixedChoices(match, mechanical, 'mechanical-guard').includes(4), false);
  applyNightEffect(match, mechanical, 'mechanical-guard', null);
  assert.equal(fixedChoices(match, mechanical, 'mechanical-guard').includes(4), true);
});

test('night effects arbitrate milk death, poison reflection, dream protection and linked deaths', () => {
  assert.deepEqual(nightDeaths({ knife: 8, saved: 8, guards: [8] }), [{ seat: 8, cause: 'milk', time: 'night' }]);
  assert.deepEqual(nightDeaths({ mechanicalGuard: 4, poisons: [{ source: 6, target: 4, witch: true }] }),
    [{ seat: 6, cause: 'poison', time: 'night' }]);
  assert.deepEqual(nightDeaths({ knife: 8, poisons: [{ source: 6, target: 8 }], dreams: [{ source: 4, target: 8 }] }), []);
  assert.deepEqual(nightDeaths({ extraKnife: 4, dreams: [{ source: 4, target: 8 }] }), [
    { seat: 4, cause: 'extraKnife', time: 'night' },
    { seat: 8, cause: 'dreamLink', time: 'night' },
  ]);
  const match = setup();
  match.night = { knife: 8, poisons: [{ source: 6, target: 8 }] };
  assert.equal(gunReport(match, playerAt(match, 8)), false);
});

test('Thief has no first-night normal knife and picks up the same Dreamer use across a civilian night', () => {
  const match = setup('thief', ['wolf', 'wolf', 'wolfKing', { role: 'thief', extra: ['dreamer', 'villager'] },
    'masked', 'poisoner', 'medium', 'hunter', ...defaults.slice(8)]);
  beginNight(match, ['thief-start']);
  assert.deepEqual(match.night.wolves, []);
  const thief = playerAt(match, 4);
  applyNightEffect(match, thief, 'thief-start', 'power');
  assert.deepEqual(mediumResult(thief), { role: 'dreamer' });
  applyNightEffect(match, thief, 'dreamer', 8);
  beginNight(match, ['dreamer', 'knife']);
  assert.deepEqual(mediumResult(thief), { role: 'villager' });
  assert.deepEqual(match.night.step, { kind: 'knife', seats: [1, 2, 3] });
  beginNight(match, ['dreamer']);
  assert.deepEqual(match.night.step, { kind: 'dreamer', seats: [4] });
  applyNightEffect(match, thief, 'dreamer', 8);
  assert.deepEqual(nightDeaths(match.night), [{ seat: 8, cause: 'dreamRepeat', time: 'night' }]);
});

test('simultaneous final wolf and final power death yields an immediate wolf victory', () => {
  const match = setup();
  match.round = 2;
  formalDeaths(match, [1, 2, 3, 5, 6, 7].map(seat => ({ seat, cause: 'exile', time: 'day' })));
  match.night = { knife: 8, poisons: [{ source: 6, target: 4 }] };
  settleNightDeaths(match);
  assert.equal(match.winner, 'wolves');
  assert.equal(match.phase, 'finished');
});

test('Mixed Blood follows its model while still counting towards the civilian edge', () => {
  const match = setup('classic', ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'fool', 'villager', 'villager', 'villager', 'mixed']);
  const mixed = playerAt(match, 12);
  mixed.model = 1;
  assert.equal(winningSide(match, mixed), 'wolves');
  formalDeaths(match, [9, 10, 11].map(seat => ({ seat, cause: 'exile', time: 'day' })));
  assert.equal(match.winner, undefined);
  formalDeaths(match, [{ seat: 12, cause: 'exile', time: 'day' }]);
  assert.equal(match.winner, 'wolves');
});

test('sheriff PK reverses the original order and differentiates first and runoff voter eligibility', () => {
  const match = setup();
  dawn(match);
  startElection(match);
  const election = match.election;
  election.signups = Object.fromEntries(match.players.map(({ seat }) => [seat, seat <= 4]));
  collectCandidacies(match);
  assert.equal(withdrawCandidacy(match, 4), true);
  while (match.phase === 'sheriff-speech') advanceElectionSpeech(match);
  assert.deepEqual(election.ballot.voters, [5, 6, 7, 8, 9, 10, 11, 12]);
  election.ballot.votes = { 5: 1, 6: 2, 7: 3 };
  closeElectionVote(match);
  assert.deepEqual(election.speakers, election.order.filter(seat => seat !== 4).reverse());
  assert.equal(withdrawCandidacy(match, 3), true);
  while (match.phase === 'sheriff-runoff-speech') advanceElectionSpeech(match);
  assert.deepEqual(election.ballot.voters, [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(electionVoters([1, 2, 3, 4], election, true), [4]);
  election.ballot.votes = { 4: 1, 5: 2 };
  closeElectionVote(match);
  assert.equal(match.sheriff, null);
  assert.equal(match.phase, 'dawn');
});

test('sheriff competition can be postponed only once', () => {
  const match = setup();
  delete match.sheriffMode; // Matches saved before the room setting still use the default.
  dawn(match);
  startElection(match);
  const election = match.election;
  election.signups = Object.fromEntries(match.players.map(({ seat }) => [seat, seat >= 5 && seat <= 8]));
  collectCandidacies(match);
  const order = [...election.order];
  interruptElection(match, 1);
  assert.equal(electionDue(match), true);
  match.round++;
  startElection(match);
  assert.deepEqual(election.speakers, order);
  interruptElection(match, 2);
  assert.equal(electionDue(match), false);
  assert.equal(match.sheriff, null);
});

test('single self-destruct removes the badge even when one runoff candidate remains', () => {
  const match = setup();
  match.sheriffMode = 'single';
  dawn(match);
  startElection(match);
  match.election.signups = Object.fromEntries(match.players.map(({ seat }) => [seat, seat === 1 || seat === 5]));
  collectCandidacies(match);
  advanceElectionSpeech(match);
  advanceElectionSpeech(match);
  match.election.ballot.votes = { 6: 1, 7: 5 };
  closeElectionVote(match);
  assert.equal(match.phase, 'sheriff-runoff-speech');
  selfDestruct(match, playerAt(match, 1));
  assert.equal(match.sheriff, null);
  assert.equal(match.election.status, 'completed');
  assert.equal(match.phase, 'next-night');
  assert.equal(match.history.find(event => event.kind === 'sheriff').seat, null);
});

test('exile vote tie enters reverse-order PK and a second tie leaves everyone in', () => {
  const match = setup();
  dawn(match);
  match.day.order = match.players.map(player => player.seat);
  openExileVote(match);
  match.day.ballot.votes = { 3: 1, 4: 2 };
  closeExileVote(match);
  assert.deepEqual(match.day.runoffSpeakers, [2, 1]);
  assert.equal(canSelfDestruct(match, playerAt(match, 1)), true);
  advanceRunoff(match);
  advanceRunoff(match);
  assert.equal(canSelfDestruct(match, playerAt(match, 1)), false);
  match.day.ballot.votes = { 3: 1, 4: 2 };
  closeExileVote(match);
  assert.equal(match.phase, 'next-night');
  assert.equal(match.history.at(-1).kind, 'peaceful-day');
});

test('sheriff 1.5 weighting is exact and is lost on a different target or in PK', () => {
  const votes = { 1: 3, 2: 4 };
  assert.deepEqual(tallyVotes(votes, exileWeight(1, [3], false)).leaders, [3]);
  assert.deepEqual(tallyVotes(votes, exileWeight(1, [4], false)).leaders, [3, 4]);
  assert.deepEqual(tallyVotes(votes, exileWeight(1, [3], true)).leaders, [3, 4]);
});

test('N1 Hunter last words and shot happen before a badge transfer, with shot victim last words in between', () => {
  const match = setup();
  dawn(match, [{ seat: 8, cause: 'milk', time: 'night' }]);
  match.sheriff = 8;
  publishNight(match);
  assert.equal(match.phase, 'last-words');
  advanceDeathFlow(match);
  assert.equal(match.phase, 'gun');
  resolveGun(match, 1);
  assert.equal(match.phase, 'last-words');
  assert.equal(match.deathFlow.current.death.seat, 1);
  advanceDeathFlow(match);
  assert.equal(match.phase, 'badge');
  resolveBadge(match, 9);
  assert.equal(match.sheriff, 9);
  assert.equal(match.phase, 'speech-direction');
});

test('Masked remains in play until their D1 speech ends and no second set of last words is added', () => {
  const match = setup('thief', ['wolf', 'wolf', 'wolfKing', { role: 'thief', extra: ['dreamer', 'villager'] },
    'masked', 'poisoner', 'medium', 'hunter', ...defaults.slice(8)]);
  match.round = 1;
  match.night = { poisons: [{ source: 6, target: 5 }] };
  assert.deepEqual(settleNightDeaths(match), []);
  match.phase = 'discussion';
  match.day = { order: [5, 6], speakerIndex: 0 };
  advanceDiscussion(match);
  assert.equal(playerAt(match, 5).death.time, 'delayed');
  assert.equal(match.phase, 'discussion');
  assert.equal(match.day.speakerIndex, 1);
});

test('poisoned wolf can interrupt the election but cannot discuss on the next night', () => {
  const match = setup();
  dawn(match, [{ seat: 1, cause: 'poison', time: 'night' }]);
  startElection(match);
  assert.equal(canSelfDestruct(match, playerAt(match, 1)), true);
  selfDestruct(match, playerAt(match, 1));
  assert.equal(playerAt(match, 1).canDiscussNextNight, undefined);
  assert.equal(match.election.status, 'postponed');
  assert.equal(match.phase, 'next-night');
});

test('a healthy self-destructing small wolf can see the next night team but has no knife rights', () => {
  const match = setup();
  dawn(match);
  startElection(match);
  selfDestruct(match, playerAt(match, 1));
  beginNight(match, mechanicalNightOrder);
  assert.deepEqual(matchView(match, 1).self.teammates, [2, 3]);
  assert.deepEqual(matchView(match, 2).self.teammates, [1, 3]);
  advanceNight(match);
  assert.deepEqual(match.night.step.seats, [2, 3]);
});

test('a night choice and inspection are visible only to the eligible seat, before and after reload', () => {
  const match = setup();
  beginNight(match, mechanicalNightOrder);
  const { window } = match;
  assert.deepEqual(matchView(match, 1).self.teammates, [2, 3]);
  assert.equal(matchView(match, 1).self.nightAction, undefined);
  assert.equal(matchView(match, 4).self.teammates, undefined);
  assert.equal(matchView(match, 5).self.nightAction.kind, 'guard');
  const reloaded = JSON.parse(JSON.stringify(match));
  assert.equal(matchView(reloaded, 5).self.nightAction.window, window);
  assert.equal(matchView(reloaded, 6).self.nightAction, undefined);
  applyNightEffect(match, playerAt(match, 7), 'medium', 4);
  assert.deepEqual(matchView(match, 7).self.inspections, [{ kind: 'medium', round: 1, seat: 4, claws: 2 }]);
  assert.deepEqual(matchView(match, 1).self.inspections, []);
  assert.equal(matchView(match, 1).roster, undefined);
});

test('a formal night casualty stays undisclosed while candidacies and ballots are collected', () => {
  const match = setup();
  dawn(match, [{ seat: 8, cause: 'wolfKnife', time: 'night' }]);
  startElection(match);
  match.election.signups[8] = true;
  const view = matchView(match, 1);
  assert.deepEqual(view.departed, []);
  assert.equal(view.candidates, undefined);
  assert.equal(view.ballot, undefined);
  assert.doesNotMatch(JSON.stringify(view), /wolfKnife|signups|hunter/);
});
