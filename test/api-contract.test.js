'use strict';

// Contract test (DESIGN.md §8): asserts the response shape, severity range,
// and category enum against a recorded fixture. Keep test/fixtures/
// api-contract-sample.json and lib/api/contractRules.js's assertion logic
// in sync with a copy in the site repo so both sides fail loudly on drift
// instead of silently disagreeing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { createApp, PUBLIC_FIELDS } = require('../lib/api/createApp');
const { MemoryEventStore } = require('../lib/store/memoryEventStore');
const { assertValidDisruptionEvent } = require('../lib/api/contractRules');

const fixtureEvents = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'api-contract-sample.json'), 'utf8'),
);

test('the recorded fixture itself satisfies the API contract', () => {
  for (const event of fixtureEvents) {
    assert.doesNotThrow(() => assertValidDisruptionEvent(event));
  }
});

let server;
let base;

test.before(async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents(fixtureEvents);
  const app = createApp({
    store,
    getHealthInfo: () => ({ lastIngestAt: '2026-07-30T09:00:00.000Z' }),
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/v1/health matches the documented shape', async () => {
  const res = await fetch(`${base}/api/v1/health`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['eventCount', 'lastIngestAt', 'status']);
  assert.equal(body.status, 'ok');
  assert.equal(body.eventCount, fixtureEvents.length);
  assert.equal(body.lastIngestAt, '2026-07-30T09:00:00.000Z');
});

test('GET /api/v1/disruptions matches the documented shape and every event satisfies the contract', async () => {
  const res = await fetch(`${base}/api/v1/disruptions`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['count', 'events', 'generatedAt']);
  assert.equal(body.count, fixtureEvents.length);

  // Sourced from createApp.js's own PUBLIC_FIELDS rather than duplicated
  // here by hand -- a hand-copied list is exactly how the eventDate field
  // could silently go unverified (see contractRules.js's shape check for
  // the same reasoning applied to values, not just the key set).
  const expectedFields = [...PUBLIC_FIELDS].sort();

  for (const event of body.events) {
    assertValidDisruptionEvent(event);
    assert.deepEqual(Object.keys(event).sort(), expectedFields);
  }
});

test('internal fields (relevanceScore, rawRefs) never leak into the response', async () => {
  const res = await fetch(`${base}/api/v1/disruptions`);
  const body = await res.json();
  for (const event of body.events) {
    assert.equal(event.relevanceScore, undefined);
    assert.equal(event.rawRefs, undefined);
  }
});

test('severity query param filters to a minimum score', async () => {
  const res = await fetch(`${base}/api/v1/disruptions?severity=5`);
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.events[0].category, 'geopolitical');
});

test('category query param filters exactly', async () => {
  const res = await fetch(`${base}/api/v1/disruptions?category=labor`);
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.events[0].category, 'labor');
});

test('limit is clamped to the documented max of 500 and defaults to 100', async () => {
  const over = await fetch(`${base}/api/v1/disruptions?limit=999`);
  assert.equal(over.status, 200);

  const res = await fetch(`${base}/api/v1/disruptions?limit=1`);
  const body = await res.json();
  assert.equal(body.count, 1);
});

test('unknown route returns 404', async () => {
  const res = await fetch(`${base}/unknown`);
  assert.equal(res.status, 404);
});

test('rate limit headers are present on API responses', async () => {
  const res = await fetch(`${base}/api/v1/disruptions`);
  assert.ok(res.headers.get('ratelimit-limit'));
});

test('cache headers differ between health (no-store) and disruptions (60s public)', async () => {
  const disruptions = await fetch(`${base}/api/v1/disruptions`);
  assert.match(disruptions.headers.get('cache-control') || '', /public, max-age=60/);

  const health = await fetch(`${base}/api/v1/health`);
  assert.equal(health.headers.get('cache-control'), 'no-store');
});

// Resilience case: the existing rate-limit test above only checks that the
// header is present, never that a real burst is actually throttled. Boots
// its own isolated app/server (a fresh express-rate-limit instance) so this
// doesn't share a request bucket with any other test hitting the shared
// `base` server above.
test('a burst of requests past the configured limit gets 429s, not silently allowed through', async () => {
  const RATE_LIMIT_MAX_REQUESTS = 60; // mirrors createApp.js's own (non-exported) constant
  const burstStore = new MemoryEventStore();
  const burstApp = createApp({ store: burstStore, getHealthInfo: () => ({ lastIngestAt: null }) });
  const burstServer = http.createServer(burstApp);
  await new Promise((resolve) => burstServer.listen(0, resolve));
  const burstBase = `http://127.0.0.1:${burstServer.address().port}`;

  try {
    const statuses = [];
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS + 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${burstBase}/api/v1/health`);
      statuses.push(res.status);
    }

    assert.ok(
      statuses.slice(0, RATE_LIMIT_MAX_REQUESTS).every((status) => status === 200),
      'every request within the configured limit should succeed',
    );
    assert.ok(
      statuses.slice(RATE_LIMIT_MAX_REQUESTS).every((status) => status === 429),
      'requests past the configured limit should be throttled, not allowed through or dropped silently',
    );
  } finally {
    await new Promise((resolve) => burstServer.close(resolve));
  }
});
