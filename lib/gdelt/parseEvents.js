'use strict';

// GDELT 2.0 Event table column indexes (0-based), per the GDELT 2.0 codebook.
// Only the fields MIS actually uses are named; the rest of the 61 columns are
// skipped rather than modeled.
const FIELD = {
  GLOBALEVENTID: 0,
  SQLDATE: 1,
  ACTOR1NAME: 6,
  ACTOR2NAME: 16,
  EVENTCODE: 26,
  GOLDSTEINSCALE: 30,
  NUMMENTIONS: 31,
  NUMSOURCES: 32,
  NUMARTICLES: 33,
  AVGTONE: 34,
  ACTIONGEO_FULLNAME: 52,
  ACTIONGEO_COUNTRYCODE: 53,
  ACTIONGEO_LAT: 56,
  ACTIONGEO_LONG: 57,
  DATEADDED: 59,
  SOURCEURL: 60,
};

const MIN_COLUMN_COUNT = 61;

function parseGdeltEventLine(line) {
  const cols = line.split('\t');
  if (cols.length < MIN_COLUMN_COUNT) return null;

  const globalEventId = cols[FIELD.GLOBALEVENTID];
  if (!globalEventId) return null;

  const lat = Number(cols[FIELD.ACTIONGEO_LAT]);
  const lon = Number(cols[FIELD.ACTIONGEO_LONG]);
  // An unplottable event is useless to the globe — drop it. GDELT emits
  // 0,0 for a handful of geocoding-failure placeholders too.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    return null;
  }

  return {
    gdeltId: globalEventId,
    eventDate: cols[FIELD.SQLDATE],
    actor1: cols[FIELD.ACTOR1NAME] || null,
    actor2: cols[FIELD.ACTOR2NAME] || null,
    eventCode: cols[FIELD.EVENTCODE] || null,
    goldsteinScale: Number(cols[FIELD.GOLDSTEINSCALE]) || 0,
    numMentions: Number(cols[FIELD.NUMMENTIONS]) || 0,
    numSources: Number(cols[FIELD.NUMSOURCES]) || 0,
    numArticles: Number(cols[FIELD.NUMARTICLES]) || 0,
    avgTone: Number(cols[FIELD.AVGTONE]) || 0,
    location: cols[FIELD.ACTIONGEO_FULLNAME] || null,
    countryCode: cols[FIELD.ACTIONGEO_COUNTRYCODE] || null,
    lat,
    lon,
    dateAdded: cols[FIELD.DATEADDED],
    sourceUrl: cols[FIELD.SOURCEURL],
  };
}

function parseGdeltEventExport(rawText) {
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseGdeltEventLine)
    .filter(Boolean);
}

module.exports = { parseGdeltEventLine, parseGdeltEventExport, FIELD };
