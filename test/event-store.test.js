'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MemoryEventStore } = require('../lib/store/memoryEventStore');

function sampleEvent(overrides = {}) {
  return {
    id: 'evt_0000000000000001',
    category: 'labor',
    severity: 4,
    location: 'Rotterdam, Zuid-Holland, Netherlands',
    lat: 51.9225,
    lon: 4.47917,
    sourceCount: 12,
    rawRefs: ['1001127001'],
    ...overrides,
  };
}

test('upsertEvents inserts a new event', async () => {
  const store = new MemoryEventStore();
  const { upserted } = await store.upsertEvents([sampleEvent()]);

  assert.equal(upserted, 1);
  const all = await store.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'evt_0000000000000001');
});

test('upsertEvents updates an existing event without duplicating it', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ sourceCount: 12 })]);
  await store.upsertEvents([sampleEvent({ sourceCount: 20 })]);

  const all = await store.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].sourceCount, 20);
});

test('upsertEvents unions rawRefs across upserts instead of overwriting them', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ rawRefs: ['1001127001'] })]);
  await store.upsertEvents([sampleEvent({ rawRefs: ['1001127001', '1001127009'] })]);

  const [event] = await store.listAll();
  assert.deepEqual(event.rawRefs.sort(), ['1001127001', '1001127009']);
});

test('upsertEvents preserves firstSeenAt across updates but bumps lastUpdatedAt on a real content change', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent()]);
  const [firstPass] = await store.listAll();

  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.upsertEvents([sampleEvent({ severity: 5 })]);
  const [secondPass] = await store.listAll();

  assert.equal(secondPass.firstSeenAt.getTime(), firstPass.firstSeenAt.getTime());
  assert.ok(secondPass.lastUpdatedAt.getTime() > firstPass.lastUpdatedAt.getTime());
});

test('upsertEvents does NOT bump lastUpdatedAt when only sourceCount drifts', async () => {
  // A still-covered story naturally accumulates more mentions/sources over
  // time regardless of whether it's a brand-new incident or a months-old
  // one -- that alone must not make an old event look "recently updated".
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ sourceCount: 12 })]);
  const [firstPass] = await store.listAll();

  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.upsertEvents([sampleEvent({ sourceCount: 99 })]);
  const [secondPass] = await store.listAll();

  assert.equal(secondPass.sourceCount, 99);
  assert.equal(secondPass.lastUpdatedAt.getTime(), firstPass.lastUpdatedAt.getTime());
});

test('pruneOlderThan removes only events last updated before the cutoff', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ id: 'old-event' })]);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const cutoff = new Date();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.upsertEvents([sampleEvent({ id: 'new-event' })]);

  const { pruned } = await store.pruneOlderThan(cutoff);
  assert.equal(pruned, 1);

  const remaining = await store.listAll();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'new-event');
});

test('pruneOlderThan keeps events newer than the cutoff', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ id: 'keep-me' })]);

  const pastCutoff = new Date(Date.now() - 60_000);
  const { pruned } = await store.pruneOlderThan(pastCutoff);

  assert.equal(pruned, 0);
  const remaining = await store.listAll();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'keep-me');
});

test('listAll returns events sorted by most recently updated first', async () => {
  const store = new MemoryEventStore();
  await store.upsertEvents([sampleEvent({ id: 'first' })]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.upsertEvents([sampleEvent({ id: 'second' })]);

  const all = await store.listAll();
  assert.deepEqual(all.map((e) => e.id), ['second', 'first']);
});

// Resilience case: two overlapping upsertEvents() calls (e.g. from two
// overlapping poll cycles -- see lib/scheduler.js's overlap-guard fix)
// racing on the very same clusterKey id. upsertEvents() itself has no
// `await` inside its per-event loop, so within a single JS process neither
// call can actually interleave mid-iteration -- but this test pins that
// invariant down explicitly (Promise.all, not a sequential await) rather
// than leaving it as an implicit assumption a future refactor could break
// silently.
test('two concurrent upsertEvents calls racing on the same id both apply cleanly (no lost update)', async () => {
  const store = new MemoryEventStore();

  await Promise.all([
    store.upsertEvents([sampleEvent({ id: 'evt_race', rawRefs: ['a'] })]),
    store.upsertEvents([sampleEvent({ id: 'evt_race', rawRefs: ['b'] })]),
  ]);

  const all = await store.listAll();
  assert.equal(all.length, 1, 'a race on the same id must still collapse to one event, not two');
  assert.deepEqual(all[0].rawRefs.sort(), ['a', 'b'], 'both refs must survive -- neither call\'s write may be lost');
});

// Resilience case: pruneOlderThan's behavior/complexity at scale, without
// needing a real large fixture file -- reaches into the store's own Map
// directly to backdate half the entries, since there's no public API for
// setting lastUpdatedAt to an arbitrary past value.
test('pruneOlderThan correctly partitions a large number of events by cutoff', async () => {
  const store = new MemoryEventStore();
  const now = Date.now();
  const total = 2000;

  for (let i = 0; i < total; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await store.upsertEvents([sampleEvent({ id: `evt_${i}` })]);
  }

  let i = 0;
  for (const [id, event] of store.events) {
    if (i % 2 === 0) {
      store.events.set(id, { ...event, lastUpdatedAt: new Date(now - 30 * 24 * 60 * 60 * 1000) });
    }
    i += 1;
  }

  const { pruned } = await store.pruneOlderThan(new Date(now - 14 * 24 * 60 * 60 * 1000));

  assert.equal(pruned, total / 2);
  assert.equal(await store.countAll(), total / 2);
});
