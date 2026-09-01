'use strict';

const { parseGdeltEventExport } = require('./parseEvents');

const LASTUPDATE_URL = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';

// The only host + path shape ever legitimately fetched here. lastupdate.txt
// itself is fetched over plain trusted config above, but the export URL
// *inside* it is attacker-influenceable if that feed is ever
// compromised/MITM'd (it also used to be served over http, which had no
// integrity protection at all) -- validating it before the second fetch
// means a poisoned feed can point us at a bogus filename, not an arbitrary
// internal/external URL (SSRF).
const EXPECTED_EXPORT_HOST = 'data.gdeltproject.org';

// Real GDELT zip exports are a few hundred KB to a few MB; refusing
// anything past 50 MB compressed bounds both the memory of the buffered
// download and (indirectly) the CPU cost of decompressing it -- see
// unzip.js's MAX_UNCOMPRESSED_BYTES for the second half of that guard.
const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;

// lastupdate.txt has three lines (export, mentions, gkg), each
// "<size> <md5> <url>". We only want the event export.
//
// GDELT's own listing gives this URL as plain http:// (confirmed live,
// 2026-09) even though the identical path is also served over https on the
// same host. Trusting whatever scheme the feed happens to declare would
// defeat assertExpectedExportUrl's transport-integrity intent below if that
// feed were ever compromised/MITM'd, so the scheme is always upgraded here
// rather than passed through -- the host allow-list still rejects anything
// not on data.gdeltproject.org, and the fetch itself always happens over an
// encrypted connection regardless of what lastupdate.txt says.
function upgradeToHttps(url) {
  return url.replace(/^http:\/\//, 'https://');
}

function pickExportUrl(lastUpdateText) {
  const line = lastUpdateText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.includes('.export.CSV.zip'));
  if (!line) {
    throw new Error('No export CSV URL found in GDELT lastupdate.txt');
  }
  return upgradeToHttps(line.split(' ').pop());
}

function assertExpectedExportUrl(exportUrl) {
  let parsed;
  try {
    parsed = new URL(exportUrl);
  } catch {
    throw new Error(`GDELT export URL is not a valid URL: ${exportUrl}`);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== EXPECTED_EXPORT_HOST) {
    throw new Error(`GDELT export URL failed the host/scheme allow-list: ${exportUrl}`);
  }
}

// fetchImpl/unzipImpl are injected so tests never touch the network or a
// real zip file — see test/gdelt-ingest.test.js.
async function fetchRecentEvents({ fetchImpl, unzipImpl }) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof unzipImpl !== 'function') throw new Error('unzipImpl is required');

  const lastUpdateRes = await fetchImpl(LASTUPDATE_URL);
  if (!lastUpdateRes.ok) {
    throw new Error(`GDELT lastupdate.txt fetch failed: ${lastUpdateRes.status}`);
  }
  const exportUrl = pickExportUrl(await lastUpdateRes.text());
  assertExpectedExportUrl(exportUrl);

  const exportRes = await fetchImpl(exportUrl);
  if (!exportRes.ok) {
    throw new Error(`GDELT export fetch failed: ${exportRes.status}`);
  }
  const declaredLength = Number(exportRes.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPRESSED_BYTES) {
    throw new Error(`GDELT export declares ${declaredLength} bytes, over the ${MAX_COMPRESSED_BYTES}-byte cap`);
  }
  const zipBuffer = Buffer.from(await exportRes.arrayBuffer());
  if (zipBuffer.length > MAX_COMPRESSED_BYTES) {
    throw new Error(`GDELT export body is ${zipBuffer.length} bytes, over the ${MAX_COMPRESSED_BYTES}-byte cap`);
  }
  const csvText = await unzipImpl(zipBuffer);

  return parseGdeltEventExport(csvText);
}

module.exports = {
  fetchRecentEvents,
  pickExportUrl,
  assertExpectedExportUrl,
  LASTUPDATE_URL,
  MAX_COMPRESSED_BYTES,
};
