import { randomInt } from 'node:crypto';
import { addHistory, changePhase, currentRole, isPackWolf, livingPlayers, playerAt, revealDeaths } from './match-state.js';
import { knifeOwners, mediumResult, nightDeaths, nightTarget, settleNightDeaths } from './night-resolution.js';
import { nightSchedules } from '../public/boards.js';

export const mechanicalNightOrder = nightSchedules.mechanical;

export function beginNight(match, order, rules, now) {
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
  advanceNight(match, rules, now);
}

function stepFor(match, position) {
  const { alive, wolves } = match.night;
  const players = alive.map(seat => playerAt(match, seat));
  if (position === 'knife') {
    if (match.board === 'custom' && match.round === 1 && !wolves.length) {
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

// A quiet slot can last as long as one with a pending action.
function cueDelay() {
  let delay = randomInt(4_000);
  while (randomInt(2) === 0) delay += 4_000;
  return delay;
}

export function currentNightCue(match) {
  const { order, cursor } = match.night;
  const position = order[cursor];
  return { matchId: match.id, round: match.round, role: { knife: 'wolf', 'thief-start': 'thief' }[position] ?? position };
}

// Only the controlling host observing this exact public cue can move the call along.
export function progressNightCue(match, seen, rules, now) {
  if (!match?.nightNarration || match.phase !== 'night' || seen?.matchId !== match.id) return false;
  const cue = currentNightCue(match);
  if (seen.round !== cue.round || seen.role !== cue.role || now < match.night.nextCueCheck) return false;
  if (match.night.step) match.night.nextCueCheck = now + 1_000 + cueDelay();
  else advanceNight(match, rules, now);
  return true;
}

export function advanceNight(match, rules, now = Date.now()) {
  const { night } = match;
  while (++night.cursor < night.order.length) {
    night.step = eligibleStep(match, night.order[night.cursor], rules);
    if (match.nightNarration) night.nextCueCheck = now + 8_000 + cueDelay();
    else if (!night.step) continue;
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
