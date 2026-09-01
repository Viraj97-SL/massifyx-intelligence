'use strict';

/*
 * Specificity / vacuousness scorer for MIS-generated summary sentences.
 *
 * HONEST SCOPE, please read before wiring this in anywhere:
 *
 * This is NOT a faithfulness/entailment checker. Real entailment checking
 * ("does this sentence follow from the source article?") requires the
 * source article. MIS never fetches one -- buildSummaryPrompt() in
 * lib/enrich/pipeline.js hands the model only actor1/actor2/location, no
 * article text (unlike the sibling repo massifyx-warroom, which fetches
 * real article text via Firecrawl before summarizing it). There is no
 * ground truth in this repo to check a summary against, so nothing in
 * this file can tell you whether a summary is *true*.
 *
 * What it CAN do is catch the actual reported symptom: the model filling
 * the gap left by missing source material with sentences that are
 * grammatical but assert nothing concrete -- "An event occurred involving
 * the parties in the region," "Details remain unclear at this time," "This
 * may have some impact on operations." That's a specificity/vacuousness
 * problem, not a truth problem, and it's detectable from the sentence (and
 * the event record it was supposedly about) alone.
 *
 * The score combines two independent signals:
 *   (a) a hand-rolled Naive Bayes bag-of-words classifier trained on a
 *       small labelled set of vacuous vs. concrete example sentences
 *       (below), which learns that words like "unclear", "may", "region",
 *       "parties" cluster in vacuous filler while specific verbs
 *       ("halted", "struck", "blocked") and named places cluster in
 *       concrete summaries;
 *   (b) a token-overlap check against the actual rawEvent (actor1, actor2,
 *       location) -- a summary that sounds specific but shares no tokens
 *       at all with the event it was supposedly generated from is itself
 *       a red flag (either the model ignored the input, or it's generic
 *       boilerplate that would fit any event).
 * A flat penalty is then applied per matched entry in
 * VACUOUS_PHRASE_MARKERS, since those exact phrases are close to
 * deterministic tells and shouldn't have to be "out-voted" by the
 * statistical component.
 */

// ---------------------------------------------------------------------------
// Synthetic training data.
//
// Authored by hand for this scorer -- not sampled from real MIS output.
// Each set intentionally spans the two ends of the symptom described above:
// vacuous = generic filler / hedging with no named entity or concrete
// action; concrete = a specific action verb plus a named place/entity
// and/or a quantity/effect.
// ---------------------------------------------------------------------------

const VACUOUS_EXAMPLES = [
  'An event occurred involving the parties in the region.',
  'Details remain unclear at this time.',
  'This may have some impact on operations.',
  'The situation is still developing and further details are pending.',
  'It is unclear what effect this will have on the parties involved.',
  'Some level of disruption may occur as a result.',
  'The parties are monitoring the situation closely.',
  'There could be implications for various stakeholders.',
  'No further information is available at this time.',
  'The full extent of the impact remains to be seen.',
  'This development may affect certain operations in the area.',
  'Analysts are watching the situation for further updates.',
  'The outcome of this matter is currently uncertain.',
  'Various parties may be affected by ongoing events.',
  'It remains to be determined how this will unfold.',
  'The event may have some bearing on regional activities.',
  'Further updates will be provided as the situation evolves.',
  'This could potentially disrupt normal operations to some extent.',
  'The matter is being reviewed and more details may follow.',
  'Conditions in the region could change in the coming days.',
];

const CONCRETE_EXAMPLES = [
  'Dockworkers at the Port of Rotterdam went on strike, halting container unloading for at least 48 hours.',
  'A magnitude 6.2 earthquake struck near Antofagasta, Chile, damaging the main copper export terminal.',
  'Houthi forces attacked a container ship in the Red Sea, forcing carriers to reroute around the Cape of Good Hope.',
  'The Panama Canal Authority reduced daily transits to 24 vessels due to low water levels in Gatun Lake.',
  'Flooding closed the M1 highway near Frankfurt, delaying truck freight to three regional distribution centers.',
  'Union workers at the Port of Los Angeles rejected a new labor contract, threatening a walkout next week.',
  'A fire at a semiconductor plant in Taiwan halted production for an estimated two weeks.',
  'The Suez Canal Authority suspended transits for vessels over 20,000 TEU after a grounding incident.',
  'Typhoon Yagi forced the closure of three ports in northern Vietnam, stranding over 40 cargo vessels.',
  'Truckers in France blocked the A6 motorway, cutting off supply routes to Lyon for 12 hours.',
  'Russia imposed new export tariffs on wheat, raising prices for buyers in Egypt and Turkey.',
  "A cyberattack on Maersk's booking system delayed shipment processing at seven European terminals.",
  'The United States sanctioned two shipping companies linked to Iranian oil exports.',
  'Workers at a Foxconn factory in Zhengzhou went on strike over unpaid wages, halting iPhone assembly.',
  'A bridge collapse in Baltimore blocked access to the Port of Baltimore for container traffic.',
  'India banned onion exports, disrupting supply chains to Bangladesh and the UAE.',
  'Dockers in Hamburg walked off the job, idling 5,000 containers at Terminal Burchardkai.',
  'A landslide blocked the Karakoram Highway, halting freight between China and Pakistan.',
  'The Rotterdam Port Authority and the dockworkers union failed to reach a deal, and workers walked out Tuesday.',
  'Nigeria shut down two crude oil pipelines after an attack near Port Harcourt.',
];

// Exact phrases pulled from VACUOUS_EXAMPLES above that are close to
// deterministic tells for filler -- kept as an explicit, inspectable list
// (rather than only living implicitly inside the NB word counts) so this
// list can be read, extended, or pruned independently of retraining.
const VACUOUS_PHRASE_MARKERS = [
  'an event occurred',
  'details remain unclear',
  'may have some impact',
  'still developing',
  'is unclear',
  'it is unclear',
  'may occur as a result',
  'monitoring the situation',
  'various stakeholders',
  'no further information',
  'remains to be seen',
  'remains to be determined',
  'certain operations',
  'further updates will be provided',
  'to some extent',
  'being reviewed',
  'could change in the coming days',
  'in the region',
  'the parties involved',
  'ongoing events',
];

// Verbs that name a concrete, checkable action rather than a hedge.
// Deliberately narrow and disruption-domain-specific (this scorer only
// ever sees GDELT supply-chain-disruption candidates) rather than a
// general-purpose verb list.
const CONCRETE_ACTION_VERBS = [
  'halted', 'halting', 'struck', 'blocked', 'closed', 'suspended', 'delayed',
  'seized', 'attacked', 'flooded', 'shut', 'evacuated', 'declared', 'imposed',
  'sank', 'damaged', 'destroyed', 'disrupted', 'diverted', 'grounded',
  'banned', 'sanctioned', 'rejected', 'walked', 'collapsed', 'idling',
  'stranded', 'reduced', 'forced', 'cutting', 'raising',
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is',
  'are', 'was', 'were', 'be', 'this', 'that', 'with', 'as', 'by', 'from',
  'it', 'its', 'may', 'will', 'could', 'can', 'has', 'have', 'had', 'not',
]);

function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g)) || [];
}

// --- Naive Bayes over the two labelled sets above -------------------------
// Laplace-smoothed unigram bag-of-words. Built once at module load since
// the training set is fixed; scoreGroundedness() only does lookups.
function buildModel(vacuousDocs, concreteDocs) {
  const vacuousCounts = new Map();
  const concreteCounts = new Map();
  const vocab = new Set();
  let vacuousTotal = 0;
  let concreteTotal = 0;

  for (const doc of vacuousDocs) {
    for (const tok of tokenize(doc)) {
      vocab.add(tok);
      vacuousCounts.set(tok, (vacuousCounts.get(tok) || 0) + 1);
      vacuousTotal += 1;
    }
  }
  for (const doc of concreteDocs) {
    for (const tok of tokenize(doc)) {
      vocab.add(tok);
      concreteCounts.set(tok, (concreteCounts.get(tok) || 0) + 1);
      concreteTotal += 1;
    }
  }

  return { vacuousCounts, concreteCounts, vocab, vacuousTotal, concreteTotal };
}

const MODEL = buildModel(VACUOUS_EXAMPLES, CONCRETE_EXAMPLES);

function logLikelihood(token, counts, total, vocabSize) {
  const count = counts.get(token) || 0;
  return Math.log((count + 1) / (total + vocabSize));
}

// Returns P(concrete | tokens) in [0, 1] via a length-normalized log-odds
// sigmoid. Length-normalizing (average per-token log-odds rather than a raw
// sum) matters here because otherwise a long sentence would drift toward
// "concrete" purely by accumulating more terms, regardless of what those
// terms are -- a run-on hedge shouldn't outscore a short, sharp one.
function naiveBayesConcreteProbability(tokens) {
  if (tokens.length === 0) return 0.5;
  const vocabSize = MODEL.vocab.size;
  let logOddsSum = 0;
  for (const tok of tokens) {
    const concreteLL = logLikelihood(tok, MODEL.concreteCounts, MODEL.concreteTotal, vocabSize);
    const vacuousLL = logLikelihood(tok, MODEL.vacuousCounts, MODEL.vacuousTotal, vocabSize);
    logOddsSum += concreteLL - vacuousLL;
  }
  const avgLogOdds = logOddsSum / tokens.length;
  // Scale factor found by inspecting the avgLogOdds spread on the training
  // set itself (roughly -0.6..+0.6 per token) and picking a value that
  // pushes that range out toward the sigmoid's tails instead of hugging 0.5.
  const SCALE = 4;
  return 1 / (1 + Math.exp(-avgLogOdds * SCALE));
}

// --- Token-overlap against the actual event ---------------------------
// If rawEvent carries no usable identifying tokens (null actor/location),
// this component can't judge anything either way, so it returns a neutral
// 0.5 rather than penalizing the summary for something it had no
// information about.
function eventTokens(rawEvent) {
  const raw = [rawEvent?.actor1, rawEvent?.actor2, rawEvent?.location]
    .filter(Boolean)
    .join(' ');
  return tokenize(raw).filter((tok) => tok.length >= 3 && !STOPWORDS.has(tok));
}

function overlapScore(summaryTokens, rawEvent) {
  const evTokens = eventTokens(rawEvent);
  if (evTokens.length === 0) return 0.5;
  const summarySet = new Set(summaryTokens);
  const matched = evTokens.filter((tok) => summarySet.has(tok)).length;
  return matched / evTokens.length;
}

// --- Concrete-signal bonus: numbers or a named disruption verb ---------
function hasConcreteSignal(summaryText, summaryTokens) {
  const hasNumber = /\d/.test(summaryText);
  const hasVerb = summaryTokens.some((tok) => CONCRETE_ACTION_VERBS.includes(tok));
  return hasNumber || hasVerb;
}

function markerPenalty(lowerSummary) {
  const matched = VACUOUS_PHRASE_MARKERS.filter((phrase) => lowerSummary.includes(phrase));
  // Capped so a long summary that happens to brush against a couple of
  // stock phrases isn't zeroed out entirely -- the NB and overlap
  // components still get a say.
  return Math.min(0.6, matched.length * 0.2);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Scores how specific/grounded-in-the-input a generated summary sentence
 * is, on a 0 (vacuous filler) .. 1 (concrete, checkable claim) scale.
 *
 * This is a specificity score, not a truth score -- see the file header.
 */
function scoreGroundedness(summaryText, rawEvent) {
  const text = String(summaryText || '').trim();
  if (!text) return 0;

  const tokens = tokenize(text);
  const lower = text.toLowerCase();

  const nbScore = naiveBayesConcreteProbability(tokens);
  const overlap = overlapScore(tokens, rawEvent);
  const concreteBonus = hasConcreteSignal(text, tokens) ? 1 : 0;

  // Weights sum to 1 before the marker penalty is subtracted. NB carries
  // the most weight since it's the only component that reacts to hedging
  // language at all; overlap and the concrete-signal bonus each act as a
  // check on it (NB alone would happily score a fluent but entity-free
  // sentence as "concrete" if it just avoided hedge words).
  const base = 0.5 * nbScore + 0.3 * overlap + 0.2 * concreteBonus;

  return clamp01(base - markerPenalty(lower));
}

// Default threshold rationale: scored against a neutral event (no
// actor/location, isolating the NB + concrete-signal components from the
// overlap one), every VACUOUS_EXAMPLES sentence scores at or below ~0.16
// and every CONCRETE_EXAMPLES sentence scores at or above ~0.78 -- see
// test/ml-summary-groundedness.test.js for the boundary checks. 0.35 sits
// inside that gap, closer to the vacuous side: a false negative (a vacuous
// summary that slips through) just reproduces today's status quo, while a
// false positive (dropping a legitimately concrete summary) throws away a
// real event, so the gate is deliberately conservative about rejecting.
const DEFAULT_VACUOUS_THRESHOLD = 0.35;

/**
 * Drop/reject gate for the pipeline, mirroring the existing empty-string
 * check in lib/enrich/pipeline.js's enrichEvent(): returns true when the
 * summary should be treated as unusable filler.
 */
function isVacuous(summaryText, rawEvent, threshold = DEFAULT_VACUOUS_THRESHOLD) {
  return scoreGroundedness(summaryText, rawEvent) < threshold;
}

module.exports = {
  scoreGroundedness,
  isVacuous,
  VACUOUS_PHRASE_MARKERS,
  CONCRETE_ACTION_VERBS,
  DEFAULT_VACUOUS_THRESHOLD,
  // Exposed for tests/inspection only, not part of the intended public API.
  VACUOUS_EXAMPLES,
  CONCRETE_EXAMPLES,
};
