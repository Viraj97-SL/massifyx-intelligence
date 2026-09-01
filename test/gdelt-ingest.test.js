'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { fetchRecentEvents, pickExportUrl, assertExpectedExportUrl } = require('../lib/gdelt/ingest');

const fixtureText = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'gdelt-sample-export.csv'),
  'utf8',
);

const LASTUPDATE_BODY = [
  '12345 abc123 https://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip',
  '23456 def456 https://data.gdeltproject.org/gdeltv2/20260728123000.mentions.CSV.zip',
  '34567 ghi789 https://data.gdeltproject.org/gdeltv2/20260728123000.gkg.csv.zip',
].join('\n');

test('pickExportUrl extracts only the .export.CSV.zip line', () => {
  const url = pickExportUrl(LASTUPDATE_BODY);
  assert.equal(url, 'https://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip');
});

test('pickExportUrl throws when no export line is present', () => {
  assert.throws(() => pickExportUrl('nothing here'), /No export CSV URL/);
});

// Regression test for a real production incident (2026-09): GDELT's real
// lastupdate.txt lists the export URL as plain http://, not https://, even
// though the identical path is also served over https on the same host.
// assertExpectedExportUrl requires https, so every real ingestion attempt
// was failing until pickExportUrl started upgrading the scheme itself.
test('pickExportUrl upgrades a real-world http:// listing to https://', () => {
  const body = 'wc12345 abc123 http://data.gdeltproject.org/gdeltv2/20260901111500.export.CSV.zip';
  const url = pickExportUrl(body);
  assert.equal(url, 'https://data.gdeltproject.org/gdeltv2/20260901111500.export.CSV.zip');
  assert.doesNotThrow(() => assertExpectedExportUrl(url));
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
  assert.equal(calledUrls[0], 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt');
  assert.equal(
    calledUrls[1],
    'https://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip',
  );
});

test('fetchRecentEvents succeeds end-to-end when lastupdate.txt lists the export over plain http', async () => {
  const httpBody = LASTUPDATE_BODY.replace(
    'https://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip',
    'http://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip',
  );
  const calledUrls = [];
  const fetchImpl = async (url) => {
    calledUrls.push(url);
    if (url.endsWith('lastupdate.txt')) {
      return { ok: true, text: async () => httpBody };
    }
    return { ok: true, arrayBuffer: async () => Buffer.from('fake-zip-bytes') };
  };
  const unzipImpl = async () => fixtureText;

  const events = await fetchRecentEvents({ fetchImpl, unzipImpl });

  assert.equal(events.length, 2);
  // The actual second fetch always happens over https, regardless of the
  // scheme lastupdate.txt declared.
  assert.equal(
    calledUrls[1],
    'https://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip',
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

test('assertExpectedExportUrl accepts the real GDELT host over https', () => {
  assert.doesNotThrow(() =>
    assertExpectedExportUrl('https://data.gdeltproject.org/gdeltv2/20260728123000.export.CSV.zip'),
  );
});

test('assertExpectedExportUrl rejects a plain-http URL (SSRF/integrity guard)', () => {
  assert.throws(
    () => assertExpectedExportUrl('http://data.gdeltproject.org/gdeltv2/x.export.CSV.zip'),
    /host\/scheme allow-list/,
  );
});

test('assertExpectedExportUrl rejects a URL pointing at an unexpected host', () => {
  assert.throws(
    () => assertExpectedExportUrl('https://attacker.example/gdeltv2/x.export.CSV.zip'),
    /host\/scheme allow-list/,
  );
});

test('fetchRecentEvents refuses to fetch an export URL that fails the allow-list', async () => {
  const poisonedBody = LASTUPDATE_BODY.replace(
    'https://data.gdeltproject.org',
    'https://attacker.example',
  );
  const fetchImpl = async (url) => {
    if (url.endsWith('lastupdate.txt')) {
      return { ok: true, text: async () => poisonedBody };
    }
    throw new Error('should never fetch the export URL once the allow-list check fails');
  };
  await assert.rejects(
    fetchRecentEvents({ fetchImpl, unzipImpl: async () => '' }),
    /host\/scheme allow-list/,
  );
});

// Regression test (2026-09 audit): unlike every LLM call (lib/llm/withResilience.js),
// the GDELT fetches here previously had no timeout at all -- a stalled
// connection (server accepts the socket but never responds) would hang
// pollOnce() forever. That's a resource leak on its own, and combined with
// lib/scheduler.js's poll loop, a hang past one poll interval used to let a
// second overlapping ingest cycle start on top of the stuck one. fetchImpl
// here returns a promise that never settles, standing in for that stall;
// fetchTimeoutMs is passed small so the test doesn't wait for the real 30s
// default.
test('fetchRecentEvents rejects instead of hanging forever when the export fetch stalls', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('lastupdate.txt')) {
      return { ok: true, text: async () => LASTUPDATE_BODY };
    }
    return new Promise(() => {}); // never resolves -- simulates a stalled connection
  };
  await assert.rejects(
    fetchRecentEvents({ fetchImpl, unzipImpl: async () => '', fetchTimeoutMs: 20 }),
    /timed out after 20ms/,
  );
});

test('fetchRecentEvents rejects instead of hanging forever when lastupdate.txt itself stalls', async () => {
  const fetchImpl = async () => new Promise(() => {}); // never resolves
  await assert.rejects(
    fetchRecentEvents({ fetchImpl, unzipImpl: async () => '', fetchTimeoutMs: 20 }),
    /timed out after 20ms/,
  );
});

// Resilience case: a corrupted/truncated download or a broken unzip
// implementation handing back noise instead of the expected tab-separated
// CSV. parseGdeltEventExport (lib/gdelt/parseEvents.js) already drops any
// line with too few columns -- this proves that end-to-end through
// fetchRecentEvents, i.e. garbage in yields an empty, safely-ignorable
// result rather than a thrown exception that would crash a poll cycle.
test('fetchRecentEvents returns an empty list, not a crash, when unzipImpl returns non-CSV garbage', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('lastupdate.txt')) {
      return { ok: true, text: async () => LASTUPDATE_BODY };
    }
    return { ok: true, arrayBuffer: async () => Buffer.from('irrelevant') };
  };
  const unzipImpl = async () => '### not a valid tab-separated GDELT export row at all ###';

  const events = await fetchRecentEvents({ fetchImpl, unzipImpl });
  assert.deepEqual(events, []);
});
