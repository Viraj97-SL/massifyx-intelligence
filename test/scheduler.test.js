'use strict';

// Previously untested (lib/scheduler.js had zero direct test coverage).
// Regression coverage for a real bug found in the 2026-09 audit: the poll
// loop fired on every tick regardless of whether the previous tick's task
// was still running. A single poll cycle can legitimately outlast
// GDELT_POLL_INTERVAL_MINUTES (many candidate events, each up to 4
// sequential LLM calls with their own retry/timeout budget -- see
// lib/enrich/pipeline.js), or a stalled GDELT fetch could hang it outright
// (see lib/gdelt/ingest.js's fetchTimeoutMs fix) -- either way, overlapping
// pollOnce() calls mean concurrent PostgresEventStore transactions, doubled
// LLM spend for the same window, and eventual Postgres pool exhaustion.
//
// Uses real (short) timers rather than injecting a fake setInterval: this
// module has no existing timer-injection point, and adding one speculatively
// (see this repo's YAGNI convention) isn't worth it just for this test --
// tens of milliseconds of real wall-clock time is cheap and deterministic
// enough here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPoller } = require('../lib/scheduler');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('does not start an overlapping tick while the previous task is still running', async () => {
  let starts = 0;
  let running = 0;
  let maxConcurrent = 0;
  let releaseFirstRun;
  const firstRunGate = new Promise((resolve) => {
    releaseFirstRun = resolve;
  });

  const poller = createPoller(async () => {
    starts += 1;
    running += 1;
    maxConcurrent = Math.max(maxConcurrent, running);
    if (starts === 1) {
      await firstRunGate; // hold the first tick open past several intervals
    }
    running -= 1;
  }, 10);

  poller.start();
  try {
    // At 10ms intervals, 60ms is several ticks' worth -- every one of them
    // should be skipped while the first run is still gated open.
    await wait(60);
    assert.equal(starts, 1, 'no overlapping tick should have started yet');
    assert.equal(maxConcurrent, 1, 'at most one task should ever run at a time');

    releaseFirstRun();
    await wait(40); // let the loop resume and fire at least one more tick

    assert.ok(starts >= 2, 'ticks should resume once the previous one finishes');
    assert.equal(maxConcurrent, 1, 'still only ever one task running at a time');
  } finally {
    poller.stop();
  }
});

test('a task that rejects does not stop future ticks, and does not count as still running', async () => {
  let calls = 0;
  const poller = createPoller(async () => {
    calls += 1;
    throw new Error('transient failure');
  }, 10);

  poller.start();
  try {
    await wait(55);
    assert.ok(calls >= 2, `expected multiple ticks after a rejection, got ${calls}`);
  } finally {
    poller.stop();
  }
});

test('stop() prevents any further ticks', async () => {
  let calls = 0;
  const poller = createPoller(async () => {
    calls += 1;
  }, 10);

  poller.start();
  await wait(25);
  poller.stop();
  const callsAtStop = calls;
  await wait(40);

  assert.equal(calls, callsAtStop, 'no ticks should fire after stop()');
});
