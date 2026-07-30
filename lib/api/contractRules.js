'use strict';

const { CATEGORY_ENUM } = require('../enrich/category');

// Shared contract assertions for a single disruption event (DESIGN.md §4).
// Meant to be copied verbatim into the site repo's own contract test so
// both sides fail loudly on drift instead of silently disagreeing.
function assertValidDisruptionEvent(event) {
  const errors = [];

  if (!Number.isInteger(event.severity) || event.severity < 1 || event.severity > 5) {
    errors.push(`severity must be an integer 1-5, got ${event.severity}`);
  }
  if (!CATEGORY_ENUM.includes(event.category)) {
    errors.push(`category "${event.category}" is not in the fixed enum`);
  }
  if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) {
    errors.push('lat/lon must both be present and finite');
  }
  if (typeof event.id !== 'string' || event.id.length === 0) {
    errors.push('id must be a non-empty stable string');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid disruption event: ${errors.join('; ')}`);
  }
}

module.exports = { assertValidDisruptionEvent };
