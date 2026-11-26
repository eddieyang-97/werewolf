import { randomInt } from 'node:crypto';
import { executeMatchChoice, seatActions } from './match-controller.js';
import { publicSpeaker } from './match-view.js';

const SPEECH_DELAY = 1_500;
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

  let changed = false;
  while (!match.winner) {
    const speaker = publicSpeaker(match);
    if (speaker !== null) {
      const bot = bots.find(guest => guest.seat === speaker);
      if (!bot) break;
      // Give human seats time to see the speaker and use any legal interruption.
      if (match.botSpeech?.window !== match.window) {
        match.botSpeech = { window: match.window, endsAt: now + SPEECH_DELAY };
        return true;
      }
      if (now < match.botSpeech.endsAt) break;
      const actions = seatActions(room, bot, rules);
      const optional = actions.filter(action => interrupts.has(action.kind));
      const action = optional.length && choose(8) === 0
        ? optional[choose(optional.length)] : actions.find(action => action.kind === 'finish-speech');
      if (!action || !play(room, bot, action, rules, now, choose)) break;
      changed = true;
      continue;
    }

    // A shared wolf prompt is settled by the first submission. Leave it open for a human wolf.
    if (match.phase === 'night' && room.guests.some(guest => !guest.bot && match.night.step?.seats.includes(guest.seat))) break;

    let acted = false;
    for (const bot of bots) {
      const action = seatActions(room, bot, rules).find(entry => !interrupts.has(entry.kind));
      if (action && play(room, bot, action, rules, now, choose)) {
        acted = true;
        break;
      }
    }
    if (!acted) break;
    changed = true;
  }
  return changed;
}
