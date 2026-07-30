'use strict';

// Thin wrapper around setInterval so the poll loop is start/stop-able and
// swappable for a fake timer in tests, instead of tests waiting on real time.
function createPoller(task, intervalMs) {
  let handle = null;

  return {
    start() {
      if (handle) return;
      handle = setInterval(() => {
        Promise.resolve(task()).catch((err) => {
          console.error('[MIS] poll task failed:', err.message);
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
