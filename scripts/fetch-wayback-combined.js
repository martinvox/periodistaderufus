const fs = require('fs');
const https = require('https');
const path = require('path');

const USERNAME = process.env.TWITTER_USERNAME || 'PeriodistaRufus';
const WAYBACK_BASE = 'https://web.archive.org/web';
const WAYBACK_HOST = 'https://web.archive.org';
const OUTPUT = process.env.WAYBACK_OUTPUT || path.join(__dirname, '..', 'periodistarufus_wayback_combined.json');
const DELAY_MS = Number(process.env.WAYBACK_DELAY_MS || 4000);
const RETRIES = Number(process.env.WAYBACK_RETRIES || 3);
const DISCOVERY_RETRIES = Number(process.env.WAYBACK_DISCOVERY_RETRIES || 1);
const TIMEOUT_MS = Number(process.env.WAYBACK_TIMEOUT_MS || 30000);
const LIMIT = Number(process.env.WAYBACK_LIMIT || 0);
const SKIP_CDX = process.env.WAYBACK_SKIP_CDX === '1';
const COOLDOWN_BASE_MS = Number(process.env.WAYBACK_COOLDOWN_MS || 60000);
const MAX_COOLDOWN_ATTEMPTS = Number(process.env.WAYBACK_MAX_COOLDOWN || 3);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(base) {
  return base + Math.floor(Math.random() * 2000);
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PeriodistaRufus-Archive/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        res.resume();
        requestText(redirectUrl).then(resolve, reject);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error('Timeout'));
    });
  });
}

class ConnectionThrottled extends Error {
  constructor(attempt) {
    super(`ECONNREFUSED after ${attempt} cooldown attempts`);
    this.name = 'ConnectionThrottled';
  }
}

async function requestWithRetries(url, retries = RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await requestText(url);
      if (![429, 503, 504].includes(response.statusCode)) return response;
      lastError = new Error(`HTTP ${response.statusCode}`);
      lastError.statusCode = response.statusCode;
    } catch (error) {
      lastError = error;
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        throw error;
      }
    }

    if (attempt < retries) {
      const waitMs = 1000 * 2 ** attempt;
      console.warn(`  Retry ${attempt + 1}/${retries} in ${waitMs}ms: ${lastError.message}`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function requestWithCooldown(url) {
  for (let cooldown = 0; cooldown < MAX_COOLDOWN_ATTEMPTS; cooldown += 1) {
    try {
      return await requestWithRetries(url);
    } catch (error) {
      if (error.code !== 'ECONNREFUSED' && error.code !== 'ECONNRESET' && error.code !== 'ETIMEDOUT') {
        throw error;
      }
      const waitMs = COOLDOWN_BASE_MS * (2 ** cooldown);
      console.warn(`  Connection refused (attempt ${cooldown + 1}/${MAX_COOLDOWN_ATTEMPTS}), waiting ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }
  }
  throw new ConnectionThrottled(MAX_COOLDOWN_ATTEMPTS);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeOriginal(value) {
  const cleaned = decodeHtml(value).replace(/\\\//g, '/').replace(/^https?:\/\/web\.archive\.org/, '');
  try {
    return decodeURIComponent(cleaned);
  } catch {
    return cleaned;
  }
}

function parseCdxRows(jsonText, source) {
  let rows;
  try {
    rows = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const header = Array.isArray(rows[0]) ? rows[0] : [];
  const timestampIndex = header.indexOf('timestamp');
  const originalIndex = header.indexOf('original');
  const statusIndex = header.indexOf('statuscode');
  const mimetypeIndex = header.indexOf('mimetype');
  const digestIndex = header.indexOf('digest');
  const dataRows = timestampIndex >= 0 && originalIndex >= 0 ? rows.slice(1) : rows;

  return dataRows
    .map((row) => {
      const entry = {
        timestamp: Array.isArray(row) ? row[timestampIndex >= 0 ? timestampIndex : 0] : row.timestamp,
        original: Array.isArray(row) ? row[originalIndex >= 0 ? originalIndex : 1] : row.original,
        source,
      };
      if (Array.isArray(row)) {
        if (statusIndex >= 0) entry.statuscode = row[statusIndex];
        if (mimetypeIndex >= 0) entry.mimetype = row[mimetypeIndex];
        if (digestIndex >= 0) entry.digest = row[digestIndex];
      } else {
        if (row.statuscode) entry.statuscode = row.statuscode;
        if (row.mimetype) entry.mimetype = row.mimetype;
        if (row.digest) entry.digest = row.digest;
      }
      return entry;
    })
    .filter((row) => row.timestamp && row.original);
}

async function fetchCdx(prefix) {
  const params = new URLSearchParams({
    url: prefix,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype,digest',
    collapse: 'urlkey',
    limit: '100000',
  });
  params.append('filter', 'statuscode:200');
  params.append('filter', 'mimetype:text/html');
  const url = `${WAYBACK_HOST}/cdx/search/cdx?${params.toString()}`;
  const response = await requestWithRetries(url, DISCOVERY_RETRIES);
  if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode} for ${url}`);
  return parseCdxRows(response.text, 'cdx');
}

async function fetchTimemap(prefix) {
  const params = new URLSearchParams({
    url: prefix,
    fl: 'timestamp,original',
    matchType: 'prefix',
    collapse: 'urlkey',
    limit: '100000',
  });
  const url = `${WAYBACK_BASE}/timemap/json?${params.toString()}`;
  const response = await requestWithRetries(url, DISCOVERY_RETRIES);
  if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode} for ${url}`);
  return parseCdxRows(response.text, 'timemap');
}

async function discoverCaptures() {
  const prefixes = [
    `twitter.com/${USERNAME}/*`,
    `twitter.com/${USERNAME}/status/*`,
    `https://twitter.com/${USERNAME}/`,
    `https://twitter.com/${USERNAME}/status/`,
    `https://mobile.twitter.com/${USERNAME}/`,
    `https://x.com/${USERNAME}/`,
  ];
  const captures = [];

  if (!SKIP_CDX) {
    for (const prefix of prefixes) {
      console.log(`Discovering CDX captures: ${prefix}`);
      try {
        captures.push(...await fetchCdx(prefix));
      } catch (error) {
        console.warn(`  CDX failed: ${error.message}`);
      }
      await sleep(500);
    }
  }

  for (const prefix of prefixes.slice(2)) {
    console.log(`Discovering Timemap captures: ${prefix}`);
    try {
      captures.push(...await fetchTimemap(prefix));
    } catch (error) {
      console.warn(`  Timemap failed: ${error.message}`);
    }
    await sleep(500);
  }

  return captures;
}

function extractTweetTargets(captures) {
  const byId = new Map();
  for (const capture of captures) {
    const original = normalizeOriginal(capture.original);
    let parsed;
    try {
      parsed = new URL(original.startsWith('http') ? original : `https://${original}`);
    } catch {
      continue;
    }

    const host = parsed.hostname.toLowerCase();
    if (!['twitter.com', 'mobile.twitter.com', 'x.com'].includes(host)) continue;

    const match = parsed.pathname.match(/\/status(?:es)?\/(\d+)/);
    if (!match) continue;
    if (/\/(photo|video)\//.test(parsed.pathname)) continue;

    if (capture.statuscode && String(capture.statuscode) !== '200') continue;

    const id = match[1];
    const previous = byId.get(id);
    if (!previous || capture.timestamp > previous.timestamp) {
      byId.set(id, { id, timestamp: capture.timestamp, original });
    }
  }

  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function extractIframeJson(html) {
  const scripts = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scripts.exec(html)) !== null) {
    const scriptContent = match[1];
    const jsonMatch = /\/\/\s*console\.log\(\s*(\{[\s\S]*?\})\s*\)\s*;/.exec(scriptContent);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function fetchSnapshot(target) {
  const urlId = `${WAYBACK_BASE}/${target.timestamp}id_/${target.original}`;
  let response;
  try {
    response = await requestWithCooldown(urlId);
  } catch (error) {
    if (error instanceof ConnectionThrottled) {
      throw error;
    }
    return {
      ts: target.timestamp,
      original: target.original,
      status: error.statusCode || 0,
      error: error.message,
    };
  }

  const item = {
    ts: target.timestamp,
    original: target.original,
    status: response.statusCode,
  };

  if (response.statusCode !== 200) {
    item.error = `HTTP ${response.statusCode}`;
    return item;
  }

  try {
    item.body = JSON.parse(response.text);
    return item;
  } catch {}

  const iframeJson = extractIframeJson(response.text);
  if (iframeJson) {
    item.body = iframeJson;
    item.source = 'iframe';
    return item;
  }

  const urlIf = `${WAYBACK_BASE}/${target.timestamp}if_/${target.original}`;
  try {
    const iframeResponse = await requestWithCooldown(urlIf);
    if (iframeResponse.statusCode === 200) {
      const iframeJsonExtracted = extractIframeJson(iframeResponse.text);
      if (iframeJsonExtracted) {
        item.body = iframeJsonExtracted;
        item.source = 'iframe_fallback';
        return item;
      }
    }
  } catch (error) {
    if (error instanceof ConnectionThrottled) {
      throw error;
    }
    console.warn(`  if_ fallback failed for ${target.id}: ${error.message}`);
  }

  item.body_text = response.text;
  return item;
}

function loadExistingOutput() {
  if (!fs.existsSync(OUTPUT)) return null;
  try {
    const raw = fs.readFileSync(OUTPUT, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveOutput(output) {
  const tmp = `${OUTPUT}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(output, null, 2));
  fs.renameSync(tmp, OUTPUT);
}

async function main() {
  const captures = await discoverCaptures();
  let targets = extractTweetTargets(captures);
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  console.log(`Discovered ${captures.length} captures and ${targets.length} unique tweet targets`);
  if (process.env.WAYBACK_DISCOVER_ONLY === '1') {
    console.log(JSON.stringify(targets.slice(0, 20), null, 2));
    return;
  }
  if (!targets.length) throw new Error('No tweet targets discovered; refusing to overwrite output');

  const existing = loadExistingOutput();
  const items = existing ? { ...(existing.items || {}) } : {};
  const doneIds = new Set(Object.keys(items));
  const remaining = targets.filter((t) => !doneIds.has(t.id));
  const skipped = targets.length - remaining.length;

  if (skipped > 0) {
    console.log(`Resuming: ${skipped} already fetched, ${remaining.length} remaining`);
  }

  if (!remaining.length) {
    console.log('All targets already fetched, nothing to do');
  }

  for (let i = 0; i < remaining.length; i += 1) {
    const target = remaining[i];
    const progress = `[${skipped + i + 1}/${targets.length}]`;
    console.log(`${progress} Fetching ${target.id} (${target.timestamp})`);

    try {
      const result = await fetchSnapshot(target);
      items[target.id] = result;
    } catch (error) {
      if (error instanceof ConnectionThrottled) {
        console.error(`\nConnection throttled after ${MAX_COOLDOWN_ATTEMPTS} cooldown attempts.`);
        console.error('Saving progress and exiting. Re-run to continue from where we left off.');
        break;
      }
      items[target.id] = {
        ts: target.timestamp,
        original: target.original,
        status: error.statusCode || 0,
        error: error.message,
      };
    }
    doneIds.add(target.id);

    if ((i + 1) % 5 === 0 || i === remaining.length - 1) {
      saveOutput({
        source: `wayback CDX/Timemap twitter.com/${USERNAME}/*`,
        generated_at: new Date().toISOString(),
        total_targeted: targets.length,
        ok: Object.values(items).filter((v) => v.status === 200 && v.body).length,
        err: Object.values(items).filter((v) => v.status !== 200 || v.error).length,
        items,
      });
      console.log(`  Saved progress (${i + 1}/${remaining.length} this run)`);
    }

    if (i < remaining.length - 1) {
      await sleep(jitterMs(DELAY_MS));
    }
  }

  const ok = Object.values(items).filter((v) => v.status === 200 && v.body).length;
  const finalOutput = {
    source: `wayback CDX/Timemap twitter.com/${USERNAME}/*`,
    generated_at: new Date().toISOString(),
    total_targeted: targets.length,
    ok,
    err: targets.length - ok,
    items,
  };

  saveOutput(finalOutput);
  console.log(`Saved ${ok}/${targets.length} snapshots to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});