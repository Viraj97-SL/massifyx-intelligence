'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreGroundedness,
  isVacuous,
  VACUOUS_PHRASE_MARKERS,
  VACUOUS_EXAMPLES,
  CONCRETE_EXAMPLES,
  DEFAULT_VACUOUS_THRESHOLD,
} = require('../lib/ml/summaryGroundedness');

// A test event whose actor/location vocabulary does NOT appear in any of
// the module's hand-authored training sentences (several of which mention
// Rotterdam). Using an overlapping name here would let the token-overlap
// component ride on words the NB classifier already associates with
// "concrete" from training, muddying what each test is actually checking.
function rawEvent(overrides = {}) {
  return {
    actor1: 'MOMBASA PORT AUTHORITY',
    actor2: 'KENYA DOCKWORKERS UNION',
    location: 'Mombasa, Coast, Kenya',
    ...overrides,
  };
}

test('scores a clearly vacuous sentence low', () => {
  const score = scoreGroundedness(
    'An event occurred involving the parties in the region.',
    rawEvent(),
  );
  assert.ok(score < 0.2, `expected a low score, got ${score}`);
});

test('scores a clearly concrete sentence high', () => {
  const score = scoreGroundedness(
    'Dockworkers at the Port of Mombasa went on strike, halting container unloading for 36 hours.',
    rawEvent(),
  );
  assert.ok(score > 0.7, `expected a high score, got ${score}`);
});

test('every hand-labelled vacuous example scores below every concrete example (neutral event)', () => {
  // Neutral event isolates the NB + concrete-signal components from the
  // overlap component, so this checks that the classifier itself
  // separates the two classes cleanly, independent of any given event.
  const neutralEvent = {};
  const maxVacuous = Math.max(...VACUOUS_EXAMPLES.map((s) => scoreGroundedness(s, neutralEvent)));
  const minConcrete = Math.min(...CONCRETE_EXAMPLES.map((s) => scoreGroundedness(s, neutralEvent)));
  assert.ok(
    maxVacuous < minConcrete,
    `expected classes to separate: max vacuous ${maxVacuous} should be < min concrete ${minConcrete}`,
  );
  assert.ok(maxVacuous < DEFAULT_VACUOUS_THRESHOLD);
  assert.ok(minConcrete > DEFAULT_VACUOUS_THRESHOLD);
});

test('isVacuous gates a vacuous summary as true', () => {
  assert.equal(
    isVacuous('Details remain unclear at this time.', rawEvent()),
    true,
  );
});

test('isVacuous gates a concrete summary as false', () => {
  assert.equal(
    isVacuous(
      'The Mombasa Port Authority halted 3,000 containers after dockworkers began a strike over pay.',
      rawEvent(),
    ),
    false,
  );
});

test('isVacuous respects a custom threshold override', () => {
  const summary = 'Workers may have raised concerns near the port.';
  const score = scoreGroundedness(summary, rawEvent());
  // Pick a threshold pinned just above the observed score so raising the
  // bar flips a borderline summary to vacuous, and lowering it flips back.
  assert.equal(isVacuous(summary, rawEvent(), score + 0.01), true);
  assert.equal(isVacuous(summary, rawEvent(), Math.max(0, score - 0.01)), false);
});

test('edge case: empty string scores 0 and is vacuous', () => {
  assert.equal(scoreGroundedness('', rawEvent()), 0);
  assert.equal(isVacuous('', rawEvent()), true);
});

test('edge case: very short summary with a concrete verb is not automatically vacuous', () => {
  const score = scoreGroundedness('Strike halted operations.', rawEvent());
  assert.ok(score >= 0, `score should be a valid probability, got ${score}`);
  assert.ok(score <= 1, `score should be a valid probability, got ${score}`);
  // Short and entity-free, but has a real disruption verb -- shouldn't be
  // scored as confidently concrete as a full sentence naming the place.
  const fullScore = scoreGroundedness(
    'A strike at the Port of Mombasa halted container unloading.',
    rawEvent(),
  );
  assert.ok(score < fullScore, 'a bare short summary should score lower than a fully grounded one');
});

test('edge case: summary that is just the location name repeated scores low', () => {
  const score = scoreGroundedness('Mombasa Mombasa Mombasa.', rawEvent());
  // High token overlap with the event's location is not enough on its own:
  // there's no action verb, no quantity, no second entity -- it should
  // still read as vacuous rather than a legitimate summary.
  assert.ok(isVacuous('Mombasa Mombasa Mombasa.', rawEvent()));
  assert.ok(score < DEFAULT_VACUOUS_THRESHOLD, `expected below threshold, got ${score}`);
});

test('edge case: summary containing a concrete number and named entity scores high', () => {
  const score = scoreGroundedness(
    'The Kenya Dockworkers Union confirmed 3,000 containers were stranded at Mombasa.',
    rawEvent(),
  );
  assert.ok(score > 0.6, `expected a high score for a number + named entity, got ${score}`);
  assert.equal(isVacuous(
    'The Kenya Dockworkers Union confirmed 3,000 containers were stranded at Mombasa.',
    rawEvent(),
  ), false);
});

test('VACUOUS_PHRASE_MARKERS is a non-empty, inspectable list of lowercase phrases', () => {
  assert.ok(Array.isArray(VACUOUS_PHRASE_MARKERS));
  assert.ok(VACUOUS_PHRASE_MARKERS.length > 0);
  for (const phrase of VACUOUS_PHRASE_MARKERS) {
    assert.equal(typeof phrase, 'string');
    assert.equal(phrase, phrase.toLowerCase());
  }
});

test('a summary with zero token overlap with the event is penalized relative to a grounded one', () => {
  const grounded = scoreGroundedness(
    'The Mombasa Port Authority halted operations after a fire damaged the main terminal.',
    rawEvent(),
  );
  const ungrounded = scoreGroundedness(
    'The Rotterdam Port Authority halted operations after a fire damaged the main terminal.',
    rawEvent(),
  );
  assert.ok(
    ungrounded <= grounded,
    `summary mentioning an unrelated place should not score higher than one mentioning the actual event, got ungrounded=${ungrounded} grounded=${grounded}`,
  );
});
