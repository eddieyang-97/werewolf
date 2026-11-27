import { addHistory, changePhase, playerAt, randomSeatOrder } from './match-state.js';
import { electionVoters, runoffOrder, tallyVotes } from './match-vote.js';

const phases = {
  signup: 'sheriff-signup',
  speech: 'sheriff-speech',
  vote: 'sheriff-vote',
  runoffSpeech: 'sheriff-runoff-speech',
  runoffVote: 'sheriff-runoff-vote',
};

export function electionOpen(match) {
  return Object.values(phases).includes(match.phase);
}

export function electionSpeechOpen(match) {
  return match.phase === phases.speech || match.phase === phases.runoffSpeech;
}

export function electionDue(match) {
  return match.sheriffMode !== 'none' && (match.election?.status === 'postponed' || (match.round === 1 && !match.election));
}

export function electionEligible(match) {
  // Night casualties remain undisclosed during the pre-announcement election.
  return match.players.filter(player => !player.announced).map(player => player.seat);
}

export function electionRoster(match) {
  if (!electionOpen(match) || match.phase === phases.signup) return;
  const election = match.election;
  const { candidates } = election;
  const eligible = electionEligible(match);
  const runoff = match.phase === phases.runoffSpeech || match.phase === phases.runoffVote;
  const withdrew = runoff ? election.pkWithdrawn : election.entered.filter(seat => !candidates.includes(seat));
  return {
    candidates: runoff ? runoffOrder(election.order, candidates) : election.order.filter(seat => candidates.includes(seat)),
    voters: electionVoters(eligible, election, runoff),
    withdrawn: eligible.filter(seat => withdrew.includes(seat)),
  };
}

function settleElection(match, seat) {
  match.sheriff = seat;
  match.election.status = 'completed';
  addHistory(match, 'day', 'sheriff', { seat });
  changePhase(match, 'dawn');
}

export function startElection(match) {
  if (!match.election) {
    match.election = { status: 'open', signups: {}, entered: [], candidates: [], pkWithdrawn: [], postponed: false };
    changePhase(match, phases.signup);
    return;
  }

  const election = match.election;
  election.status = 'open';
  const eligible = electionEligible(match);
  election.candidates = election.candidates.filter(seat => eligible.includes(seat));
  if (election.resume === phases.signup) {
    changePhase(match, phases.signup);
    collectCandidacies(match);
  } else if (election.candidates.length <= 1) {
    settleElection(match, election.candidates[0] ?? null);
  } else if ([phases.vote, phases.runoffVote].includes(election.resume)) {
    openElectionVote(match, election.resume === phases.runoffVote);
  } else {
    changePhase(match, election.resume);
  }
}

export function collectCandidacies(match) {
  const election = match.election;
  const eligible = electionEligible(match);
  if (!eligible.every(seat => Object.hasOwn(election.signups, seat))) return;
  election.entered = eligible.filter(seat => election.signups[seat]);
  election.candidates = election.entered.slice();
  if (election.entered.length === eligible.length || election.entered.length === 0) {
    settleElection(match, null);
  } else if (election.entered.length === 1) {
    settleElection(match, election.entered[0]);
  } else {
    election.order = randomSeatOrder(match, election.candidates);
    changePhase(match, phases.speech);
  }
}

export function openElectionVote(match, runoff = match.phase === phases.runoffSpeech) {
  const election = match.election;
  const voters = electionVoters(electionEligible(match), election, runoff);
  election.ballot = { voters, votes: {} };
  changePhase(match, runoff ? phases.runoffVote : phases.vote);
  if (voters.length === 0) closeElectionVote(match);
}

export function withdrawCandidacy(match, seat) {
  const election = match.election;
  if (!electionSpeechOpen(match) || !election.candidates.includes(seat)) return false;
  election.candidates = election.candidates.filter(candidate => candidate !== seat);
  if (match.phase === phases.runoffSpeech) election.pkWithdrawn.push(seat);
  if (election.candidates.length <= 1) settleElection(match, election.candidates[0] ?? null);
  return true;
}

export function closeElectionVote(match) {
  const election = match.election;
  const { counts, leaders, ballot } = tallyVotes(election.ballot.votes);
  const runoff = match.phase === phases.runoffVote;
  addHistory(match, 'day', 'sheriff-vote', { counts, ballot, runoff });
  if (leaders.length > 1 && match.phase === phases.vote) {
    election.candidates = leaders;
    changePhase(match, phases.runoffSpeech);
  } else {
    settleElection(match, leaders.length === 1 ? leaders[0] : null);
  }
}

export function interruptElection(match, seat) {
  const election = match.election ?? {
    status: 'open', signups: {}, entered: [], candidates: [], pkWithdrawn: [], postponed: false,
  };
  match.election = election;
  election.candidates = election.candidates.filter(candidate => candidate !== seat && !playerAt(match, candidate).announced);
  const runoff = [phases.runoffSpeech, phases.runoffVote].includes(match.phase);
  if (match.sheriffMode === 'single') {
    settleElection(match, null);
  } else if (runoff && election.candidates.length === 1) {
    settleElection(match, election.candidates[0]);
  } else if (election.postponed) {
    settleElection(match, null);
  } else {
    election.postponed = true;
    election.status = 'postponed';
    election.resume = match.phase === 'dawn' ? phases.signup : match.phase;
  }
}
