'use strict';

// Deterministic floor per category so an AI-proposed score can't silently
// undersell how serious an event class categorically is (DESIGN.md §6.5) —
// e.g. a named port closure can't score 1 just because the model said so.
const SEVERITY_FLOOR = {
  weather: 1,
  geopolitical: 2,
  labor: 2,
  logistics: 2,
  regulatory: 2,
  supplier: 1,
  other: 1,
};

function clampSeverity(value) {
  return Math.min(5, Math.max(1, Math.round(value)));
}

function computeSeverity(category, aiProposedSeverity) {
  const floor = SEVERITY_FLOOR[category] ?? 1;
  const proposed = Number.isFinite(aiProposedSeverity)
    ? clampSeverity(aiProposedSeverity)
    : floor;
  return Math.max(floor, proposed);
}

module.exports = { computeSeverity, clampSeverity, SEVERITY_FLOOR };
