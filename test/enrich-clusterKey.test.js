'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clusterKey, bucketCoordinate, bucketDate } = require('../lib/enrich/clusterKey');

test('bucketCoordinate rounds to the geo grid', () => {
  assert.equal(bucketCoordinate(51.9225), 52);
  assert.equal(bucketCoordinate(51.7), 51.5);
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
