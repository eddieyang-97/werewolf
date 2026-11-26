import { randomInt, randomUUID } from 'node:crypto';
import { defaultSheriffMode } from '../public/boards.js';

export function createMatch(board, guests, sheriffMode = defaultSheriffMode, customRules) {
  return {
    id: randomUUID(),
    board,
    sheriffMode,
    ...(customRules ? { customRules: { ...customRules } } : {}),
    round: 0,
    window: null,
    sheriff: null,
    players: guests.map(({ seat, assignment }) => ({
      seat,
      role: assignment.role,
      extra: assignment.extra,
      used: {},
      privateEvents: [],
    })).sort((a, b) => a.seat - b.seat),
    history: [],
  };
}

export function playerAt(match, seat) {
  // Dealt rosters store one player per seat in seat order.
  const player = match.players[seat - 1];
  if (player && player.seat === seat) return player;
  return match.players.find(player => player.seat === seat);
}

export function isPackWolf(player) {
  return ['wolf', 'wolfKing', 'wolfBeauty'].includes(player.role);
}

export function isWolf(player) {
  return isPackWolf(player) || player.role === 'mechanical' || player.role === 'thief';
}

export function livingPlayers(match) {
  return match.players.filter(player => !player.death);
}

export function currentRole(player) {
  if (player.role === 'thief') return player.form === 'power' ? player.extra[0] : 'villager';
  return player.role;
}

export function changePhase(match, phase) {
  match.phase = phase;
  match.window = randomUUID();
  delete match.timer;
}

export function finishMatch(match, winner) {
  match.winner = winner;
  changePhase(match, 'finished');
}

export function checkVictory(match) {
  const living = livingPlayers(match);
  const good = living.filter(player => !isWolf(player));
  const wolvesWin = match.customRules?.victoryMode === 'town'
    ? good.length === 0
    : !good.some(player => ['mixed', 'villager'].includes(player.role))
      || !good.some(player => !['mixed', 'villager'].includes(player.role));
  if (wolvesWin) {
    finishMatch(match, 'wolves');
  } else if (!living.some(isWolf)) {
    finishMatch(match, 'village');
  }
  return match.winner;
}

// Related deaths become formal together, so both victory conditions see the same roster.
export function formalDeaths(match, deaths) {
  if (match.winner) return [];

  const departed = [];
  for (const { seat, cause, time } of deaths) {
    const player = playerAt(match, seat);
    if (!player || player.death) continue;
    player.death = { seat, cause, time, round: match.round };
    delete player.delayedDeath;
    departed.push(player.death);
  }
  if (departed.length) checkVictory(match);
  return departed;
}

export function revealDeaths(match, deaths) {
  for (const { seat } of deaths) playerAt(match, seat).announced = true;
}

export function addHistory(match, phase, kind, detail = {}) {
  match.history.push({ round: match.round, phase, kind, ...detail });
}

export function seatOrder(match, seats, anchor, direction, includeAnchor = false) {
  const count = match.players.length;
  const start = includeAnchor ? 0 : 1;
  return Array.from({ length: count }, (_, index) => ((anchor - 1 + direction * (index + start) + count) % count) + 1)
    .filter(seat => seats.includes(seat));
}

export function randomSeatOrder(match, seats, choose = randomInt) {
  const start = choose(match.players.length) + 1;
  return seatOrder(match, seats, start, start % 2 ? 1 : -1, true);
}

export function winningSide(match, player) {
  const model = player.role === 'mixed' && player.model ? playerAt(match, player.model) : player;
  return isWolf(model) ? 'wolves' : 'village';
}

export function roster(match) {
  return match.players.map(player => ({
    seat: player.seat,
    role: player.role,
    extra: player.extra,
    side: winningSide(match, player),
  }));
}

export function gunAvailable(match, player, death) {
  if (player.role === 'wolfKing') return death.time === 'day' && ['exile', 'duel'].includes(death.cause);
  if (death.time === 'shot' || !['exile', 'wolfKnife', 'milk'].includes(death.cause)) return false;
  if (player.role === 'mechanical') {
    return player.copy?.role === 'hunter' && (death.time !== 'night' || player.copy.round < match.round);
  }
  return currentRole(player) === 'hunter';
}
