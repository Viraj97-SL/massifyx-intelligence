'use strict';

const crypto = require('node:crypto');

// Deterministic stable id for collapsing many raw GDELT rows about one
// real-world incident onto a single event, without an embedding call on
// every ingest cycle. Buckets location to a grid and date to a short window
// so near-duplicate reports of the same incident collapse onto the same id.
//
// Originally 0.5 degrees (~55km) / 3 days, with no actor signal at all --
// coarse enough that two unrelated real stories sharing a region, category,
// and week (a warship deployment and unrelated river-shipping coverage both
// geocoded to "Germany", say) collided onto the same id. Because the store's
// upsert-on-conflict keeps the *first* insert's source_url while overwriting
// title/summary with whichever story lands next (see postgresEventStore.js),
// a collision meant a permanently mismatched source -- the exact production
// bug this tightening (plus the postgresEventStore.js fix) addresses.
// Narrower buckets plus keying on the lead actor make an accidental collision
// between two genuinely different stories much less likely, without needing
// an embedding call.
const GEO_BUCKET_DEGREES = 0.2;
const DATE_BUCKET_DAYS = 2;

function bucketCoordinate(value) {
  return Math.round(value / GEO_BUCKET_DEGREES) * GEO_BUCKET_DEGREES;
}

// sqlDate is GDELT's YYYYMMDD string.
function bucketDate(sqlDate) {
  const year = Number(sqlDate.slice(0, 4));
  const month = Number(sqlDate.slice(4, 6)) - 1;
  const day = Number(sqlDate.slice(6, 8));
  const epochDay = Math.floor(Date.UTC(year, month, day) / 86_400_000);
  return Math.floor(epochDay / DATE_BUCKET_DAYS);
}

// GDELT actor names are noisy (varying whitespace/qualifiers) but the first
// significant word is usually the stable, distinguishing part ("GERMAN RAIL
// WORKERS UNION" vs "GERMANY" vs "GERMAN NAVY") -- exact matching isn't
// needed, just enough to stop two different lead actors from silently
// sharing an id.
function normalizeActorToken(actor) {
  if (typeof actor !== 'string') return '';
  const [firstWord] = actor.trim().toLowerCase().split(/\s+/);
  return firstWord || '';
}

function clusterKey({ category, lat, lon, eventDate, actor1 }) {
  const identity = [
    category,
    bucketCoordinate(lat),
    bucketCoordinate(lon),
    bucketDate(eventDate),
    normalizeActorToken(actor1),
  ].join('|');
  return `evt_${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16)}`;
}

module.exports = { clusterKey, bucketCoordinate, bucketDate, normalizeActorToken };
