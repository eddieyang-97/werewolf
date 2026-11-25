import { addHistory, changePhase, currentRole, isPackWolf, livingPlayers, playerAt, revealDeaths } from './match-state.js';
import { knifeOwners, mediumResult, nightDeaths, settleNightDeaths } from './night-resolution.js';
import { nightSchedules } from '../public/boards.js';

export const mechanicalNightOrder = nightSchedules.mechanical;

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
  return { kind: { hunter: 'gun-check', poisoner: 'poison' }[position] ?? position, seats: [player.seat] };
}

export function fixedChoices(match, player, kind) {
  const { alive, wolves } = match.night;
  switch (kind) {
    case 'thief-start': return ['power', 'common'];
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

export function advanceNight(match, rules) {
  const { night } = match;
  while (++night.cursor < night.order.length) {
    const step = stepFor(match, night.order[night.cursor]);
    if (!step?.seats.length) continue;
    const { seats, kind } = step;
    if (seats.length === 1) {
      const player = playerAt(match, seats[0]);
      const choices = fixedChoices(match, player, kind) ?? rules?.nightChoices(match, player, kind);
      if (choices?.length === 0) continue;
    }
    night.step = step;
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
    case 'guard':
    case 'mechanical-guard':
      player.previousGuard = choice;
      if (kind === 'mechanical-guard') night.mechanicalGuard = choice;
      else if (choice !== null) night.guards.push(choice);
      break;
    case 'dreamer':
      if (choice !== null) {
        night.dreams.push({ source: player.seat, target: choice, repeat: choice === player.previousDream });
        player.previousDream = choice;
      }
      break;
    case 'learn':
      if (choice !== null) player.copy = { seat: choice, role: playerAt(match, choice).role, round: match.round };
      break;
    case 'medium':
      if (choice !== null) {
        player.privateEvents.push({ kind, round: match.round, seat: choice, ...mediumResult(playerAt(match, choice)) });
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
