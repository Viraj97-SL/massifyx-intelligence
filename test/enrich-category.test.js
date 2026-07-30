'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCategory, CATEGORY_ENUM } = require('../lib/enrich/category');

test('accepts every enum member', () => {
  for (const category of CATEGORY_ENUM) {
    assert.equal(validateCategory(category), category);
  }
});

test('normalizes case and surrounding whitespace', () => {
  assert.equal(validateCategory('  Weather  '), 'weather');
  assert.equal(validateCategory('LABOR'), 'labor');
});

test('rejects a category outside the fixed enum', () => {
  assert.equal(validateCategory('sports'), null);
});

test('rejects non-string input instead of throwing', () => {
  assert.equal(validateCategory(undefined), null);
  assert.equal(validateCategory(42), null);
  assert.equal(validateCategory(null), null);
});
