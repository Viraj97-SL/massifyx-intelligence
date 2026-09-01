'use strict';

// Thin wrapper around setInterval so the poll loop is start/stop-able and
// swappable for a fake timer in tests, instead of tests waiting on real time.
//
// Bug fix (2026-09 audit): this used to fire `task()` on every tick
// regardless of whether the previous tick's task was still running. A single
// poll cycle (lib/gdelt/ingest.js's fetch + up to 4 sequential LLM calls per
// candidate event, each with its own retry/timeout budget) can legitimately
// take longer than GDELT_POLL_INTERVAL_MINUTES on a heavy news day, and
// lib/gdelt/ingest.js's own GDELT fetch had no timeout at all (see that
// file's fix) -- either one meant setInterval could start a second
// pollOnce() while the first was still mid-flight. Concurrent pollOnce()
// calls mean concurrent PostgresEventStore.upsertEvents() transactions each
// holding a pooled client for their full duration, doubled (or worse, ever
// climbing) LLM spend for the same GDELT window, and eventually pool
// exhaustion starving the read API's own queries. Skipping an overlapping
// tick (and logging it) is strictly safer than letting them stack.
function createPoller(task, intervalMs) {
  let handle = null;
  let running = false;

  return {
    start() {
      if (handle) return;
      handle = setInterval(() => {
        if (running) {
          console.warn('[MIS] poll tick skipped: previous cycle is still running');
          return;
        }
        running = true;
        Promise.resolve(task())
          .catch((err) => {
            console.error('[MIS] poll task failed:', err.message);
          })
          .finally(() => {
            running = false;
          });
      }, intervalMs);
      handle.unref?.();
    },
    stop() {
      if (!handle) return;
      clearInterval(handle);
      handle = null;
    },
  };
}

module.exports = { createPoller };
