'use strict';

const CATEGORY_ENUM = [
  'weather',
  'geopolitical',
  'labor',
  'logistics',
  'regulatory',
  'supplier',
  'other',
];

// Never emit an unknown category (DESIGN.md §4). Anything the classifier
// returns that isn't in the fixed enum is rejected outright — the caller
// decides that means dropping the event, not guessing a category for it.
function validateCategory(candidate) {
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.trim().toLowerCase();
  return CATEGORY_ENUM.includes(normalized) ? normalized : null;
}

module.exports = { CATEGORY_ENUM, validateCategory };
