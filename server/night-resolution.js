import { formalDeaths, isPackWolf, playerAt } from './match-state.js';

export function knifeOwners(match, alive) {
  if (match.round === 1 && (match.board === 'thief' || match.customRules?.firstNightKnife === 'disabled')) return [];
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
  if (target.role === 'wolf' || target.role === 'wolfBeauty') return { claws: 1 };
  if (target.role === 'wolfKing') return { claws: 2 };
  if (target.role === 'thief') return { role: target.form === 'power' ? target.extra[0] : 'villager' };
  return { role: target.role };
}

export function nightTarget(night, seat) {
  if (!night.swap) return seat;
  const [first, second] = night.swap;
  if (seat === first) return second;
  return seat === second ? first : seat;
}

// Blocking causes take precedence for gun eligibility if multiple night effects hit one seat.
const priority = { wolfKnife: 1, milk: 1, extraKnife: 2, poison: 3, dreamRepeat: 3, dreamLink: 3, charm: 4 };

export function nightDeaths(night) {
  const causes = new Map();
  const dreams = night.dreams ?? [];
  const dreamed = new Set(dreams.map(dream => nightTarget(night, dream.target)));
  const add = (seat, cause) => {
    if (seat && (!causes.has(seat) || priority[cause] > priority[causes.get(seat)])) causes.set(seat, cause);
  };

  const knife = nightTarget(night, night.knife);
  if (knife && !dreamed.has(knife)) {
    const saved = night.saved === night.knife;
    const guarded = (night.guards ?? []).includes(night.knife) || night.mechanicalGuard === night.knife;
    if (!saved && !guarded) add(knife, 'wolfKnife');
    if (saved && guarded) add(knife, 'milk');
  }
  for (const { source, target, witch } of night.poisons ?? []) {
    const recipient = nightTarget(night, target);
    if (dreamed.has(recipient)) continue;
    if (witch && night.mechanicalGuard === target) add(source, 'poison');
    else add(recipient, 'poison');
  }
  for (const { target, repeat } of dreams) {
    if (repeat) add(nightTarget(night, target), 'dreamRepeat');
  }
  add(nightTarget(night, night.extraKnife), 'extraKnife');

  const links = dreams.map(({ source, target }) => ({ source, target, cause: 'dreamLink' }));
  if (night.charm) links.push({ ...night.charm, cause: 'charm' });
  const linked = new Set();
  while (true) {
    const link = links.find(item => causes.has(item.source) && !linked.has(item));
    if (!link) break;
    linked.add(link);
    const target = nightTarget(night, link.target);
    if (target !== link.source) add(target, link.cause);
  }
  return [...causes].map(([seat, cause]) => ({ seat, cause, time: 'night' }));
}

export function settleNightDeaths(match) {
  const immediate = [];
  for (const death of nightDeaths(match.night)) {
    const player = playerAt(match, death.seat);
    if (player.role === 'masked' && death.cause !== 'charm') player.delayedDeath = death;
    else immediate.push(death);
  }
  return formalDeaths(match, immediate);
}
