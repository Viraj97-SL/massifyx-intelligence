'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withResilience } = require('../lib/llm/withResilience');

test('returns the value on first success without retrying', async () => {
  let calls = 0;
  const result = await withResilience(async () => {
    calls += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retries on failure up to the configured count, then succeeds', async () => {
  let calls = 0;
  const result = await withResilience(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'recovered';
    },
    { retries: 2, timeoutMs: 1000 },
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
});

test('throws after exhausting all retries', async () => {
  let calls = 0;
  await assert.rejects(
    withResilience(
      async () => {
        calls += 1;
        throw new Error('always fails');
      },
      { retries: 1, timeoutMs: 1000 },
    ),
    /always fails/,
  );
  assert.equal(calls, 2);
});

test('a call that never resolves is treated as a timeout failure', async () => {
  await assert.rejects(
    withResilience(() => new Promise(() => {}), { retries: 0, timeoutMs: 20 }),
    /timed out after 20ms/,
  );
});
