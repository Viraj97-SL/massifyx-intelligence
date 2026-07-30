'use strict';

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Every LLM call gets a timeout and a retry policy. The safe fallback is the
// caller's job: on exhausted retries this rejects, and enrichEvent() catches
// that to drop the event rather than half-enrich it.
async function withResilience(fn, { retries = 2, timeoutMs = 8000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports = { withResilience, withTimeout };
