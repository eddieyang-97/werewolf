import { randomInt } from 'node:crypto';
import { executeMatchChoice, seatActions } from './match-controller.js';
import { publicSpeaker } from './match-view.js';
import { pendingVoters } from './match-vote.js';

const SPEECH_DELAY = 1_500;
const SHERIFF_VOTE_DELAY = 6_000;
const INTERRUPT_ODDS = 32;
const interrupts = new Set(['withdraw', 'self-destruct', 'duel']);

function botDelay(match, bots) {
  if (match.phase === 'sheriff-vote' || match.phase === 'sheriff-runoff-vote') {
    const pending = pendingVoters(match.election.ballot);
    // Base the pause on the ballot, so its timing never signals who can self-destruct.
    if (pending.length && pending.every(seat => bots.some(bot => bot.seat === seat))) return SHERIFF_VOTE_DELAY;
  }
  const speaker = publicSpeaker(match);
  return bots.some(bot => bot.seat === speaker) ? SPEECH_DELAY : 0;
}

function randomChoice(action, choose) {
  if (!action.options) return undefined;
  if (!action.multiple) return action.options[choose(action.options.length)];
  if (action.action === 'swap') {
    if (choose(2) === 0) return [];
    const first = action.options[choose(action.options.length)];
    const remaining = action.options.filter(seat => seat !== first);
    return [first, remaining[choose(remaining.length)]];
  }
  return action.options.filter(() => choose(2) === 0);
}

function play(room, bot, action, rules, now, choose) {
  const command = { kind: action.kind, matchId: room.match.id, window: room.match.window,
    choice: randomChoice(action, choose) };
  return executeMatchChoice(room, bot, command, rules, now);
}

export function progressBots(room, rules, now, choose = randomInt) {
  const { match } = room;
  if (!rules || !match || match.winner) return false;
  const bots = room.guests.filter(guest => guest.bot === true);
  if (!bots.length) return false;

  let changed = false;
  while (!match.winner) {
    const delay = botDelay(match, bots);
    if (delay) {
      if (match.botDelay?.window !== match.window) {
        match.botDelay = { window: match.window, endsAt: now + delay };
        return true;
      }
      if (now < match.botDelay.endsAt) break;
    }

    // A shared wolf prompt is settled by the first submission. Leave it open for a human wolf.
    if (match.phase === 'night' && room.guests.some(guest => !guest.bot && match.night.step?.seats.includes(guest.seat))) break;

    const turns = bots.map(bot => ({ bot, actions: seatActions(room, bot, rules) }));
    let interrupted = false;
    for (const { bot, actions } of turns) {
      const optional = actions.filter(action => interrupts.has(action.kind));
      if (!optional.length) continue;
      if (match.botInterrupts?.window !== match.window) match.botInterrupts = { window: match.window, decided: [] };
      const { decided } = match.botInterrupts;
      if (decided.includes(bot.seat)) continue;

      // Save the decision, including a pass, so subsequent polls do not reroll it.
      decided.push(bot.seat);
      changed = true;
      if (choose(INTERRUPT_ODDS) !== 0) continue;
      if (!play(room, bot, optional[choose(optional.length)], rules, now, choose)) continue;
      interrupted = true;
      break;
    }
    if (interrupted) continue;

    const acted = turns.some(({ bot, actions }) => {
      const action = actions.find(entry => !interrupts.has(entry.kind));
      return action && play(room, bot, action, rules, now, choose);
    });
    if (!acted) break;
    changed = true;
  }
  return changed;
}
