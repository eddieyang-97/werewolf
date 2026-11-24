import { randomInt } from 'node:crypto';
import { thiefDraw } from '../public/boards.js';

const wolves = ['wolf', 'wolf', 'wolf'];
const villagers = ['villager', 'villager', 'villager', 'villager'];

export function buildDeck(board, choose = randomInt, lineup) {
  if (board === 'custom') return lineup.map(role => ({ role }));
  if (board === 'classic') {
    return [...wolves, 'wolf', ...villagers.slice(1), 'mixed', 'seer', 'witch', 'hunter', 'fool']
      .map(role => ({ role }));
  }
  if (board === 'mechanical') {
    return [...wolves, 'mechanical', ...villagers, 'medium', 'witch', 'guard', 'hunter']
      .map(role => ({ role }));
  }
  if (board !== 'thief') throw new TypeError('Unknown board');
  const selected = thiefDraw[choose(thiefDraw.length)];
  const deck = [...wolves, ...villagers, 'masked', ...thiefDraw.filter(role => role !== selected)]
    .map(role => ({ role }));
  return [...deck, { role: 'thief', extra: [selected, 'villager'] }];
}

export function shuffle(deck) {
  for (let index = deck.length - 1; index > 0; index--) {
    const target = randomInt(index + 1);
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return deck;
}
