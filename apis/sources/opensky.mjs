// OpenSky Network — Real-time flight tracking
// Free for research. 4,000 API credits/day (no auth), 8,000 with account.
// Tracks all aircraft with ADS-B transponders including many military.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://opensky-network.org/api';
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const RUNS_DIR = join(ROOT, 'runs');
const CACHE_DIR = join(RUNS_DIR, 'cache');
const CACHE_FILE = join(CACHE_DIR, 'opensky-latest.json');
const STATE_FILE = join(CACHE_DIR, 'opensky-state.json');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const ROTATION_BATCH_SIZE = 4;
const COOLDOWN_MS = 30 * 60 * 1000;

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function hotspotHasAirActivity(hotspots = []) {
  return hotspots.some(h => (h?.totalAircraft || 0) > 0);
}

function readCachedSnapshot() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    const ts = parsed?.timestamp ? new Date(parsed.timestamp).getTime() : NaN;
    if (!Array.isArray(parsed?.hotspots) || !Number.isFinite(ts)) return null;
    return {
      ...parsed,
      ageMinutes: +((Date.now() - ts) / 60000).toFixed(1),
      isExpired: Date.now() - ts > CACHE_MAX_AGE_MS,
    };
  } catch {
    return null;
  }
}

function writeCachedSnapshot(snapshot) {
  try {
    ensureCacheDir();
    writeFileSync(CACHE_FILE, JSON.stringify(snapshot, null, 2));
  } catch {
    // Non-fatal. Continue without persistence.
  }
}

function readRuntimeState() {
  try {
    if (!existsSync(STATE_FILE)) return { cursor: 0, cooldownUntil: null, last429At: null };
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return {
      cursor: Number.isInteger(parsed?.cursor) ? parsed.cursor : 0,
      cooldownUntil: parsed?.cooldownUntil || null,
      last429At: parsed?.last429At || null,
    };
  } catch {
    return { cursor: 0, cooldownUntil: null, last429At: null };
  }
}

function writeRuntimeState(state) {
  try {
    ensureCacheDir();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // Non-fatal. Continue without persistence.
  }
}

function selectHotspotBatch(hotspotEntries, cursor = 0, batchSize = ROTATION_BATCH_SIZE) {
  if (hotspotEntries.length <= batchSize) return { batch: hotspotEntries, nextCursor: 0 };
  const start = ((cursor % hotspotEntries.length) + hotspotEntries.length) % hotspotEntries.length;
  const batch = [];
  for (let i = 0; i < Math.min(batchSize, hotspotEntries.length); i++) {
    batch.push(hotspotEntries[(start + i) % hotspotEntries.length]);
  }
  return { batch, nextCursor: (start + batch.length) % hotspotEntries.length };
}

// Get all current flights (global state vector)
export async function getAllFlights() {
  return safeFetch(`${BASE}/states/all`, { timeout: 30000 });
}

// Get flights in a bounding box (lat/lon)
export async function getFlightsInArea(lamin, lomin, lamax, lomax) {
  const params = new URLSearchParams({
    lamin: String(lamin),
    lomin: String(lomin),
    lamax: String(lamax),
    lomax: String(lomax),
  });
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get flights by specific aircraft (ICAO24 hex codes)
export async function getFlightsByIcao(icao24List) {
  const icao = Array.isArray(icao24List) ? icao24List : [icao24List];
  const params = icao.map(i => `icao24=${i}`).join('&');
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get departures from an airport in a time range
export async function getDepartures(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/departure?${params}`);
}

// Get arrivals at an airport
export async function getArrivals(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/arrival?${params}`);
}

// Key hotspot regions for monitoring
const HOTSPOTS = {
  middleEast: { lamin: 12, lomin: 30, lamax: 42, lomax: 65, label: 'Middle East' },
  taiwan: { lamin: 20, lomin: 115, lamax: 28, lomax: 125, label: 'Taiwan Strait' },
  ukraine: { lamin: 44, lomin: 22, lamax: 53, lomax: 41, label: 'Ukraine Region' },
  baltics: { lamin: 53, lomin: 19, lamax: 60, lomax: 29, label: 'Baltic Region' },
  southChinaSea: { lamin: 5, lomin: 105, lamax: 23, lomax: 122, label: 'South China Sea' },
  koreanPeninsula: { lamin: 33, lomin: 124, lamax: 43, lomax: 132, label: 'Korean Peninsula' },
  caribbean: { lamin: 18, lomin: -90, lamax: 30, lomax: -72, label: 'Caribbean' },
  gulfOfGuinea: { lamin: -2, lomin: -5, lamax: 8, lomax: 10, label: 'Gulf of Guinea' },
  capeRoute: { lamin: -38, lomin: 12, lamax: -28, lomax: 24, label: 'Cape Route' },
  hornOfAfrica: { lamin: 5, lomin: 40, lamax: 15, lomax: 55, label: 'Horn of Africa' },
};

// Briefing — check hotspot regions for flight activity
export async function briefing() {
  const hotspotEntries = Object.entries(HOTSPOTS);
  const state = readRuntimeState();
  const cached = readCachedSnapshot();
  const cooldownUntilMs = state.cooldownUntil ? new Date(state.cooldownUntil).getTime() : NaN;
  const inCooldown = Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Date.now();

  if (inCooldown && cached && !cached.isExpired && hotspotHasAirActivity(cached.hotspots)) {
    return {
      source: 'OpenSky',
      timestamp: cached.timestamp,
      hotspots: cached.hotspots,
      degraded: true,
      stale: true,
      servedFromCache: true,
      cacheAgeMinutes: cached.ageMinutes,
      cacheFile: CACHE_FILE,
      cooldownUntil: state.cooldownUntil,
      error: `OpenSky cooldown active, serving cached snapshot (${cached.ageMinutes}m old)`,
      liveError: 'cooldown-active',
      queryMode: 'cooldown-cache',
    };
  }

  const { batch: selectedHotspots, nextCursor } = selectHotspotBatch(hotspotEntries, state.cursor);
  const batchResults = await Promise.all(
    selectedHotspots.map(async ([key, box]) => {
      const data = await getFlightsInArea(box.lamin, box.lomin, box.lamax, box.lomax);
      const error = data?.error || null;
      const states = data?.states || [];
      return {
        region: box.label,
        key,
        totalAircraft: states.length,
        byCountry: states.reduce((acc, s) => {
          const country = s[2] || 'Unknown';
          acc[country] = (acc[country] || 0) + 1;
          return acc;
        }, {}),
        noCallsign: states.filter(s => !s[1]?.trim()).length,
        highAltitude: states.filter(s => s[7] && s[7] > 12000).length,
        ...(error ? { error } : {}),
      };
    })
  );

  const batchMap = new Map(batchResults.map(result => [result.key, result]));
  const cachedHotspotMap = new Map((cached?.hotspots || []).map(result => [result.key, result]));
  const mergedResults = hotspotEntries.map(([key, box]) => {
    if (batchMap.has(key)) return batchMap.get(key);
    if (cachedHotspotMap.has(key)) return { ...cachedHotspotMap.get(key), carriedForward: true };
    return {
      region: box.label,
      key,
      totalAircraft: 0,
      byCountry: {},
      noCallsign: 0,
      highAltitude: 0,
      stale: true,
      error: 'Not queried in this rotation and no cached snapshot available',
    };
  });

  const hotspotErrors = batchResults
    .filter(r => r.error)
    .map(r => ({ region: r.region, error: r.error }));

  const saw429 = hotspotErrors.some(r => String(r.error).includes('HTTP 429'));
  const nextState = {
    cursor: nextCursor,
    cooldownUntil: saw429 ? new Date(Date.now() + COOLDOWN_MS).toISOString() : null,
    last429At: saw429 ? new Date().toISOString() : state.last429At,
  };
  writeRuntimeState(nextState);

  const freshSnapshot = {
    source: 'OpenSky',
    timestamp: new Date().toISOString(),
    hotspots: mergedResults,
  };

  if (hotspotHasAirActivity(mergedResults)) {
    writeCachedSnapshot(freshSnapshot);
  }

  if (hotspotErrors.length === batchResults.length && cached && !cached.isExpired && hotspotHasAirActivity(cached.hotspots)) {
    return {
      source: 'OpenSky',
      timestamp: cached.timestamp,
      hotspots: cached.hotspots,
      degraded: true,
      stale: true,
      servedFromCache: true,
      cacheAgeMinutes: cached.ageMinutes,
      cacheFile: CACHE_FILE,
      cooldownUntil: nextState.cooldownUntil,
      error: `OpenSky live batch failed, serving cached snapshot (${cached.ageMinutes}m old): ${hotspotErrors[0].error}`,
      liveError: hotspotErrors[0].error,
      hotspotErrors,
      queryMode: 'rotating-batch-fallback',
      queriedRegions: selectedHotspots.map(([, box]) => box.label),
    };
  }

  return {
    source: 'OpenSky',
    timestamp: freshSnapshot.timestamp,
    hotspots: mergedResults,
    ...(hotspotErrors.length ? {
      error: hotspotErrors.length === batchResults.length
        ? `OpenSky batch unavailable for ${hotspotErrors.length}/${batchResults.length} queried hotspots`
        : `OpenSky partial batch issues for ${hotspotErrors.length}/${batchResults.length} queried hotspots`,
      hotspotErrors,
    } : {}),
    ...(saw429 ? { degraded: true, cooldownUntil: nextState.cooldownUntil, liveError: hotspotErrors.find(r => String(r.error).includes('HTTP 429'))?.error || 'HTTP 429' } : {}),
    queryMode: 'rotating-batch',
    queriedRegions: selectedHotspots.map(([, box]) => box.label),
  };
}

if (process.argv[1]?.endsWith('opensky.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
