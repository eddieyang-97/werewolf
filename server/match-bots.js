import { randomInt } from 'node:crypto';
import { executeMatchChoice, getBallot, interruptActions, seatActions } from './match-controller.js';
import { electionSpeechOpen } from './match-election.js';
import { playerAt } from './match-state.js';
import { publicSpeaker } from './match-view.js';
import { pendingVoters } from './match-vote.js';

// Leave time for the normal 1.8-second poll and a player's confirmation.
const HUMAN_RESPONSE_DELAY = 6_000;
const MAX_BOT_ACTIONS_PER_REQUEST = 16;
const INTERRUPT_ODDS = 32;
const interrupts = new Set(['withdraw', 'self-destruct', 'duel']);

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
  const botSeats = new Set(bots.map(bot => bot.seat));

  let changed = false;
  let interruptsCheckedFor;
  // Subsequent polls continue from the choices saved by this request.
  for (let count = 0; count < MAX_BOT_ACTIONS_PER_REQUEST && !match.winner; count++) {
    const speaker = publicSpeaker(match);
    const ballot = getBallot(match);
    const pending = ballot ? pendingVoters(ballot) : [];
    // Base the pause on the ballot, so its timing never signals who can self-destruct.
    if (botSeats.has(speaker) || (ballot?.election && pending.length && pending.every(seat => botSeats.has(seat)))) {
      if (match.botDelay?.window !== match.window) {
        match.botDelay = { window: match.window, endsAt: now + HUMAN_RESPONSE_DELAY };
        return true;
      }
      if (now < match.botDelay.endsAt) break;
    }

    // A shared wolf prompt is settled by the first submission. Leave it open for a human wolf.
    const nightSeats = match.phase === 'night' ? match.night.step?.seats ?? [] : null;
    if (nightSeats?.some(seat => !botSeats.has(seat))) break;
    const eligible = ballot || nightSeats ? new Set(nightSeats ?? pending) : null;

    // Look for interrupts without building each bot's ordinary choices.
    if (interruptsCheckedFor !== match.window) {
      const decided = new Set(match.botInterrupts?.window === match.window ? match.botInterrupts.decided : []);
      const candidates = new Set(electionSpeechOpen(match) ? match.election.candidates : []);
      const interrupted = bots.some(bot => {
        if (decided.has(bot.seat)) return false;
        const optional = interruptActions(match, playerAt(match, bot.seat), candidates.has(bot.seat));
        if (!optional.length) return false;
        if (match.botInterrupts?.window !== match.window) match.botInterrupts = { window: match.window, decided: [] };
        // Save the decision, including a pass, so subsequent polls do not reroll it.
        match.botInterrupts.decided.push(bot.seat);
        changed = true;
        return choose(INTERRUPT_ODDS) === 0 && play(room, bot, optional[choose(optional.length)], rules, now, choose);
      });
      if (interrupted) continue;
      interruptsCheckedFor = match.window;
    }

    const acted = bots.some(bot => {
      if ((eligible && !eligible.has(bot.seat)) || (speaker && bot.seat !== speaker)) return false;
      const action = seatActions(room, bot, rules, now).find(entry => !interrupts.has(entry.kind));
      return action && play(room, bot, action, rules, now, choose);
    });
    if (!acted) break;
    changed = true;
  }
  return changed;
}
