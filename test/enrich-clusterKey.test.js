'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clusterKey, bucketCoordinate, bucketDate, normalizeActorToken } = require('../lib/enrich/clusterKey');

test('bucketCoordinate rounds to the geo grid', () => {
  assert.equal(bucketCoordinate(51.9225), 52);
  // 0.2-degree grid isn't exactly representable in binary floating point --
  // compare with a tolerance rather than an exact literal.
  assert.ok(Math.abs(bucketCoordinate(51.7) - 51.8) < 1e-9);
});

test('normalizeActorToken takes the first significant word, case-insensitively', () => {
  assert.equal(normalizeActorToken('GERMAN NAVY'), 'german');
  assert.equal(normalizeActorToken('  Danube River Authority '), 'danube');
  assert.equal(normalizeActorToken(undefined), '');
  assert.equal(normalizeActorToken(null), '');
});

test('bucketDate groups dates within the same window to the same bucket', () => {
  assert.equal(bucketDate('20260728'), bucketDate('20260729'));
});

test('bucketDate separates dates far enough apart', () => {
  assert.notEqual(bucketDate('20260728'), bucketDate('20260810'));
});

test('clusterKey is deterministic for identical input', () => {
  const input = { category: 'labor', lat: 51.9225, lon: 4.47917, eventDate: '20260728' };
  assert.equal(clusterKey(input), clusterKey({ ...input }));
});

test('clusterKey collapses near-duplicate reports of the same incident', () => {
  const a = clusterKey({ category: 'labor', lat: 51.92, lon: 4.48, eventDate: '20260728' });
  const b = clusterKey({ category: 'labor', lat: 51.93, lon: 4.47, eventDate: '20260729' });
  assert.equal(a, b);
});

test('clusterKey distinguishes different categories at the same place/time', () => {
  const a = clusterKey({ category: 'labor', lat: 51.92, lon: 4.48, eventDate: '20260728' });
  const b = clusterKey({ category: 'weather', lat: 51.92, lon: 4.48, eventDate: '20260728' });
  assert.notEqual(a, b);
});

test('clusterKey distinguishes distant locations', () => {
  const a = clusterKey({ category: 'labor', lat: 51.92, lon: 4.48, eventDate: '20260728' });
  const b = clusterKey({ category: 'labor', lat: 29.9668, lon: 32.5498, eventDate: '20260728' });
  assert.notEqual(a, b);
});

// Regression test for a real production bug: two unrelated stories
// (a German warship item and a Danube river item) geocoded to the same
// region, category, and week collided onto one id -- and because the store
// keeps the first insert's source_url while overwriting title/summary on
// conflict (see postgresEventStore.js), the displayed card ended up with a
// headline about one story and a source link to the other. Keying on the
// lead actor makes this specific collision far less likely without an
// embedding call.
test('clusterKey distinguishes different lead actors at the same place/time/category', () => {
  const a = clusterKey({
    category: 'geopolitical', lat: 51.0, lon: 9.0, eventDate: '20260728', actor1: 'GERMAN NAVY',
  });
  const b = clusterKey({
    category: 'geopolitical', lat: 51.0, lon: 9.0, eventDate: '20260728', actor1: 'DANUBE RIVER AUTHORITY',
  });
  assert.notEqual(a, b);
});

test('clusterKey still collapses the same incident when actor1 is identical or both omit it', () => {
  const a = clusterKey({
    category: 'labor', lat: 51.92, lon: 4.48, eventDate: '20260728', actor1: 'ROTTERDAM PORT AUTHORITY',
  });
  const b = clusterKey({
    category: 'labor', lat: 51.93, lon: 4.47, eventDate: '20260729', actor1: 'Rotterdam Port Authority',
  });
  assert.equal(a, b);
});
