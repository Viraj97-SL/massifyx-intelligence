'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { VesselStore } = require('../lib/ais/vesselStore');

function sampleVessel(overrides = {}) {
  return {
    mmsi: '123456789',
    shipName: 'EVER GIVEN',
    lat: 30.01,
    lon: 32.58,
    headingDeg: 87,
    speedKnots: 12.3,
    ...overrides,
  };
}

test('upsert inserts a vessel and listAll returns it', () => {
  const store = new VesselStore();
  store.upsert(sampleVessel());
  assert.equal(store.size(), 1);
  assert.equal(store.listAll()[0].mmsi, '123456789');
});

test('upsert overwrites the previous position for the same MMSI', () => {
  const store = new VesselStore();
  store.upsert(sampleVessel({ lat: 30.01 }));
  store.upsert(sampleVessel({ lat: 31.5 }));
  assert.equal(store.size(), 1);
  assert.equal(store.listAll()[0].lat, 31.5);
});

test('pruneStale removes vessels not updated within staleAfterMs', () => {
  const store = new VesselStore({ staleAfterMs: 1000 });
  store.upsert(sampleVessel({ mmsi: 'old' }), new Date(Date.now() - 5000));
  store.upsert(sampleVessel({ mmsi: 'fresh' }), new Date());

  const { pruned } = store.pruneStale();
  assert.equal(pruned, 1);
  assert.equal(store.size(), 1);
  assert.equal(store.listAll()[0].mmsi, 'fresh');
});

test('pruneStale keeps everything when nothing is stale yet', () => {
  const store = new VesselStore({ staleAfterMs: 60_000 });
  store.upsert(sampleVessel());
  const { pruned } = store.pruneStale();
  assert.equal(pruned, 0);
  assert.equal(store.size(), 1);
});
