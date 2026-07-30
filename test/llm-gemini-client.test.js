'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { callGemini, DEFAULT_MODEL } = require('../lib/llm/geminiClient');

test('returns the candidate text on a successful response', async () => {
  const fetchImpl = async (url, options) => {
    assert.ok(url.includes(DEFAULT_MODEL));
    assert.ok(url.includes('key=test-key'));
    assert.equal(options.method, 'POST');
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '0.9' }] } }],
      }),
    };
  };

  const text = await callGemini({ apiKey: 'test-key', prompt: 'irrelevant', fetchImpl });
  assert.equal(text, '0.9');
});

test('throws a clear error on a non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    callGemini({ apiKey: 'test-key', prompt: 'irrelevant', fetchImpl }),
    /Gemini API error: 429/,
  );
});

test('throws when the response has no candidate text', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [] }) });
  await assert.rejects(
    callGemini({ apiKey: 'test-key', prompt: 'irrelevant', fetchImpl }),
    /missing candidate text/,
  );
});

test('requires an apiKey and a fetchImpl', async () => {
  await assert.rejects(callGemini({ prompt: 'x', fetchImpl: async () => {} }), /apiKey is required/);
  await assert.rejects(callGemini({ apiKey: 'k', prompt: 'x' }), /fetchImpl is required/);
});
