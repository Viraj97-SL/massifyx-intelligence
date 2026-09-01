'use strict';

const { parseGdeltEventExport } = require('./parseEvents');
const { withTimeout } = require('../llm/withResilience');

const LASTUPDATE_URL = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';

// Bug fix (2026-09 audit): every LLM call in this service goes through
// withResilience (timeout + retry, lib/llm/withResilience.js), but the GDELT
// fetches here had no timeout at all -- a stalled connection or a server
// that accepts the socket but never responds/finishes the body would hang
// pollOnce() indefinitely. That's not just a slow cycle: lib/scheduler.js's
// poll loop can then start an overlapping cycle on the next tick (see that
// file's fix), and a stuck request keeps a socket (and, transitively, a
// Node.js worker/fetch resource) alive for the life of the process. 30s is
// generous for a "few hundred KB to a few MB" response (see
// MAX_COMPRESSED_BYTES above) on any real network, while still bounding the
// worst case.
const FETCH_TIMEOUT_MS = 30_000;

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
// real zip file — see test/gdelt-ingest.test.js. fetchTimeoutMs is injectable
// too (kept small in tests) so the timeout behaviour itself is testable
// without an actual 30s wait.
async function fetchRecentEvents({ fetchImpl, unzipImpl, fetchTimeoutMs = FETCH_TIMEOUT_MS }) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof unzipImpl !== 'function') throw new Error('unzipImpl is required');

  const lastUpdateRes = await withTimeout(fetchImpl(LASTUPDATE_URL), fetchTimeoutMs);
  if (!lastUpdateRes.ok) {
    throw new Error(`GDELT lastupdate.txt fetch failed: ${lastUpdateRes.status}`);
  }
  const exportUrl = pickExportUrl(await withTimeout(lastUpdateRes.text(), fetchTimeoutMs));
  assertExpectedExportUrl(exportUrl);

  const exportRes = await withTimeout(fetchImpl(exportUrl), fetchTimeoutMs);
  if (!exportRes.ok) {
    throw new Error(`GDELT export fetch failed: ${exportRes.status}`);
  }
  const declaredLength = Number(exportRes.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPRESSED_BYTES) {
    throw new Error(`GDELT export declares ${declaredLength} bytes, over the ${MAX_COMPRESSED_BYTES}-byte cap`);
  }
  const zipBuffer = Buffer.from(await withTimeout(exportRes.arrayBuffer(), fetchTimeoutMs));
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
  FETCH_TIMEOUT_MS,
};
