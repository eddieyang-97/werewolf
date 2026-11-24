import { formalDeaths, isPackWolf, playerAt } from './match-state.js';

export function knifeOwners(match, alive) {
  if (match.board === 'thief' && match.round === 1) return [];
  const wolves = alive.filter(isPackWolf);
  if (wolves.length) return wolves.map(player => player.seat);
  return alive.filter(player => ['mechanical', 'thief'].includes(player.role)).map(player => player.seat);
}

export function mediumResult(target) {
  if (target.role === 'mechanical') {
    if (!target.copy) return { claws: 2 };
    if (target.copy.role === 'wolf') return { claws: 1 };
    return { role: target.copy.role, mechanical: true };
  }
  if (target.role === 'wolf') return { claws: 1 };
  if (target.role === 'wolfKing') return { claws: 2 };
  if (target.role === 'thief') return { role: target.form === 'power' ? target.extra[0] : 'villager' };
  return { role: target.role };
}

// Blocking causes take precedence for gun eligibility if multiple night effects hit one seat.
const priority = { wolfKnife: 1, milk: 1, extraKnife: 2, poison: 3, dreamRepeat: 3, dreamLink: 3 };

export function nightDeaths(night) {
  const causes = new Map();
  const dreams = night.dreams ?? [];
  const dreamed = new Set(dreams.map(dream => dream.target));
  const add = (seat, cause) => {
    if (seat && (!causes.has(seat) || priority[cause] > priority[causes.get(seat)])) causes.set(seat, cause);
  };

  if (night.knife && !dreamed.has(night.knife)) {
    const saved = night.saved === night.knife;
    const guarded = (night.guards ?? []).includes(night.knife) || night.mechanicalGuard === night.knife;
    if (!saved && !guarded) add(night.knife, 'wolfKnife');
    if (saved && guarded) add(night.knife, 'milk');
  }
  for (const { source, target, witch } of night.poisons ?? []) {
    if (dreamed.has(target)) continue;
    if (witch && night.mechanicalGuard === target) add(source, 'poison');
    else add(target, 'poison');
  }
  for (const { target, repeat } of dreams) {
    if (repeat) add(target, 'dreamRepeat');
  }
  add(night.extraKnife, 'extraKnife');

  const linked = new Set();
  while (true) {
    const dream = dreams.find(item => causes.has(item.source) && !linked.has(item.source));
    if (!dream) break;
    linked.add(dream.source);
    add(dream.target, 'dreamLink');
  }
  return [...causes].map(([seat, cause]) => ({ seat, cause, time: 'night' }));
}

export function settleNightDeaths(match) {
  const immediate = [];
  for (const death of nightDeaths(match.night)) {
    const player = playerAt(match, death.seat);
    if (player.role === 'masked') player.delayedDeath = death;
    else immediate.push(death);
  }
  return formalDeaths(match, immediate);
}
