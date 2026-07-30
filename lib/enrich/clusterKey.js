'use strict';

const crypto = require('node:crypto');

// Deterministic stable id for collapsing many raw GDELT rows about one
// real-world incident onto a single event, without an embedding call on
// every ingest cycle. Buckets location to a coarse grid and date to a
// multi-day window so near-duplicate reports of the same incident collapse
// onto the same id.
const GEO_BUCKET_DEGREES = 0.5;
const DATE_BUCKET_DAYS = 3;

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

function clusterKey({ category, lat, lon, eventDate }) {
  const identity = [
    category,
    bucketCoordinate(lat),
    bucketCoordinate(lon),
    bucketDate(eventDate),
  ].join('|');
  return `evt_${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16)}`;
}

module.exports = { clusterKey, bucketCoordinate, bucketDate };
