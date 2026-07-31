'use strict';

// An alias, not a pinned version — Google retires dated model names
// (gemini-1.5-flash-class models are gone as of this writing), and
// "-latest" tracks whatever the current recommended flash-tier model is
// instead of going stale again.
const DEFAULT_MODEL = 'gemini-flash-latest';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Thin REST wrapper (no SDK dependency, matches the site's no-build-step,
// minimal-dependency convention). fetchImpl is injected so every caller can
// be tested without a real key or a network call — same pattern as the
// GDELT ingest worker.
async function callGemini({ apiKey, model = DEFAULT_MODEL, prompt, fetchImpl }) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (!apiKey) throw new Error('apiKey is required');

  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Gemini response missing candidate text');
  }
  return text;
}

module.exports = { callGemini, DEFAULT_MODEL };
