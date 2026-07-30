'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { fetchRecentEvents, pickExportUrl } = require('../lib/gdelt/ingest');

const fixtureText = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'gdelt-sample-export.csv'),
  'utf8',
);

const LASTUPDATE_BODY = [
  '12345 abc123 http://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip',
  '23456 def456 http://data.gdeltproject.org/gdeltv2/20260728123000.mentions.CSV.zip',
  '34567 ghi789 http://data.gdeltproject.org/gdeltv2/20260728123000.gkg.csv.zip',
].join('\n');

test('pickExportUrl extracts only the .export.CSV.zip line', () => {
  const url = pickExportUrl(LASTUPDATE_BODY);
  assert.equal(url, 'http://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip');
});

test('pickExportUrl throws when no export line is present', () => {
  assert.throws(() => pickExportUrl('nothing here'), /No export CSV URL/);
});

test('fetchRecentEvents never touches the network — fetch/unzip are fully injected', async () => {
  const calledUrls = [];
  const fetchImpl = async (url) => {
    calledUrls.push(url);
    if (url.endsWith('lastupdate.txt')) {
      return { ok: true, text: async () => LASTUPDATE_BODY };
    }
    return { ok: true, arrayBuffer: async () => Buffer.from('fake-zip-bytes') };
  };
  const unzipImpl = async () => fixtureText;

  const events = await fetchRecentEvents({ fetchImpl, unzipImpl });

  assert.equal(events.length, 2);
  assert.equal(calledUrls[0], 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt');
  assert.equal(
    calledUrls[1],
    'http://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip',
  );
});

test('fetchRecentEvents surfaces a clear error when lastupdate.txt fetch fails', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    fetchRecentEvents({ fetchImpl, unzipImpl: async () => '' }),
    /lastupdate\.txt fetch failed: 503/,
  );
});

test('fetchRecentEvents surfaces a clear error when the export fetch fails', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('lastupdate.txt')) {
      return { ok: true, text: async () => LASTUPDATE_BODY };
    }
    return { ok: false, status: 500 };
  };
  await assert.rejects(
    fetchRecentEvents({ fetchImpl, unzipImpl: async () => '' }),
    /export fetch failed: 500/,
  );
});
