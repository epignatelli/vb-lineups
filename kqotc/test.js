// Run with: node kqotc/test.js
'use strict';
const assert = require('node:assert/strict');
const { calcNumTopTeams, calcMoversUp, computeTransition, computeScores } = require('./logic.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function makePlayers(n, startId = 1) {
  return Array.from({ length: n }, (_, i) => ({ id: startId + i, name: `P${startId + i}`, cumScore: 0 }));
}

function makeTeams(players) {
  // 4 consecutive players per team
  const teams = [];
  for (let i = 0; i < players.length; i += 4) {
    teams.push({ id: i / 4 + 1, playerIds: players.slice(i, i + 4).map(p => p.id), roundScore: 0 });
  }
  return teams;
}

function makeWorkUp(players) {
  return players.map(p => ({ playerId: p.id, roundScore: 0 }));
}

// ─── 1. Team count ─────────────────────────────────────────────────────────────
console.log('\n1. Number of king court teams');

test('fewer than 24 players → 3 teams', () => assert.equal(calcNumTopTeams(8),  3));
test('24 players → 3 teams',            () => assert.equal(calcNumTopTeams(24), 3));
test('31 players → 3 teams',            () => assert.equal(calcNumTopTeams(31), 3));
test('32 players → 4 teams',            () => assert.equal(calcNumTopTeams(32), 4));
test('39 players → 4 teams',            () => assert.equal(calcNumTopTeams(39), 4));
test('40 players → 5 teams',            () => assert.equal(calcNumTopTeams(40), 5));
test('50 players → 5 teams',            () => assert.equal(calcNumTopTeams(50), 5));

// ─── 2. Movers up count ────────────────────────────────────────────────────────
console.log('\n2. Number of players promoted per round');

test('3 teams, round 1 → 8 move up',  () => assert.equal(calcMoversUp(3, 1), 8));
test('3 teams, round 2 → 8 move up',  () => assert.equal(calcMoversUp(3, 2), 8));
test('3 teams, round 3 → 4 move up',  () => assert.equal(calcMoversUp(3, 3), 4));
test('3 teams, round 5 → 4 move up',  () => assert.equal(calcMoversUp(3, 5), 4));
test('4 teams, round 1 → 8 move up',  () => assert.equal(calcMoversUp(4, 1), 8));
test('4 teams, round 4 → 8 move up',  () => assert.equal(calcMoversUp(4, 4), 8));
test('5 teams, round 1 → 12 move up', () => assert.equal(calcMoversUp(5, 1), 12));
test('5 teams, round 2 → 12 move up', () => assert.equal(calcMoversUp(5, 2), 12));
test('5 teams, round 3 → 8 move up',  () => assert.equal(calcMoversUp(5, 3), 8));

// ─── 3. Promotion / demotion in a round transition ─────────────────────────────
console.log('\n3. Promotion and demotion (computeTransition)');

test('24 players, round 1: 8 promoted, 2 teams demoted', () => {
  const all = makePlayers(24);
  const top = makeTeams(all.slice(0, 12));   // 3 teams
  const wu  = makeWorkUp(all.slice(12));      // 12 individual

  // Give work-up players scores 12, 11, ..., 1 so top 8 are clear
  wu.forEach((w, i) => { w.roundScore = 12 - i; });
  top.forEach((t, i) => { t.roundScore = 10 - i * 3; }); // 10, 7, 4

  const r = computeTransition(top, wu, 3, 1);

  assert.equal(r.moversUp.length, 8, 'exactly 8 promoted');
  assert.equal(r.movingDownTeams.length, 2, 'exactly 2 teams demoted (8 players)');
  assert.equal(r.stayTeams.length, 1, '1 team stays');
  assert.equal(r.nextTopTeams.length, 3, 'still 3 teams on king court');
  assert.equal(r.nextWorkUp.length, 12, 'still 12 on work-up');
});

test('32 players, round 1: 8 promoted, 2 teams demoted', () => {
  const all = makePlayers(32);
  const top = makeTeams(all.slice(0, 16));   // 4 teams
  const wu  = makeWorkUp(all.slice(16));      // 16 individual
  wu.forEach((w, i) => { w.roundScore = 16 - i; });
  top.forEach((t, i) => { t.roundScore = 20 - i * 5; });

  const r = computeTransition(top, wu, 4, 1);

  assert.equal(r.moversUp.length, 8, 'exactly 8 promoted');
  assert.equal(r.movingDownTeams.length, 2, 'exactly 2 teams demoted');
  assert.equal(r.nextTopTeams.length, 4, 'still 4 teams');
  assert.equal(r.nextWorkUp.length, 16, 'still 16 on work-up');
});

test('40 players, round 1: 12 promoted, 3 teams demoted', () => {
  const all = makePlayers(40);
  const top = makeTeams(all.slice(0, 20));   // 5 teams
  const wu  = makeWorkUp(all.slice(20));      // 20 individual
  wu.forEach((w, i) => { w.roundScore = 20 - i; });
  top.forEach((t, i) => { t.roundScore = 50 - i * 10; });

  const r = computeTransition(top, wu, 5, 1);

  assert.equal(r.moversUp.length, 12, 'exactly 12 promoted');
  assert.equal(r.movingDownTeams.length, 3, 'exactly 3 teams demoted');
  assert.equal(r.nextTopTeams.length, 5, 'still 5 teams');
  assert.equal(r.nextWorkUp.length, 20, 'still 20 on work-up');
});

test('promoted players grouped into new teams by score (desc)', () => {
  const all = makePlayers(24);
  const top = makeTeams(all.slice(0, 12));
  const wu  = makeWorkUp(all.slice(12));
  // Give work-up clear descending scores so top 8 are unambiguous
  wu.forEach((w, i) => { w.roundScore = 12 - i; });

  const r = computeTransition(top, wu, 3, 1);

  // Top 4 scorers → first new team, next 4 → second new team
  const topScorers = [...wu].sort((a, b) => b.roundScore - a.roundScore).slice(0, 8);
  assert.deepEqual(r.newTeams[0].playerIds, topScorers.slice(0, 4).map(w => w.playerId));
  assert.deepEqual(r.newTeams[1].playerIds, topScorers.slice(4, 8).map(w => w.playerId));
});

test('worst king court teams are demoted', () => {
  const all = makePlayers(24);
  const top = makeTeams(all.slice(0, 12));  // teams 1,2,3
  const wu  = makeWorkUp(all.slice(12));
  wu.forEach((w, i) => { w.roundScore = i + 1; });
  top[0].roundScore = 20; // best
  top[1].roundScore = 5;  // demoted
  top[2].roundScore = 1;  // demoted

  const r = computeTransition(top, wu, 3, 1);

  assert.equal(r.stayTeams[0].id, top[0].id, 'best team stays');
  const demotedIds = r.movingDownTeams.map(t => t.id);
  assert.ok(demotedIds.includes(top[1].id), 'second-worst demoted');
  assert.ok(demotedIds.includes(top[2].id), 'worst demoted');
});

test('capped promotion when work-up has fewer players than calcMoversUp', () => {
  const all = makePlayers(14);
  const top = makeTeams(all.slice(0, 12));  // 3 teams
  const wu  = makeWorkUp(all.slice(12));    // only 2 players
  wu.forEach((w, i) => { w.roundScore = i + 1; });

  const r = computeTransition(top, wu, 3, 1);

  // Can't promote 8 if only 2 on work-up
  assert.equal(r.moversUp.length, 2);
  // 2 / 4 = 0 new teams → 0 demoted
  assert.equal(r.movingDownTeams.length, 0);
});

// ─── 4. Score accumulation ─────────────────────────────────────────────────────
console.log('\n4. Score accumulation (computeScores)');

test('king court: all team members get the team score', () => {
  const players = makePlayers(4);
  const team    = { id: 1, playerIds: [1, 2, 3, 4], roundScore: 10 };
  const result  = computeScores(players, [team], []);
  result.forEach(p => assert.equal(p.cumScore, 10, `${p.name} should have 10`));
});

test('work-up: each player gets their own score', () => {
  const players = makePlayers(3);
  const wu = [
    { playerId: 1, roundScore: 5 },
    { playerId: 2, roundScore: 8 },
    { playerId: 3, roundScore: 2 },
  ];
  const result = computeScores(players, [], wu);
  assert.equal(result[0].cumScore, 5);
  assert.equal(result[1].cumScore, 8);
  assert.equal(result[2].cumScore, 2);
});

test('cumScore accumulates across multiple rounds', () => {
  let players = makePlayers(4);
  const team = { id: 1, playerIds: [1, 2, 3, 4], roundScore: 7 };

  players = computeScores(players, [team], []);     // round 1: +7
  team.roundScore = 3;
  players = computeScores(players, [team], []);     // round 2: +3
  players.forEach(p => assert.equal(p.cumScore, 10, `${p.name} should have 10 total`));
});

test('player switching from team to work-up accumulates both', () => {
  let players = makePlayers(2);

  // Round 1: player 1 on a team scoring 6
  const team = { id: 1, playerIds: [1], roundScore: 6 };
  players = computeScores(players, [team], [{ playerId: 2, roundScore: 3 }]);

  // Round 2: player 1 now on work-up scoring 4
  players = computeScores(players, [], [
    { playerId: 1, roundScore: 4 },
    { playerId: 2, roundScore: 5 },
  ]);

  assert.equal(players.find(p => p.id === 1).cumScore, 10, 'P1: 6 + 4');
  assert.equal(players.find(p => p.id === 2).cumScore,  8, 'P2: 3 + 5');
});

test('teams with different scores give correct individual totals', () => {
  const players = makePlayers(8);
  const teams = [
    { id: 1, playerIds: [1, 2, 3, 4], roundScore: 15 },
    { id: 2, playerIds: [5, 6, 7, 8], roundScore: 9  },
  ];
  const result = computeScores(players, teams, []);
  [1,2,3,4].forEach(id => assert.equal(result.find(p => p.id === id).cumScore, 15));
  [5,6,7,8].forEach(id => assert.equal(result.find(p => p.id === id).cumScore, 9));
});

// ─── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
