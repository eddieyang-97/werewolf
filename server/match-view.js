import { canSelfDestruct } from './match-day.js';
import { electionOpen } from './match-election.js';
import { isPackWolf, playerAt, roster } from './match-state.js';
import { fixedChoices, gunReport } from './night-actions.js';

export function publicSpeaker(match) {
  switch (match.phase) {
    case 'last-words': return match.deathFlow.current.death.seat;
    case 'discussion': return match.day.order[match.day.speakerIndex];
    case 'exile-runoff-speech': return match.day.runoffSpeakers[match.day.runoffIndex];
    case 'sheriff-speech':
    case 'sheriff-runoff-speech': return match.election.speakers[match.election.speakerIndex];
    default: return null;
  }
}

function privateNight(match, player) {
  const inNight = match.phase === 'night';
  const recoveringRecognition = match.round === 1 && !match.winner
    && match.customRules?.firstNightKnife === 'disabled';
  if (!inNight && !recoveringRecognition) return {};
  const { step, alive } = match.night;
  const result = {};
  if (inNight && step?.seats.includes(player.seat)) {
    const options = fixedChoices(match, player, step.kind);
    if (options) {
      result.nightAction = { kind: step.kind, window: match.window, options };
      if (step.kind === 'gun-check') result.nightAction.canShoot = gunReport(match, player);
    }
    if (step.kind === 'witch' && !player.used.antidote) result.wolfTarget = match.night.knife ?? null;
  }
  if (isPackWolf(player) && (alive.includes(player.seat) || player.canDiscussNextNight === match.round)) {
    result.teammates = match.players.filter(other => isPackWolf(other) && other.seat !== player.seat
      && (alive.includes(other.seat) || other.canDiscussNextNight === match.round))
      .map(other => other.seat);
  }
  return result;
}

export function matchView(match, seat) {
  const player = playerAt(match, seat);
  const phase = match.phase === 'gun' ? 'death-resolution' : match.phase;
  const result = {
    phase,
    round: match.round,
    sheriff: match.sheriff,
    speaker: publicSpeaker(match),
    timer: match.timer,
    departed: match.players.filter(person => person.announced).map(person => person.seat),
    history: match.history,
  };
  if (player) {
    result.self = {
      inspections: player.privateEvents,
      copied: player.copy?.role,
      disguise: player.form,
      model: player.modelChoice ?? player.model,
      canSelfDestruct: canSelfDestruct(match, player),
      ...privateNight(match, player),
    };
  }
  if (electionOpen(match) && match.phase !== 'sheriff-signup') result.candidates = match.election.candidates;
  if (match.winner) {
    result.winner = match.winner;
    if (match.forced) result.forced = true;
    if (match.winner !== 'abandoned') result.roster = roster(match);
  }
  return result;
}
