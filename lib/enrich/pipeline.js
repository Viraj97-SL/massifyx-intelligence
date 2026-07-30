'use strict';

const { validateCategory } = require('./category');
const { computeSeverity } = require('./severity');
const { clusterKey } = require('./clusterKey');
const { withResilience } = require('../llm/withResilience');

const RELEVANCE_THRESHOLD = 0.5;

function buildRelevancePrompt(event) {
  return `Is the following news event a supply-chain disruption (port strikes, weather, geopolitical restrictions, logistics failures, supplier shutdowns)? Answer with only a number from 0 to 1 for relevance.\nActors: ${event.actor1}, ${event.actor2}\nLocation: ${event.location}\nURL: ${event.sourceUrl}`;
}

function buildClassifyPrompt(event) {
  return `Classify this supply-chain disruption into exactly one of: weather, geopolitical, labor, logistics, regulatory, supplier, other.\nActors: ${event.actor1}, ${event.actor2}\nLocation: ${event.location}\nRespond with only the category word.`;
}

function buildSeverityPrompt(event) {
  return `Rate the severity of this supply-chain disruption from 1 (minor) to 5 (severe).\nActors: ${event.actor1}, ${event.actor2}\nLocation: ${event.location}\nMentions: ${event.numMentions}, Sources: ${event.numSources}\nRespond with only the integer.`;
}

function buildSummaryPrompt(event, category) {
  return `Write one neutral sentence (no hype, no invented facts) describing what happened and who it affects.\nCategory: ${category}\nActors: ${event.actor1}, ${event.actor2}\nLocation: ${event.location}`;
}

function parseRelevanceScore(text) {
  const score = Number.parseFloat(text);
  return Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
}

function parseSeverityScore(text) {
  const score = Number.parseInt(text, 10);
  return Number.isFinite(score) ? score : null;
}

function firstSentence(text) {
  return text.split(/(?<=[.!?])\s/)[0];
}

// llmCall(prompt) => Promise<string>, injected so tests never touch a real
// LLM. Returns the enriched event in the site's API-contract shape, or null
// if the event should be dropped — irrelevant, invalid category, or an LLM
// call that never recovered after retries. Never returns a half-enriched
// event.
async function enrichEvent(rawEvent, { llmCall, resilienceOptions } = {}) {
  try {
    const relevanceText = await withResilience(
      () => llmCall(buildRelevancePrompt(rawEvent)),
      resilienceOptions,
    );
    const relevance = parseRelevanceScore(relevanceText);
    if (relevance < RELEVANCE_THRESHOLD) return null;

    const categoryText = await withResilience(
      () => llmCall(buildClassifyPrompt(rawEvent)),
      resilienceOptions,
    );
    const category = validateCategory(categoryText);
    if (!category) return null;

    const severityText = await withResilience(
      () => llmCall(buildSeverityPrompt(rawEvent)),
      resilienceOptions,
    );
    const severity = computeSeverity(category, parseSeverityScore(severityText));

    const summaryText = await withResilience(
      () => llmCall(buildSummaryPrompt(rawEvent, category)),
      resilienceOptions,
    );
    const summary = summaryText.trim();
    if (!summary) return null;

    const now = new Date().toISOString();
    return {
      id: clusterKey({
        category,
        lat: rawEvent.lat,
        lon: rawEvent.lon,
        eventDate: rawEvent.eventDate,
      }),
      title: firstSentence(summary),
      summary,
      category,
      severity,
      lat: rawEvent.lat,
      lon: rawEvent.lon,
      location: rawEvent.location,
      sourceCount: rawEvent.numSources,
      firstSeenAt: now,
      lastUpdatedAt: now,
      sourceUrl: rawEvent.sourceUrl,
      relevanceScore: relevance,
    };
  } catch {
    // Exhausted retries or an unexpected failure: drop, never half-enrich.
    return null;
  }
}

module.exports = {
  enrichEvent,
  buildRelevancePrompt,
  buildClassifyPrompt,
  parseRelevanceScore,
  parseSeverityScore,
  RELEVANCE_THRESHOLD,
};
