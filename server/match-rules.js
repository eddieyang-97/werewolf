import { isPackWolf, playerAt } from './match-state.js';
import { pendingVoters } from './match-vote.js';
import { nightSchedules } from '../public/boards.js';

function witchChoices(match, player) {
  const { knife, alive } = match.night;
  const choices = [];
  const canSelfSave = match.customRules?.witchSelfSave === 'allowed';
  if (knife && !player.used.antidote && (knife !== player.seat || canSelfSave)) choices.push('save');
  if (!player.used.poison) choices.push(...alive.map(seat => `poison:${seat}`));
  return choices.length ? [null, ...choices] : [];
}

export const matchRules = {
  nightOrder: board => nightSchedules[board],
  nightChoices(match, player, kind) {
    const { alive } = match.night;
    switch (kind) {
      case 'knife': return [null, ...alive.filter(seat => playerAt(match, seat).role !== 'wolfKing')];
      case 'mixed':
      case 'seer': return alive.filter(seat => seat !== player.seat);
      case 'witch': return witchChoices(match, player);
      default: throw new Error(`Unknown night action: ${kind}`);
    }
  },
  applyNightChoice(match, player, kind, choice) {
    const { night } = match;
    switch (kind) {
      case 'knife':
        night.knife = choice;
        break;
      case 'mixed':
        player.model = choice;
        break;
      case 'seer':
        player.privateEvents.push({ kind, round: match.round, seat: choice, team: isPackWolf(playerAt(match, choice)) ? 'wolves' : 'village' });
        break;
      case 'witch':
        if (choice === 'save') {
          night.saved = night.knife;
          player.used.antidote = true;
        } else if (choice !== null) {
          night.poisons.push({ source: player.seat, target: Number(choice.slice('poison:'.length)), witch: true });
          player.used.poison = true;
        }
        break;
    }
    return true;
  },
  ballotTargets: (ballot, seat) => ballot.targets.filter(target => target !== seat),
  abstention: true,
  earlyClose: (_match, ballot) => pendingVoters(ballot).length > 0,
};
