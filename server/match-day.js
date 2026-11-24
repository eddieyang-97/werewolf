import {
  addHistory, changePhase, formalDeaths, gunAvailable, isPackWolf, isWolf, livingPlayers, playerAt,
  randomSeatOrder, revealDeaths, seatOrder,
} from './match-state.js';
import { electionDue, electionOpen, interruptElection } from './match-election.js';
import { exileWeight, runoffOrder, tallyVotes } from './match-vote.js';
import { nightTarget } from './night-resolution.js';

function prependDeathSteps(match, deaths) {
  const steps = deaths.flatMap(death => {
    const lastWords = death.time === 'shot' || ['exile', 'duel-failed'].includes(death.cause)
      || (death.time === 'night' && death.round === 1);
    const charm = death.time !== 'night' && death.cause !== 'duel' && match.night?.charm?.source === death.seat;
    return [...(lastWords ? [{ kind: 'last-words', death }] : []), ...(charm ? [{ kind: 'charm', death }] : []),
      { kind: 'gun', death }, { kind: 'badge', death }];
  });
  match.deathFlow.steps.unshift(...steps);
}

export function advanceDeathFlow(match) {
  if (match.winner) return;
  const flow = match.deathFlow;
  while (flow.steps.length) {
    const step = flow.steps.shift();
    if (step.kind === 'charm') {
      const seat = nightTarget(match.night, match.night.charm.target);
      const deaths = formalDeaths(match, [{ seat, cause: 'charm', time: 'day' }]);
      if (deaths.length) {
        revealDeaths(match, deaths);
        addHistory(match, 'day', 'charmed', { seat });
      }
      if (match.winner) return;
      prependDeathSteps(match, deaths);
      continue;
    }
    if (step.kind === 'gun' && !gunAvailable(match, playerAt(match, step.death.seat), step.death)) continue;
    if (step.kind === 'badge' && match.sheriff !== step.death.seat) continue;
    flow.current = step;
    changePhase(match, step.kind);
    return;
  }
  delete match.deathFlow;
  if (flow.then === 'discussion') beginDiscussion(match);
  else if (flow.then === 'speech') nextDiscussionSpeaker(match);
  else if (flow.resumePhase === 'discussion' && playerAt(match, match.day.order[match.day.speakerIndex]).death) {
    nextDiscussionSpeaker(match);
  } else if (flow.resumePhase) {
    changePhase(match, flow.resumePhase === 'nomination' && match.sheriff === null ? 'exile-open' : flow.resumePhase);
  } else changePhase(match, 'next-night');
}

function processDeaths(match, deaths, then, resumePhase) {
  if (match.winner) return;
  match.deathFlow = { steps: [], then, resumePhase };
  prependDeathSteps(match, deaths);
  advanceDeathFlow(match);
}

export function duelTargets(match, player) {
  if (player.role !== 'knight' || player.death || player.used.duel
    || !['discussion', 'exile-open', 'nomination', 'exile-locked'].includes(match.phase)) return [];
  return livingPlayers(match).filter(other => other !== player).map(other => other.seat);
}

export function resolveDuel(match, knight, target) {
  const won = isWolf(playerAt(match, target));
  const phase = match.phase;
  knight.used.duel = true;
  const seat = won ? target : knight.seat;
  const deaths = formalDeaths(match, [{ seat, cause: won ? 'duel' : 'duel-failed', time: 'day' }]);
  revealDeaths(match, deaths);
  addHistory(match, 'day', 'duel', { seat: knight.seat, target, won });
  if (match.winner) return;
  if (won) {
    const pending = concludeDelayedDeaths(match, livingPlayers(match).filter(player => player.delayedDeath));
    for (const delayed of pending) addHistory(match, 'day', 'departed', { seat: delayed.seat });
    processDeaths(match, [...deaths, ...pending], 'night');
  } else {
    if (match.day.nominations) {
      match.day.nominations = match.day.nominations.filter(nomination => nomination !== knight.seat);
    }
    processDeaths(match, deaths, 'night', phase);
  }
}

export function resolveGun(match, target) {
  if (target !== null) {
    const deaths = formalDeaths(match, [{ seat: target, cause: 'shot', time: 'shot' }]);
    revealDeaths(match, deaths);
    addHistory(match, 'day', 'shot', { seat: target });
    if (match.winner) return;
    prependDeathSteps(match, deaths);
  }
  advanceDeathFlow(match);
}

export function resolveBadge(match, seat) {
  match.sheriff = seat;
  addHistory(match, 'day', 'badge', { seat });
  advanceDeathFlow(match);
}

function concludeDelayedDeaths(match, pending, interrupted = false) {
  const deaths = formalDeaths(match, pending.map(player => ({ ...player.delayedDeath, time: interrupted ? 'night' : 'delayed' })));
  revealDeaths(match, deaths);
  return deaths;
}

export function publishNight(match) {
  const day = match.day;
  const interruptedDeaths = day.interrupted
    ? concludeDelayedDeaths(match, livingPlayers(match).filter(player => player.delayedDeath), true) : [];
  const deaths = [...day.deaths.filter(death => death.seat !== day.exploded), ...interruptedDeaths];
  revealDeaths(match, deaths);
  day.published = true;
  day.nightDepartures = deaths.map(death => death.seat);
  addHistory(match, 'night', 'night-result', { seats: day.nightDepartures });
  if (match.round === 1 && deaths.length > 1) {
    const order = randomSeatOrder(match, day.nightDepartures);
    deaths.sort((a, b) => order.indexOf(a.seat) - order.indexOf(b.seat));
  }
  const queue = day.explosion ? [...deaths, day.explosion] : deaths;
  processDeaths(match, queue, day.interrupted ? 'night' : 'discussion');
}

function beginDiscussion(match) {
  if (match.sheriff !== null && !playerAt(match, match.sheriff).death) {
    changePhase(match, 'speech-direction');
    return;
  }
  const seats = livingPlayers(match).map(player => player.seat);
  setDiscussionOrder(match, randomSeatOrder(match, seats));
}

function setDiscussionOrder(match, seats) {
  match.day.order = seats;
  match.day.speakerIndex = -1;
  nextDiscussionSpeaker(match);
}

export function setSpeechDirection(match, direction) {
  const { nightDepartures } = match.day;
  const anchor = nightDepartures.length === 1 ? nightDepartures[0] : match.sheriff;
  const choices = livingPlayers(match).map(player => player.seat);
  const order = seatOrder(match, choices, anchor, direction);
  addHistory(match, 'day', 'direction', { anchor, direction });
  setDiscussionOrder(match, order);
}

function nextDiscussionSpeaker(match) {
  const day = match.day;
  do { day.speakerIndex++; } while (day.order[day.speakerIndex] && playerAt(match, day.order[day.speakerIndex]).death);
  changePhase(match, day.order[day.speakerIndex] ? 'discussion' : 'exile-open');
}

export function advanceDiscussion(match) {
  const seat = match.day.order[match.day.speakerIndex];
  const player = playerAt(match, seat);
  if (player.delayedDeath) {
    const deaths = concludeDelayedDeaths(match, [player]);
    addHistory(match, 'day', 'departed', { seat });
    processDeaths(match, deaths, 'speech');
  } else {
    nextDiscussionSpeaker(match);
  }
}

export function openNomination(match) {
  changePhase(match, 'nomination');
}

export function settleNomination(match, nominations) {
  match.day.nominations = nominations;
  addHistory(match, 'day', 'nomination', { seats: nominations });
  if (nominations.length > 1) beginExileRunoff(match, nominations);
  else changePhase(match, 'exile-locked');
}

export function openExileVote(match, runoff = false) {
  const seats = livingPlayers(match).map(player => player.seat);
  const targets = runoff ? match.day.runoffTargets : seats;
  match.day.ballot = { voters: seats, targets, votes: {} };
  changePhase(match, runoff ? 'exile-runoff-vote' : 'exile-vote');
}

function beginExileRunoff(match, targets, fromVote = false) {
  match.day.runoffTargets = targets;
  match.day.runoffSpeakers = runoffOrder(match.day.order, targets);
  match.day.runoffIndex = 0;
  match.day.runoffFromVote = fromVote;
  changePhase(match, 'exile-runoff-speech');
}

export function advanceRunoff(match) {
  match.day.runoffIndex++;
  if (match.day.runoffSpeakers[match.day.runoffIndex]) changePhase(match, 'exile-runoff-speech');
  else openExileVote(match, true);
}

export function closeExileVote(match) {
  const runoff = match.phase === 'exile-runoff-vote';
  const { ballot, nominations = [] } = match.day;
  const { counts, leaders, ballot: details } = tallyVotes(ballot.votes, exileWeight(match.sheriff, nominations, runoff));
  addHistory(match, 'day', 'exile-vote', { counts, ballot: details, runoff });
  if (leaders.length > 1 && !runoff) {
    beginExileRunoff(match, leaders, true);
  } else if (leaders.length === 1) {
    const [seat] = leaders;
    const deaths = formalDeaths(match, [{ seat, cause: 'exile', time: 'day' }]);
    revealDeaths(match, deaths);
    addHistory(match, 'day', 'exile', { seat });
    processDeaths(match, deaths, 'night');
  } else {
    addHistory(match, 'day', 'peaceful-day');
    changePhase(match, 'next-night');
  }
}

export function canSelfDestruct(match, player) {
  if ((!isPackWolf(player) && player.role !== 'mechanical') || player.role === 'wolfBeauty' || match.winner) return false;
  const beforeBadge = electionOpen(match) || (match.phase === 'dawn' && electionDue(match));
  if (player.death && !(beforeBadge && player.death.round === match.round && player.death.cause === 'poison')) return false;
  return beforeBadge || ['dawn', 'speech-direction', 'discussion', 'exile-open'].includes(match.phase)
    || (match.phase === 'exile-runoff-speech' && match.day.runoffFromVote);
}

export function selfDestruct(match, player) {
  const inElection = electionOpen(match) || (match.phase === 'dawn' && electionDue(match));
  const unpublished = !match.day.published;
  if (!player.death) player.canDiscussNextNight = match.round + 1;
  const [death] = formalDeaths(match, [{ seat: player.seat, cause: 'explosion', time: 'day' }]);
  player.announced = true;
  match.day.interrupted = true;
  match.day.exploded = player.seat;
  match.day.explosion = death ?? { ...player.death, cause: 'explosion', time: 'day' };
  addHistory(match, 'day', 'explosion', { seat: player.seat });
  if (inElection && !match.winner) interruptElection(match, player.seat);
  if (unpublished) publishNight(match);
  else if (!match.winner) {
    const pending = concludeDelayedDeaths(match, livingPlayers(match).filter(entry => entry.delayedDeath), true);
    for (const delayed of pending) addHistory(match, 'day', 'departed', { seat: delayed.seat });
    processDeaths(match, [match.day.explosion, ...pending], 'night');
  }
}
