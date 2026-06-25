'use strict';

// Security regression tests for the 14 findings fixed in the second audit.
// Mirrors logic from vb-sessions/app.js — run with: node tests/security.test.js

const assert = require('assert');

// ── Finding 5: CSV formula injection ────────────────────────────────────────
// Mirrors the csvCell function in _downloadCsv.
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? '\'' + s : s).replace(/"/g, '""')}"`;
}

// Trigger characters
['=SUM(A1:A10)', '+cmd|/C calc', '-cmd', '@SUM()', '\tTAB', '\rCR'].forEach(trigger => {
  const cell = csvCell(trigger);
  assert(cell.startsWith("\"'"), `formula trigger prefixed with quote: ${JSON.stringify(trigger)} → ${cell}`);
  console.log(`PASS formula injection blocked: ${JSON.stringify(trigger)}`);
});

// Safe values pass through unchanged
{
  const cell = csvCell('Normal text');
  assert.strictEqual(cell, '"Normal text"', 'safe value unchanged');
  console.log('PASS safe text unchanged');
}

{
  const cell = csvCell('Revenue: £50.00');
  assert.strictEqual(cell, '"Revenue: £50.00"', 'currency string unchanged');
  console.log('PASS currency string unchanged');
}

// Double-quote escaping still works when formula prefix applied
{
  const cell = csvCell('=say "hi"');
  assert(cell.includes("\"'=say \"\"hi\"\"\""), `quotes escaped in formula cell: ${cell}`);
  console.log('PASS double-quote escaping preserved in formula cell');
}

// Null/undefined → empty cell, no prefix
{
  const cell1 = csvCell(null);
  const cell2 = csvCell(undefined);
  assert.strictEqual(cell1, '""', 'null → empty cell');
  assert.strictEqual(cell2, '""', 'undefined → empty cell');
  console.log('PASS null/undefined → empty cell (no spurious prefix)');
}


// ── Finding 13: ICS injection ────────────────────────────────────────────────
// Mirrors _icsEsc in app.js.
function _icsEsc(s) {
  return String(s || '').replace(/\r\n?|\n(?!\\)/g, ' ').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

// CR/LF injection — attacker tries to inject a new ICS property.
// The CRLF is the attack vector; stripping it to a space makes the text inert.
{
  const malicious = 'Venue\r\nDTSTART:19700101T000000Z';
  const out = _icsEsc(malicious);
  assert(!out.includes('\r\n'), 'CRLF stripped from ICS value');
  assert(!out.includes('\r'), 'CR stripped from ICS value');
  assert(!out.includes('\n'), 'LF stripped from ICS value');
  // "DTSTART:" text may remain but as a space-joined token, not a new ICS property
  assert(out.includes('Venue'), 'original text prefix preserved');
  console.log('PASS ICS CRLF injection neutralised (property separator removed)');
}

{
  const malicious = 'Venue\rDTSTART:19700101T000000Z';
  const out = _icsEsc(malicious);
  assert(!out.includes('\r'), 'bare CR stripped from ICS value');
  console.log('PASS ICS bare CR injection neutralised');
}

// Backslash escaping
{
  const out = _icsEsc('path\\to\\file');
  assert(out.includes('\\\\'), 'backslashes doubled in ICS value');
  console.log('PASS ICS backslash escaped');
}

// Semicolon escaping
{
  const out = _icsEsc('Room 1; Level 2');
  assert(out.includes('\\;'), 'semicolon escaped in ICS value');
  // Every ';' in output should be preceded by '\' (no bare semicolons)
  assert(!/(?<!\\);/.test(out), 'no bare semicolons remain');
  console.log('PASS ICS semicolon escaped');
}

// Comma escaping
{
  const out = _icsEsc('London, UK');
  assert(out.includes('\\,'), 'comma escaped in ICS value');
  console.log('PASS ICS comma escaped');
}

// Plain text passes through
{
  const out = _icsEsc('Brixton Recreation Centre');
  assert.strictEqual(out, 'Brixton Recreation Centre', 'plain venue name unchanged');
  console.log('PASS ICS plain text unchanged');
}

// Empty/null input
{
  assert.strictEqual(_icsEsc(''), '', 'empty string → empty string');
  assert.strictEqual(_icsEsc(null), '', 'null → empty string');
  console.log('PASS ICS null/empty input safe');
}


// ── Finding 14: callFn null guard ────────────────────────────────────────────
// Mirrors the null guard at the top of callFn in app.js.
async function callFnGuard(_currentUser) {
  if (!_currentUser) throw new Error('Not signed in.');
  return _currentUser.getIdToken();
}

{
  let threw = false;
  callFnGuard(null).catch(e => {
    assert(e.message === 'Not signed in.', `Expected 'Not signed in.' but got: ${e.message}`);
    threw = true;
  }).then(() => {
    // Give the microtask queue time to run
    process.nextTick(() => {
      assert(threw, 'callFn null guard should have thrown');
      console.log('PASS callFn null guard throws when _currentUser is null');
    });
  });
}

{
  const fakeUser = { getIdToken: async () => 'fake-token' };
  callFnGuard(fakeUser).then(token => {
    assert.strictEqual(token, 'fake-token', 'callFn proceeds when user is set');
    console.log('PASS callFn proceeds normally when _currentUser is set');
  });
}


// ── Finding 1: onclick data-attribute pattern ────────────────────────────────
// Verifies that venues containing single quotes don't break when read via dataset.
// The HTML parser decodes &#39; back to ' before JS runs — the data-* approach avoids this.
{
  // Simulate what the browser does: esc() sets data-venue="It&#39;s here"
  // The browser decodes &#39; → ' when you read dataset.venue. That is SAFE — it's
  // already out of JS string context and is just a plain string value.
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const dangerousVenue = "It's here & \"watch out\"";
  const attr = esc(dangerousVenue);

  // The attr is safe to place in a double-quoted HTML attribute.
  assert(!attr.includes('"'), 'no unescaped double-quotes in attribute value');
  // When used in onclick="deleteSession(this.dataset.id,this.dataset.venue,this)"
  // the venue is never interpolated into the JS string — it's read at call-time.
  // We verify esc() does produce &#39; for single quotes (confirming it's safe in attributes).
  assert(attr.includes('&#39;'), "single quote encoded to &#39; in attribute");
  console.log('PASS data-attribute pattern: venue safely encoded for HTML attribute');
}

console.log('\nAll security tests passed.');
