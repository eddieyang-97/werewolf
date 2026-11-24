import {
  advanceDeathFlow, advanceDiscussion, advanceRunoff, canSelfDestruct, closeExileVote, openExileVote,
  openNomination, publishNight, resolveBadge, resolveGun, selfDestruct, setSpeechDirection, settleNomination,
} from './match-day.js';
import {
  advanceElectionSpeech, closeElectionVote, collectCandidacies, electionDue, electionOpen, startElection, withdrawCandidacy,
} from './match-election.js';
import { createMatch, finishMatch, livingPlayers, playerAt } from './match-state.js';
import { matchView, publicSpeaker } from './match-view.js';
import { advanceNight, applyNightEffect, beginNight, fixedChoices, mechanicalNightOrder } from './night-actions.js';

function nightOrder(board, rules) {
  return board === 'mechanical' ? mechanicalNightOrder : rules.nightOrder(board);
}

export function startMatch(room, rules) {
  const seated = room.guests.filter(guest => guest.seat !== null);
  room.match = createMatch(room.board, seated, room.sheriffMode);
  beginNight(room.match, nightOrder(room.board, rules), rules);
}

export function abandonMatch(match) {
  finishMatch(match, 'abandoned');
}

function getBallot(match) {
  const isSheriff = electionOpen(match) && match.phase.endsWith('-vote');
  if (isSheriff) return { ...match.election.ballot, targets: match.election.candidates, election: true };
  if (['exile-vote', 'exile-runoff-vote'].includes(match.phase)) return match.day.ballot;
  return null;
}

function controls(match, player, host, rules) {
  const actions = [];
  if (!player) return actions;
  const add = (kind, options, details) => actions.push({ kind, options, ...details });

  if (canSelfDestruct(match, player)) add('self-destruct');
  const { phase, night, election } = match;
  const seat = player.seat;
  const ballot = getBallot(match);
  const living = () => livingPlayers(match).map(entry => entry.seat);
  if (host && publicSpeaker(match)) add('start-timer', [30, 60, 90, 120]);

  if (ballot) {
    if (ballot.voters.includes(seat) && !Object.hasOwn(ballot.votes, seat)) {
      const targets = rules.ballotTargets(ballot, seat);
      add('vote', rules.abstention ? [...targets, null] : targets);
    }
    if (host && rules.earlyClose(match, ballot)) add('close-vote');
    return actions;
  }

  switch (phase) {
    case 'night': {
      if (!night.step.seats.includes(seat)) break;
      const { kind } = night.step;
      const fixed = fixedChoices(match, player, kind);
      const options = fixed ?? rules.nightChoices(match, player, kind);
      if (options.length) add('night-action', options, { action: kind });
      break;
    }
    case 'dawn':
      if (host) add(electionDue(match) ? 'open-election' : 'publish-night');
      break;
    case 'sheriff-signup':
      if (!player.announced && !Object.hasOwn(election.signups, seat)) add('candidacy', [true, false]);
      break;
    case 'sheriff-speech':
    case 'sheriff-runoff-speech':
      if (election.candidates.includes(seat)) add('withdraw');
      if (host) add('finish-speech');
      break;
    case 'last-words':
    case 'discussion':
    case 'exile-runoff-speech':
      if (host) add('finish-speech');
      break;
    case 'gun':
      if (match.deathFlow.current.death.seat === seat) {
        add('shoot', [...living(), null], player.role === 'wolfKing' ? { role: player.role } : undefined);
      }
      break;
    case 'badge':
      if (match.deathFlow.current.death.seat === seat) add('badge', [...living(), null]);
      break;
    case 'speech-direction':
      if (match.sheriff === seat) add('direction', [-1, 1]);
      break;
    case 'exile-open':
      if (host) add(match.sheriff === null ? 'open-exile' : 'open-nomination');
      break;
    case 'nomination':
      if (match.sheriff === seat) add('nominate', living(), { multiple: true });
      break;
    case 'exile-locked':
      if (host) add('open-exile');
      break;
    case 'next-night':
      if (host) add('next-night');
      break;
    case 'finished':
      if (host) add('rematch');
      break;
  }
  return actions;
}

export function controllerView(match, seat, host, rules) {
  const view = matchView(match, seat);
  const actions = controls(match, playerAt(match, seat), host, rules);
  const ballot = getBallot(match);
  if (host && ballot) {
    view.voteProgress = { received: Object.keys(ballot.votes).length, expected: ballot.voters.length };
  }
  if (actions.length) Object.assign(view, { actions, window: match.window, matchId: match.id });
  return view;
}

function validChoice(action, choice) {
  if (!action.options) return choice === undefined;
  if (!action.multiple) return action.options.includes(choice);
  return Array.isArray(choice) && choice.length <= action.options.length && new Set(choice).size === choice.length
    && choice.every(seat => action.options.includes(seat));
}

function closeVote(match, ballot) {
  if (ballot.election) closeElectionVote(match);
  else closeExileVote(match);
}

function applyChoice(match, player, kind, choice, rules, now) {
  switch (kind) {
    case 'night-action': {
      const action = match.night.step.kind;
      if (fixedChoices(match, player, action) !== null) {
        applyNightEffect(match, player, action, choice);
        advanceNight(match, rules);
      } else if (rules.applyNightChoice(match, player, action, choice)) advanceNight(match, rules);
      break;
    }
    case 'vote': {
      const ballot = getBallot(match);
      ballot.votes[player.seat] = choice;
      if (ballot.voters.every(seat => Object.hasOwn(ballot.votes, seat))) closeVote(match, ballot);
      break;
    }
    case 'close-vote': closeVote(match, getBallot(match)); break;
    case 'open-election': startElection(match); break;
    case 'candidacy':
      match.election.signups[player.seat] = choice;
      collectCandidacies(match);
      break;
    case 'withdraw': withdrawCandidacy(match, player.seat); break;
    case 'publish-night': publishNight(match); break;
    case 'finish-speech':
      if (electionOpen(match)) advanceElectionSpeech(match);
      else if (match.phase === 'last-words') advanceDeathFlow(match);
      else if (match.phase === 'exile-runoff-speech') advanceRunoff(match);
      else advanceDiscussion(match);
      break;
    case 'shoot': resolveGun(match, choice); break;
    case 'badge': resolveBadge(match, choice); break;
    case 'direction': setSpeechDirection(match, choice); break;
    case 'open-nomination': openNomination(match); break;
    case 'nominate': settleNomination(match, choice); break;
    case 'open-exile': openExileVote(match); break;
    case 'self-destruct': selfDestruct(match, player); break;
    case 'start-timer': match.timer = { deadline: now + choice * 1_000 }; break;
    case 'next-night': beginNight(match, nightOrder(match.board, rules), rules); break;
  }
}

export function executeMatchChoice(room, guest, command, rules, now) {
  const { match } = room;
  if (!match || command.matchId !== match.id || command.window !== match.window) return false;
  const player = playerAt(match, guest.seat);
  const action = controls(match, player, guest.id === room.hostId, rules).find(entry => entry.kind === command.kind);
  if (!action || !validChoice(action, command.choice)) return false;
  if (command.kind === 'rematch') {
    delete room.match;
    room.dealt = false;
    for (const participant of room.guests) {
      delete participant.assignment;
      delete participant.replacement;
      delete participant.replaced;
      participant.revealed = false;
      participant.acknowledged = false;
    }
  } else {
    applyChoice(match, player, command.kind, command.choice, rules, now);
  }
  return true;
}
