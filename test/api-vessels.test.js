'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../lib/api/createApp');
const { MemoryEventStore } = require('../lib/store/memoryEventStore');
const { VesselStore } = require('../lib/ais/vesselStore');

async function bootApp(vesselStore) {
  const store = new MemoryEventStore();
  const app = createApp({ store, getHealthInfo: () => ({ lastIngestAt: null }), vesselStore });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('GET /api/v1/vessels returns available:false and an empty list when no AIS key is configured', async () => {
  const { server, base } = await bootApp(undefined);
  try {
    const res = await fetch(`${base}/api/v1/vessels`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.available, false);
    assert.equal(body.count, 0);
    assert.deepEqual(body.vessels, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/v1/vessels returns live vessel data when a store is present', async () => {
  const vesselStore = new VesselStore();
  vesselStore.upsert({
    mmsi: '123456789',
    shipName: 'EVER GIVEN',
    lat: 30.01,
    lon: 32.58,
    headingDeg: 87,
    speedKnots: 12.3,
  });

  const { server, base } = await bootApp(vesselStore);
  try {
    const res = await fetch(`${base}/api/v1/vessels`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.available, true);
    assert.equal(body.count, 1);
    assert.equal(body.vessels[0].mmsi, '123456789');
    assert.equal(body.vessels[0].shipName, 'EVER GIVEN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/v1/vessels sets a short cache window (positions go stale fast)', async () => {
  const { server, base } = await bootApp(undefined);
  try {
    const res = await fetch(`${base}/api/v1/vessels`);
    assert.match(res.headers.get('cache-control') || '', /max-age=10/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
