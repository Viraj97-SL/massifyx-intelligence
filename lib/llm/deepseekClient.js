'use strict';

// DeepSeek's OpenAI-compatible chat-completions endpoint (verified against
// api-docs.deepseek.com), used the same way massifyx-warroom's Python
// service uses it (app/llm/deepseek_client.py) -- kept as its own thin
// REST wrapper here too, no SDK dependency, matching this file's own prior
// geminiClient.js convention (fetchImpl injected so every caller is
// testable with zero real key/network call).
const DEFAULT_MODEL = 'deepseek-chat';
const API_URL = 'https://api.deepseek.com/chat/completions';

async function callDeepSeek({ apiKey, model = DEFAULT_MODEL, prompt, fetchImpl }) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (!apiKey) throw new Error('apiKey is required');

  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('DeepSeek response missing choices[0].message.content');
  }
  return text;
}

module.exports = { callDeepSeek, DEFAULT_MODEL };
