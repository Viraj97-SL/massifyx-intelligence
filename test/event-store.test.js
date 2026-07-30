'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MemoryEventStore } = require('../lib/store/memoryEventStore');

function sampleEvent(overrides = {}) {
  return {
    gdeltId: '1001127001',
    location: 'Rotterdam, Zuid-Holland, Netherlands',
    lat: 51.9225,
    lon: 4.47917,
    numMentions: 38,
    ...overrides,
  };
}

test('upsertEvents inserts a new event', async () => {
  const store = new MemoryEventStore();
  const { upserted } = await store.upsertEvents([sampleEvent()]);

  assert.equal(upserted, 1);
  const all = await store.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].gdeltId, '1001127001');
});

test('upsertEvents updates an existing event without duplicating it', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ numMentions: 38 })]);
  await store.upsertEvents([sampleEvent({ numMentions: 52 })]);

  const all = await store.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].numMentions, 52);
});

test('upsertEvents preserves firstSeenAt across updates but bumps lastUpdatedAt', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent()]);
  const [firstPass] = await store.listAll();

  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.upsertEvents([sampleEvent({ numMentions: 99 })]);
  const [secondPass] = await store.listAll();

  assert.equal(secondPass.firstSeenAt.getTime(), firstPass.firstSeenAt.getTime());
  assert.ok(secondPass.lastUpdatedAt.getTime() > firstPass.lastUpdatedAt.getTime());
});

test('pruneOlderThan removes only events last updated before the cutoff', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ gdeltId: 'old-event' })]);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const cutoff = new Date();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.upsertEvents([sampleEvent({ gdeltId: 'new-event' })]);

  const { pruned } = await store.pruneOlderThan(cutoff);
  assert.equal(pruned, 1);

  const remaining = await store.listAll();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].gdeltId, 'new-event');
});

test('pruneOlderThan keeps events newer than the cutoff', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ gdeltId: 'keep-me' })]);

  const pastCutoff = new Date(Date.now() - 60_000);
  const { pruned } = await store.pruneOlderThan(pastCutoff);

  assert.equal(pruned, 0);
  const remaining = await store.listAll();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].gdeltId, 'keep-me');
});

test('listAll returns events sorted by most recently updated first', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ gdeltId: 'first' })]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.upsertEvents([sampleEvent({ gdeltId: 'second' })]);

  const all = await store.listAll();
  assert.deepEqual(all.map((e) => e.gdeltId), ['second', 'first']);
});
