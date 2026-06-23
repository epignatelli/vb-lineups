'use strict';

// Tests the computeSessionFinancials pure function.
// Mirrors the logic in vb-sessions/app.js — kept in sync manually.

const assert = require('assert');

function _playerPrice(adminPrice) {
  if (!adminPrice || adminPrice <= 0) return 0;
  const gross = (adminPrice + 0.20) / (1 - 0.015);
  return Math.ceil(gross / 0.50) * 0.50;
}

function computeSessionFinancials(session) {
  const attendeeCount = session.attendeeCount || 0;
  const playerPrice   = session.absorbFee ? (session.cost || 0) : _playerPrice(session.cost || 0);
  const revenue       = playerPrice * attendeeCount;
  const coachFee      = session.coachFee || 0;
  const net           = revenue - coachFee;
  return { revenue, coachFee, net, attendeeCount, playerPrice };
}

// Free session
{
  const s = { attendeeCount: 8, cost: 0, coachFee: 0 };
  const f = computeSessionFinancials(s);
  assert.strictEqual(f.revenue, 0, 'free session: revenue should be 0');
  assert.strictEqual(f.net, 0,     'free session: net should be 0');
  console.log('PASS free session');
}

// Paid session with fee absorbed
{
  const s = { attendeeCount: 10, cost: 10, absorbFee: true, coachFee: 50 };
  const f = computeSessionFinancials(s);
  assert.strictEqual(f.playerPrice, 10,   'absorbFee: playerPrice equals admin cost');
  assert.strictEqual(f.revenue, 100,       'absorbFee: revenue = 10 * 10');
  assert.strictEqual(f.coachFee, 50,       'absorbFee: coachFee = 50');
  assert.strictEqual(f.net, 50,            'absorbFee: net = 100 - 50');
  console.log('PASS paid session with absorbFee');
}

// Paid session with booking fee passed on
{
  const s = { attendeeCount: 6, cost: 10, absorbFee: false, coachFee: 50 };
  const f = computeSessionFinancials(s);
  // _playerPrice(10) = ceil((10.20 / 0.985) / 0.50) * 0.50
  const expectedPlayerPrice = Math.ceil(((10 + 0.20) / (1 - 0.015)) / 0.50) * 0.50;
  assert.strictEqual(f.playerPrice, expectedPlayerPrice, 'player price calculated correctly');
  assert.strictEqual(f.revenue, expectedPlayerPrice * 6, 'revenue = playerPrice * 6');
  assert.strictEqual(f.net, f.revenue - 50,              'net = revenue - coachFee');
  console.log('PASS paid session with booking fee');
}

// Zero attendees
{
  const s = { attendeeCount: 0, cost: 8, coachFee: 30 };
  const f = computeSessionFinancials(s);
  assert.strictEqual(f.revenue, 0,   'zero attendees: revenue = 0');
  assert.strictEqual(f.net, -30,     'zero attendees: net = -coachFee');
  console.log('PASS zero attendees');
}

// Totals across sessions
{
  const sessions = [
    { attendeeCount: 5, cost: 10, absorbFee: true, coachFee: 30 },
    { attendeeCount: 8, cost: 0,  coachFee: 0 },
    { attendeeCount: 3, cost: 12, absorbFee: true, coachFee: 40 },
  ];
  let totalRevenue = 0, totalCoach = 0, totalNet = 0;
  sessions.forEach(s => {
    const f = computeSessionFinancials(s);
    totalRevenue += f.revenue;
    totalCoach   += f.coachFee;
    totalNet     += f.net;
  });
  assert.strictEqual(totalRevenue, 5*10 + 0 + 3*12, 'totals: revenue correct');
  assert.strictEqual(totalCoach,   30 + 0 + 40,      'totals: coach fees correct');
  assert.strictEqual(totalNet, totalRevenue - totalCoach, 'totals: net correct');
  console.log('PASS totals across sessions');
}

console.log('\nAll finances tests passed.');
