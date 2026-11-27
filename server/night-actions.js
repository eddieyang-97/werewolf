import { randomInt } from 'node:crypto';
import { addHistory, changePhase, currentRole, isPackWolf, livingPlayers, playerAt, revealDeaths } from './match-state.js';
import { knifeOwners, mediumResult, nightDeaths, nightTarget, settleNightDeaths } from './night-resolution.js';
import { nightSchedules } from '../public/boards.js';

export const mechanicalNightOrder = nightSchedules.mechanical;
export const nightChoiceDuration = 20_000;

export function beginNight(match, order, rules) {
  match.round++;
  const alive = livingPlayers(match);
  const thief = alive.find(player => player.role === 'thief');
  if (thief?.form) thief.form = thief.form === 'power' ? 'common' : 'power';
  match.night = {
    alive: alive.map(player => player.seat),
    wolves: knifeOwners(match, alive),
    order,
    cursor: -1,
    guards: [],
    poisons: [],
    dreams: [],
  };
  advanceNight(match, rules);
}

function firstNightWolfRecognition(match) {
  return match.board === 'custom' && match.round === 1 && match.customRules?.firstNightKnife === 'disabled';
}

function stepFor(match, position) {
  const { alive, wolves } = match.night;
  const players = alive.map(seat => playerAt(match, seat));
  if (position === 'knife') {
    if (firstNightWolfRecognition(match)) {
      return { kind: 'wolf-recognition', seats: players.filter(isPackWolf).map(player => player.seat) };
    }
    return { kind: 'knife', seats: wolves };
  }
  if (position === 'thief-start') {
    const thief = players.find(player => player.role === 'thief');
    return thief && match.round === 1 ? { kind: 'thief-start', seats: [thief.seat] } : null;
  }
  if (position === 'mixed' && match.round > 1) return null;
  if (position === 'mechanical') {
    const player = players.find(entry => entry.role === 'mechanical');
    if (!player) return null;
    if (!player.copy) return { kind: 'learn', seats: [player.seat] };
    const copy = { guard: 'mechanical-guard', witch: 'mechanical-poison', wolf: 'extra-knife', hunter: 'gun-check', medium: 'medium' };
    const kind = copy[player.copy.role];
    return kind ? { kind, seats: [player.seat] } : null;
  }
  const player = players.find(entry => currentRole(entry) === position);
  if (!player) return null;
  return { kind: { hunter: 'gun-check', poisoner: 'poison', magician: 'swap', wolfBeauty: 'charm' }[position] ?? position,
    seats: [player.seat] };
}

export function fixedChoices(match, player, kind) {
  const { alive, wolves } = match.night;
  switch (kind) {
    case 'thief-start': return ['power', 'common'];
    case 'swap': {
      const targets = alive.filter(seat => !player.swappedSeats?.includes(seat));
      return targets.length >= 2 ? targets : [];
    }
    case 'charm': {
      const previous = player.previousCharm?.round === match.round - 1 ? player.previousCharm.seat : null;
      return alive.filter(seat => seat !== player.seat && seat !== previous);
    }
    case 'guard':
    case 'mechanical-guard': return [null, ...alive.filter(seat => seat !== player.previousGuard)];
    case 'dreamer': return [null, ...alive.filter(seat => seat !== player.seat)];
    case 'medium': return alive.filter(seat => seat !== player.seat);
    case 'learn': return [null, ...alive.filter(seat => seat !== player.seat)];
    case 'extra-knife': return !player.used.extraKnife && wolves.includes(player.seat) ? [null, ...alive] : [];
    case 'poison':
    case 'mechanical-poison': return player.used.poison ? [] : [null, ...alive];
    case 'gun-check':
    case 'wolf-recognition': return ['confirm'];
    default: return null;
  }
}

function eligibleStep(match, position, rules) {
  const step = stepFor(match, position);
  if (!step?.seats.length) return null;
  if (step.seats.length === 1) {
    const player = playerAt(match, step.seats[0]);
    const choices = fixedChoices(match, player, step.kind) ?? rules?.nightChoices(match, player, step.kind);
    if (choices?.length === 0) return null;
  }
  return step;
}

export function currentNightCue(match) {
  const { order, cursor } = match.night;
  const position = order[cursor];
  return { matchId: match.id, round: match.round, role: { knife: 'wolf', 'thief-start': 'thief' }[position] ?? position };
}

export function pauseNightCue(match, cutoff) {
  const clock = match?.phase === 'night' && match.night.cueClock;
  if (clock?.deadline === undefined) return false;
  clock.remaining = Math.max(0, clock.deadline - cutoff);
  delete clock.deadline;
  return true;
}

export function nightChoiceExpired(match, now) {
  if (match.night?.step?.kind === 'wolf-recognition') return false;
  const clock = match.night?.cueClock;
  return clock?.deadline === undefined ? clock?.remaining === 0 : now >= clock.deadline;
}

export function applyNightAction(match, player, choice, rules) {
  const { night } = match;
  const { kind } = night.step;
  if (fixedChoices(match, player, kind) !== null) applyNightEffect(match, player, kind, choice);
  else if (!rules.applyNightChoice(match, player, kind, choice)) return;
  if (match.nightNarration) night.step = null;
  else advanceNight(match, rules);
}

// Only the controlling host observing this exact public cue can move the call along.
export function progressNightCue(match, seen, rules, now) {
  if (!match?.nightNarration || match.phase !== 'night' || seen?.matchId !== match.id) return false;
  const cue = currentNightCue(match);
  if (seen.round !== cue.round || seen.role !== cue.role) return false;
  const { night } = match;
  // Keep this call open until a wolf has explicitly cleared the shared step.
  if (cue.role === 'wolf' && firstNightWolfRecognition(match)) {
    if (night.step) return false;
    advanceNight(match, rules);
    return true;
  }
  const clock = night.cueClock ??= { remaining: nightChoiceDuration };
  if (clock.deadline === undefined && clock.remaining > 0) {
    clock.deadline = now + clock.remaining;
    return true;
  }
  if (!nightChoiceExpired(match, now)) return false;
  if (night.step) {
    const { seats, kind } = night.step;
    const player = playerAt(match, seats[0]);
    const choices = fixedChoices(match, player, kind) ?? rules.nightChoices(match, player, kind);
    // Use the legal pass where available. Required choices get a legal option.
    const fallback = kind === 'swap' ? [] : choices.includes(null) ? null : choices[randomInt(choices.length)];
    applyNightAction(match, player, fallback, rules);
  }
  advanceNight(match, rules);
  return true;
}

export function advanceNight(match, rules) {
  const { night } = match;
  delete night.cueClock;
  while (++night.cursor < night.order.length) {
    night.step = eligibleStep(match, night.order[night.cursor], rules);
    if (!match.nightNarration && !night.step) continue;
    changePhase(match, 'night');
    return;
  }
  night.step = null;
  const deaths = settleNightDeaths(match);
  if (match.winner) {
    revealDeaths(match, deaths);
    addHistory(match, 'night', 'night-result', { seats: deaths.map(death => death.seat) });
    return;
  }
  match.day = { deaths, interrupted: false };
  changePhase(match, 'dawn');
}

export function gunReport(match, player) {
  const effect = nightDeaths(match.night).find(death => death.seat === player.seat);
  return !effect || ['wolfKnife', 'milk'].includes(effect.cause);
}

export function applyNightEffect(match, player, kind, choice) {
  const { night } = match;
  switch (kind) {
    case 'thief-start':
      player.form = choice;
      break;
    case 'swap':
      if (choice.length) {
        night.swap = choice;
        player.swappedSeats = [...(player.swappedSeats ?? []), ...choice];
      }
      break;
    case 'charm':
      player.previousCharm = { seat: choice, round: match.round };
      night.charm = { source: player.seat, target: choice };
      break;
    case 'guard':
    case 'mechanical-guard':
      player.previousGuard = choice;
      if (kind === 'mechanical-guard') night.mechanicalGuard = choice;
      else if (choice !== null) night.guards.push(choice);
      break;
    case 'dreamer':
      if (choice !== null) {
        const target = nightTarget(night, choice);
        night.dreams.push({ source: player.seat, target: choice, repeat: target === player.previousDream });
        player.previousDream = target;
      }
      break;
    case 'learn':
      if (choice !== null) player.copy = { seat: choice, role: playerAt(match, choice).role, round: match.round };
      break;
    case 'medium':
      if (choice !== null) {
        player.privateEvents.push({ kind, round: match.round, seat: choice, ...mediumResult(playerAt(match, nightTarget(night, choice))) });
      }
      break;
    case 'extra-knife':
      if (choice !== null) {
        player.used.extraKnife = true;
        night.extraKnife = choice;
      }
      break;
    case 'poison':
    case 'mechanical-poison':
      if (choice !== null) {
        player.used.poison = true;
        night.poisons.push({ source: player.seat, target: choice });
      }
      break;
    case 'gun-check':
    case 'wolf-recognition':
      break;
    default:
      throw new Error(`Unknown fixed night action: ${kind}`);
  }
}
