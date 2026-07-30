'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseGdeltEventExport } = require('../lib/gdelt/parseEvents');

const fixturePath = path.join(__dirname, 'fixtures', 'gdelt-sample-export.csv');
const fixtureText = fs.readFileSync(fixturePath, 'utf8');

test('parses valid geolocated events from a GDELT export fixture', () => {
  const events = parseGdeltEventExport(fixtureText);

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.gdeltId),
    ['1001127001', '1001127002'],
  );
});

test('drops events with missing lat/lon', () => {
  const events = parseGdeltEventExport(fixtureText);
  assert.ok(!events.some((e) => e.gdeltId === '1001127003'));
});

test('drops events at the 0,0 geocode-failure placeholder', () => {
  const events = parseGdeltEventExport(fixtureText);
  assert.ok(!events.some((e) => e.gdeltId === '1001127004'));
});

test('maps GDELT columns onto the expected candidate-event shape', () => {
  const [rotterdam] = parseGdeltEventExport(fixtureText);

  assert.deepEqual(rotterdam, {
    gdeltId: '1001127001',
    eventDate: '20260728',
    actor1: 'ROTTERDAM PORT AUTHORITY',
    actor2: 'DOCKWORKERS UNION',
    eventCode: '145',
    goldsteinScale: -4.5,
    numMentions: 38,
    numSources: 12,
    numArticles: 20,
    avgTone: -3.2,
    location: 'Rotterdam, Zuid-Holland, Netherlands',
    countryCode: 'NL',
    lat: 51.9225,
    lon: 4.47917,
    dateAdded: '20260728120000',
    sourceUrl: 'https://example.com/rotterdam-strike',
  });
});

test('ignores malformed lines with too few columns', () => {
  const events = parseGdeltEventExport('a\tb\tc\n');
  assert.equal(events.length, 0);
});
