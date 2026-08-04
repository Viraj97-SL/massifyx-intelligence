'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { callDeepSeek, DEFAULT_MODEL } = require('../lib/llm/deepseekClient');

test('returns the message content on a successful response', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, DEFAULT_MODEL);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'irrelevant' }]);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '0.9' } }] }),
    };
  };

  const text = await callDeepSeek({ apiKey: 'test-key', prompt: 'irrelevant', fetchImpl });
  assert.equal(text, '0.9');
});

test('throws a clear error on a non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    callDeepSeek({ apiKey: 'test-key', prompt: 'irrelevant', fetchImpl }),
    /DeepSeek API error: 429/,
  );
});

test('throws when the response has no message content', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [] }) });
  await assert.rejects(
    callDeepSeek({ apiKey: 'test-key', prompt: 'irrelevant', fetchImpl }),
    /missing choices\[0\]\.message\.content/,
  );
});

test('requires an apiKey and a fetchImpl', async () => {
  await assert.rejects(callDeepSeek({ prompt: 'x', fetchImpl: async () => {} }), /apiKey is required/);
  await assert.rejects(callDeepSeek({ apiKey: 'k', prompt: 'x' }), /fetchImpl is required/);
});
