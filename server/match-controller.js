import {
  advanceDeathFlow, advanceDiscussion, advanceRunoff, canSelfDestruct, closeExileVote, duelTargets, markDeparture,
  openExileVote, openNomination, publishNight, resolveBadge, resolveDuel, resolveGun, selfDestruct, setSpeechDirection,
  settleNomination, transferBadge,
} from './match-day.js';
import {
  advanceElectionSpeech, closeElectionVote, collectCandidacies, electionDue, electionOpen, startElection, withdrawCandidacy,
} from './match-election.js';
import { createMatch, finishMatch, livingPlayers, playerAt } from './match-state.js';
import { matchView, publicSpeaker } from './match-view.js';
import { pendingVoters } from './match-vote.js';
import {
  applyNightAction, beginNight, currentNightCue, fixedChoices, mechanicalNightOrder, nightChoiceExpired,
} from './night-actions.js';
import { nightCallOrder } from '../public/boards.js';

function startRoomNight(room, rules) {
  const { board, match } = room;
  const order = match.nightNarration ? nightCallOrder(board, match.round + 1, room.lineup)
    : board === 'mechanical' ? mechanicalNightOrder : rules.nightOrder(board);
  beginNight(match, order, rules);
}

export function startMatch(room, rules, nightNarration = false) {
  const seated = room.guests.filter(guest => guest.seat !== null);
  room.match = createMatch(room.board, seated, room.sheriffMode, room.customRules);
  if (nightNarration) room.match.nightNarration = true;
  startRoomNight(room, rules);
}

export function abandonMatch(match, winner = 'abandoned') {
  if (winner !== 'abandoned') match.forced = true;
  finishMatch(match, winner);
}

function getBallot(match) {
  const isSheriff = electionOpen(match) && match.phase.endsWith('-vote');
  if (isSheriff) return { ...match.election.ballot, targets: match.election.candidates, election: true };
  if (['exile-vote', 'exile-runoff-vote'].includes(match.phase)) return match.day.ballot;
  return null;
}

function recoveryControls(match) {
  if (match.winner || !['speech-direction', 'exile-open'].includes(match.phase)) return [];
  const targets = livingPlayers(match).map(player => player.seat);
  const actions = [{ kind: 'host-eliminate', options: targets }];
  if (targets.includes(match.sheriff) && targets.length > 1) {
    actions.push({ kind: 'host-transfer-badge', options: targets.filter(target => target !== match.sheriff) });
  }
  return actions;
}

function controls(match, player, host, rules, now, bot = false) {
  const actions = [];
  if (!player) return actions;
  const add = (kind, options, details) => actions.push({ kind, options, ...details });

  if (canSelfDestruct(match, player)) add('self-destruct');
  const duel = duelTargets(match, player);
  if (duel.length) add('duel', duel);
  const { phase, night, election } = match;
  const seat = player.seat;
  const ballot = getBallot(match);
  const living = () => livingPlayers(match).map(entry => entry.seat);
  const speaker = publicSpeaker(match);
  if (host && speaker) add('start-timer', [30, 60, 90, 120]);

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
      if (!night.step?.seats.includes(seat) || nightChoiceExpired(match, now)) break;
      const { kind } = night.step;
      const fixed = fixedChoices(match, player, kind);
      const options = fixed ?? rules.nightChoices(match, player, kind);
      if (options.length) add('night-action', options, {
        action: kind,
        ...(kind === 'swap' ? { multiple: true } : {}),
        ...(match.nightNarration ? { nightTimer: night.cueClock?.deadline !== undefined
          ? { deadline: night.cueClock.deadline, serverNow: now }
          : night.cueClock ? { remaining: night.cueClock.remaining } : { waiting: true } } : {}),
      });
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
      // fall through to the common speech control
    case 'last-words':
    case 'discussion':
    case 'exile-runoff-speech':
      if (host || (bot && speaker === seat)) add('finish-speech');
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

export function seatActions(room, guest, rules, now) {
  return controls(room.match, playerAt(room.match, guest.seat), guest.id === room.hostId, rules, now, guest.bot === true);
}

export function controllerView(match, seat, host, rules, now = Date.now()) {
  const view = matchView(match, seat, now);
  if (host && match.nightNarration && !match.winner) {
    view.nightNarration = true;
    if (match.phase === 'night') view.nightCue = currentNightCue(match);
  }
  const player = playerAt(match, seat);
  const actions = controls(match, player, host, rules, now);
  const hostActions = host && player ? recoveryControls(match) : [];
  const ballot = getBallot(match);
  if (host && ballot) {
    const pending = pendingVoters(ballot);
    view.voteProgress = { received: ballot.voters.length - pending.length, expected: ballot.voters.length, pending };
  }
  if (actions.length) view.actions = actions;
  if (hostActions.length) view.hostActions = hostActions;
  if (actions.length || hostActions.length) Object.assign(view, { window: match.window, matchId: match.id });
  return view;
}

function validChoice(action, choice) {
  if (!action.options) return choice === undefined;
  if (!action.multiple) return action.options.includes(choice);
  return Array.isArray(choice) && choice.length <= action.options.length && new Set(choice).size === choice.length
    && (action.action !== 'swap' || choice.length === 0 || choice.length === 2)
    && choice.every(seat => action.options.includes(seat));
}

function closeVote(match, ballot) {
  if (ballot.election) closeElectionVote(match);
  else closeExileVote(match);
}

function applyChoice(room, player, kind, choice, rules, now) {
  const { match } = room;
  switch (kind) {
    case 'night-action': applyNightAction(match, player, choice, rules); break;
    case 'vote': {
      const ballot = getBallot(match);
      ballot.votes[player.seat] = choice;
      if (ballot.voters.every(seat => Object.hasOwn(ballot.votes, seat))) closeVote(match, ballot);
      break;
    }
    case 'close-vote': {
      const ballot = getBallot(match);
      for (const seat of pendingVoters(ballot)) ballot.votes[seat] = null;
      closeVote(match, ballot);
      break;
    }
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
    case 'duel': resolveDuel(match, player, choice); break;
    case 'badge': resolveBadge(match, choice); break;
    case 'host-eliminate': markDeparture(match, choice); break;
    case 'host-transfer-badge': transferBadge(match, choice); break;
    case 'direction': setSpeechDirection(match, choice); break;
    case 'open-nomination': openNomination(match); break;
    case 'nominate': settleNomination(match, choice); break;
    case 'open-exile': openExileVote(match); break;
    case 'self-destruct': selfDestruct(match, player); break;
    case 'start-timer': match.timer = { deadline: now + choice * 1_000 }; break;
    case 'next-night': startRoomNight(room, rules); break;
  }
}

export function executeMatchChoice(room, guest, command, rules, now) {
  const { match } = room;
  if (!match || command.matchId !== match.id || command.window !== match.window) return false;
  const player = playerAt(match, guest.seat);
  const host = guest.id === room.hostId;
  const action = seatActions(room, guest, rules, now).find(entry => entry.kind === command.kind)
    ?? (host && player ? recoveryControls(match).find(entry => entry.kind === command.kind) : undefined);
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
    applyChoice(room, player, command.kind, command.choice, rules, now);
  }
  return true;
}
