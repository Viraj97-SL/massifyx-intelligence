'use strict';

// GDELT's EVENTCODE is a CAMEO code (a specific 2-4 digit action code, e.g.
// "1421" = "Demonstrate or rally for policy change"). The pipeline never
// modelled these ~300 leaf codes -- it only needs enough signal to stop
// starving the relevance/severity/summary prompts of *any* description of
// what actually happened. The 20 CAMEO root categories (the code's first two
// digits) are stable, well-documented, and enough for that: they turn an
// opaque "eventCode: 1421" into "Protest" for the prompt, without needing a
// 300-entry table nor a network call to resolve it.
const CAMEO_ROOT_CATEGORIES = {
  '01': 'Make statement',
  '02': 'Appeal',
  '03': 'Express intent to cooperate',
  '04': 'Consult',
  '05': 'Engage in diplomatic cooperation',
  '06': 'Engage in material cooperation',
  '07': 'Provide aid',
  '08': 'Yield',
  '09': 'Investigate',
  '10': 'Demand',
  '11': 'Disapprove',
  '12': 'Reject',
  '13': 'Threaten',
  '14': 'Protest',
  '15': 'Exhibit military posture',
  '16': 'Reduce relations',
  '17': 'Coerce',
  '18': 'Assault',
  '19': 'Fight',
  '20': 'Engage in unconventional mass violence',
};

// eventCode is a string like "1421" or "042"; the root category is always
// its first two digits, zero-padded.
function describeEventCode(eventCode) {
  if (typeof eventCode !== 'string' || eventCode.length < 2) return null;
  const rootCode = eventCode.slice(0, 2);
  return CAMEO_ROOT_CATEGORIES[rootCode] ?? null;
}

module.exports = { describeEventCode, CAMEO_ROOT_CATEGORIES };
