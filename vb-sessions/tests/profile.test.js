'use strict';

// Tests input validation logic for the profile editor.
// The validation mirrors saveProfile() in vb-sessions/app.js.

const assert = require('assert');

function validateProfile({ name, gender, positions }) {
  const errors = [];
  if (!name || !name.trim()) errors.push('Name cannot be empty.');
  if (!Array.isArray(positions)) errors.push('Positions must be an array.');
  return errors;
}

// Valid profile
{
  const errs = validateProfile({ name: 'Alice', gender: 'woman', positions: ['setter'] });
  assert.deepStrictEqual(errs, [], 'valid profile: no errors');
  console.log('PASS valid profile');
}

// Empty name
{
  const errs = validateProfile({ name: '', gender: 'man', positions: ['hitter'] });
  assert(errs.some(e => e.toLowerCase().includes('name')), 'empty name: should error on name');
  console.log('PASS empty name rejected');
}

// Whitespace-only name
{
  const errs = validateProfile({ name: '   ', gender: 'man', positions: [] });
  assert(errs.some(e => e.toLowerCase().includes('name')), 'whitespace name: should error on name');
  console.log('PASS whitespace-only name rejected');
}

// Positions not an array
{
  const errs = validateProfile({ name: 'Bob', gender: 'man', positions: 'setter' });
  assert(errs.some(e => e.toLowerCase().includes('positions')), 'positions not array: should error');
  console.log('PASS positions must be array');
}

// Empty positions is allowed (no positions selected)
{
  const errs = validateProfile({ name: 'Carol', gender: '', positions: [] });
  assert.deepStrictEqual(errs, [], 'empty positions array is allowed');
  console.log('PASS empty positions allowed');
}

// Gender is optional
{
  const errs = validateProfile({ name: 'Dave', gender: '', positions: ['libero'] });
  assert.deepStrictEqual(errs, [], 'gender is optional');
  console.log('PASS gender is optional');
}

console.log('\nAll profile tests passed.');
