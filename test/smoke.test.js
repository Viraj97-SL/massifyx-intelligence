'use strict';

// Real end-to-end smoke test: boots server.js's actual main() -- the same
// function that runs in production -- with zero external configuration, and
// proves the README's "runs fine with nothing configured" claim is actually
// true (and stays true as the codebase changes). No DATABASE_URL (falls back
// to MemoryEventStore), no DEEPSEEK_API_KEY (enrichment disabled), no
// AISSTREAM_API_KEY (vessel tracking disabled) -- only the HTTP server
// itself needs to come up and answer its own health check.
//
// PORT=0 asks the OS for an ephemeral free port so this never collides with
// anything else running locally or in CI.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePort } = require('../server.js');

const ENV_KEYS = ['PORT', 'DATABASE_URL', 'DEEPSEEK_API_KEY', 'AISSTREAM_API_KEY', 'GDELT_POLL_INTERVAL_MINUTES'];

// Regression test for a real bug found while writing the boot test below:
// `Number(process.env.PORT) || DEFAULT_PORT` silently ignores an explicit
// PORT=0 (a real, meaningful request for an OS-assigned ephemeral port)
// because 0 is falsy -- it would always fall back to DEFAULT_PORT instead.
test('resolvePort treats an explicit 0 as a real port, not "unset"', () => {
  assert.equal(resolvePort('0', 3001), 0);
  assert.equal(resolvePort('4000', 3001), 4000);
  assert.equal(resolvePort(undefined, 3001), 3001);
  assert.equal(resolvePort('not-a-number', 3001), 3001);
  assert.equal(resolvePort('', 3001), 3001, 'a blank PORT (unset or "PORT=") should still fall back safely');
});

test('server.js main() boots with no external config and /api/v1/health responds 200', async () => {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.PORT = '0';

  // Fresh require so main() re-reads process.env as set just above, rather
  // than reusing a module instance some other test file already required
  // with different env vars baked into its closures.
  delete require.cache[require.resolve('../server.js')];
  const { main } = require('../server.js');

  let handle;
  try {
    handle = await main();
    const { server, poller } = handle;

    assert.ok(server.listening, 'HTTP server should be listening');
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.eventCount, 0);
    assert.equal(body.lastIngestAt, null);

    const disruptionsRes = await fetch(`http://127.0.0.1:${port}/api/v1/disruptions`);
    assert.equal(disruptionsRes.status, 200);

    const vesselsRes = await fetch(`http://127.0.0.1:${port}/api/v1/vessels`);
    assert.equal(vesselsRes.status, 200);
    const vesselsBody = await vesselsRes.json();
    assert.equal(vesselsBody.available, false, 'no AISSTREAM_API_KEY means vessels stay unavailable');

    poller.stop();
  } finally {
    if (handle && handle.server) {
      await new Promise((resolve) => handle.server.close(resolve));
    }
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    delete require.cache[require.resolve('../server.js')];
  }
});
