export function pendingVoters(ballot) {
  return ballot.voters.filter(seat => !Object.hasOwn(ballot.votes, seat));
}

// Store votes as integer half-votes so the sheriff's 1.5 vote is exact.
export function tallyVotes(ballots, weight = () => 2) {
  const scores = new Map();
  const voters = new Map();
  const abstained = [];
  for (const [seat, target] of Object.entries(ballots)) {
    const voter = Number(seat);
    if (target === null) {
      abstained.push(voter);
      continue;
    }
    scores.set(target, (scores.get(target) ?? 0) + weight(voter, target));
    if (!voters.has(target)) voters.set(target, []);
    voters.get(target).push(voter);
  }
  const counts = [...scores].sort(([a], [b]) => a - b).map(([seat, halves]) => ({ seat, count: halves / 2 }));
  const highest = Math.max(0, ...counts.map(entry => entry.count));
  return {
    counts,
    leaders: counts.filter(entry => entry.count === highest).map(entry => entry.seat),
    ballot: { groups: counts.map(entry => ({ ...entry, voters: voters.get(entry.seat) })), abstained },
  };
}

export function exileWeight(sheriff, nominations, isRunoff) {
  return (seat, target) => seat === sheriff && !isRunoff
    && (nominations.length === 0 || (nominations.length === 1 && nominations[0] === target)) ? 3 : 2;
}

export function runoffOrder(speakers, candidates) {
  return speakers.slice().reverse().filter(seat => candidates.includes(seat));
}

export function electionVoters(eligible, election, runoff = false) {
  const excluded = runoff ? [...election.candidates, ...election.pkWithdrawn] : election.entered;
  return eligible.filter(seat => !excluded.includes(seat));
}
