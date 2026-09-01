'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const CACHE_MAX_AGE_SECONDS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

// Fields the API contract exposes (DESIGN.md §4). relevanceScore and
// rawRefs are internal-only (§5) and must never cross this boundary.
const PUBLIC_FIELDS = [
  'id', 'title', 'summary', 'category', 'severity',
  'lat', 'lon', 'location', 'sourceCount',
  'firstSeenAt', 'lastUpdatedAt', 'sourceUrl', 'eventDate',
];

function toPublicEvent(event) {
  const publicEvent = {};
  for (const field of PUBLIC_FIELDS) {
    publicEvent[field] = event[field];
  }
  return publicEvent;
}

function parseQueryFilters(query) {
  const filters = { limit: DEFAULT_LIMIT };

  const severity = Number.parseInt(query.severity, 10);
  if (Number.isFinite(severity)) filters.minSeverity = severity;

  if (query.since) {
    const since = new Date(query.since);
    if (!Number.isNaN(since.getTime())) filters.since = since;
  }

  if (query.category) filters.category = String(query.category);

  const limit = Number.parseInt(query.limit, 10);
  if (Number.isFinite(limit)) filters.limit = Math.min(MAX_LIMIT, Math.max(1, limit));

  return filters;
}

const VESSEL_CACHE_MAX_AGE_SECONDS = 10;

function toPublicVessel(vessel) {
  return {
    mmsi: vessel.mmsi,
    shipName: vessel.shipName,
    lat: vessel.lat,
    lon: vessel.lon,
    headingDeg: vessel.headingDeg,
    speedKnots: vessel.speedKnots,
    lastUpdatedAt: vessel.lastUpdatedAt,
  };
}

// getHealthInfo() => { lastIngestAt: string|null }, injected so this module
// never needs to know how ingest state is tracked. vesselStore is optional
// (only present once AISSTREAM_API_KEY is configured) -- /api/v1/vessels
// returns an empty list rather than 404/500 when it's absent, same
// graceful-degradation posture as the rest of this API.
function createApp({ store, getHealthInfo, vesselStore }) {
  const app = express();
  app.disable('x-powered-by');
  // This service is deployed behind Railway's edge proxy (one hop) --
  // without this, req.ip always resolves to that proxy's own address, so
  // express-rate-limit below would see every caller as the same client
  // (either one bad actor throttles everyone, or nobody is ever
  // individually throttled, depending on which requests land first).
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(compression());

  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  app.get('/api/v1/health', async (req, res, next) => {
    try {
      const eventCount = await store.countAll();
      const { lastIngestAt } = getHealthInfo ? getHealthInfo() : { lastIngestAt: null };
      res.set('Cache-Control', 'no-store');
      res.json({ status: 'ok', lastIngestAt: lastIngestAt ?? null, eventCount });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/v1/disruptions', async (req, res, next) => {
    try {
      const filters = parseQueryFilters(req.query);
      // Filtering/limit is pushed into the store (SQL WHERE/LIMIT for
      // Postgres) rather than fetched-then-filtered here, so table growth
      // never means fetching every row for every request.
      const filtered = await store.listAll(filters);
      res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SECONDS}`);
      res.json({
        generatedAt: new Date().toISOString(),
        count: filtered.length,
        events: filtered.map(toPublicEvent),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/v1/vessels', (req, res, next) => {
    try {
      const vessels = vesselStore ? vesselStore.listAll() : [];
      res.set('Cache-Control', `public, max-age=${VESSEL_CACHE_MAX_AGE_SECONDS}`);
      res.json({
        generatedAt: new Date().toISOString(),
        available: Boolean(vesselStore),
        count: vessels.length,
        vessels: vessels.map(toPublicVessel),
      });
    } catch (err) {
      next(err);
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[MIS] API error:', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp, toPublicEvent, parseQueryFilters, PUBLIC_FIELDS };
