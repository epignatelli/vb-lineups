// Pure functions — no DOM, no global state.
// Loaded as a plain <script> in the browser and required() in tests.

function calcNumTopTeams(n) {
  if (n >= 40) return 5;
  if (n >= 32) return 4;
  return 3;
}

function calcMoversUp(nTop, rnd) {
  if (nTop === 3) return rnd <= 2 ? 8 : 4;
  if (nTop === 4) return 8;
  if (nTop === 5) return rnd <= 2 ? 12 : 8;
  return 8;
}

// Returns next-round state without mutating inputs.
// topTeams:  [{ id, playerIds[], roundScore }]
// workUp:    [{ playerId, roundScore }]
function computeTransition(topTeams, workUp, numTopTeams, round) {
  const moversUpCount   = Math.min(calcMoversUp(numTopTeams, round), workUp.length);
  const numTeamsDown    = Math.min(Math.floor(moversUpCount / 4), numTopTeams - 1);

  const workSorted      = [...workUp].sort((a, b) => b.roundScore - a.roundScore);
  const moversUp        = workSorted.slice(0, moversUpCount);
  const stayWorkUp      = workSorted.slice(moversUpCount);

  const teamsSorted     = [...topTeams].sort((a, b) => b.roundScore - a.roundScore);
  const stayTeams       = teamsSorted.slice(0, numTopTeams - numTeamsDown);
  const movingDownTeams = teamsSorted.slice(numTopTeams - numTeamsDown);

  const newTeams = [];
  for (let i = 0; i < numTeamsDown; i++) {
    newTeams.push({
      id: i,  // caller should assign real IDs
      playerIds: moversUp.slice(i * 4, i * 4 + 4).map(wu => wu.playerId),
      roundScore: 0
    });
  }

  return {
    moversUp,
    movingDownTeams,
    stayTeams,
    newTeams,
    stayWorkUp,
    nextTopTeams: [
      ...stayTeams.map(t => ({ ...t, roundScore: 0 })),
      ...newTeams,
    ],
    nextWorkUp: [
      ...movingDownTeams.flatMap(t => t.playerIds.map(pid => ({ playerId: pid, roundScore: 0 }))),
      ...stayWorkUp.map(wu => ({ ...wu, roundScore: 0 })),
    ]
  };
}

// Returns a new players array with cumScore updated for this round.
// King court: every player on a team gets the team's roundScore.
// Work-up:    each player gets their own roundScore.
function computeScores(players, topTeams, workUp) {
  return players.map(p => {
    const team = topTeams.find(t => t.playerIds.includes(p.id));
    if (team) return { ...p, cumScore: p.cumScore + team.roundScore };
    const wu = workUp.find(w => w.playerId === p.id);
    if (wu)   return { ...p, cumScore: p.cumScore + wu.roundScore };
    return p;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { calcNumTopTeams, calcMoversUp, computeTransition, computeScores };
}
