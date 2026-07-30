'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeSeverity, clampSeverity } = require('../lib/enrich/severity');

test('clampSeverity keeps values within 1-5 and rounds', () => {
  assert.equal(clampSeverity(0), 1);
  assert.equal(clampSeverity(6), 5);
  assert.equal(clampSeverity(3.4), 3);
  assert.equal(clampSeverity(3.6), 4);
});

test('a named port closure cannot score below its category floor', () => {
  // logistics floor is 2 — even if the model proposes 1, the floor wins.
  assert.equal(computeSeverity('logistics', 1), 2);
});

test('an AI score above the floor is respected', () => {
  assert.equal(computeSeverity('logistics', 4), 4);
});

test('falls back to the category floor when the AI score is unparseable', () => {
  assert.equal(computeSeverity('geopolitical', null), 2);
  assert.equal(computeSeverity('geopolitical', NaN), 2);
});

test('unknown categories default to the lowest floor rather than throwing', () => {
  assert.equal(computeSeverity('not-a-real-category', null), 1);
});
