// Space — Satellite Activity Monitoring
// Tracks: recent launches, space stations, military satellites, mega-constellations.
//
// Providers, tried in order for each group when the cache is stale:
//   1. CelesTrak (no key)
//   2. Space-Track.org (free account: SPACETRACK_USER / SPACETRACK_PASSWORD) — CelesTrak's own upstream
//   3. tle.ivanstanojevic.me (no key) — stations and constellation counts only
//   4. the stale cached copy
// Every result is cached on disk for 2 hours: CelesTrak firewalls IPs that re-download
// a group more often than that, and Space-Track asks for GP queries at most hourly.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { safeFetch } from '../utils/fetch.mjs';

const CELESTRAK_BASE = 'https://celestrak.org';
const SPACETRACK_BASE = 'https://www.space-track.org';
const TLE_API_BASE = 'https://tle.ivanstanojevic.me/api/tle';

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CELESTRAK_BACKOFF_MS = 30 * 60 * 1000; // after a failure, skip CelesTrak for a while
const CELESTRAK_TIMEOUT_MS = 8000;           // the whole chain must fit the 30s source budget
const SPACETRACK_TIMEOUT_MS = 8000;
const TLE_API_TIMEOUT_MS = 6000;
const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../runs/cache/celestrak', import.meta.url));
const cacheDir = () => process.env.CELESTRAK_CACHE_DIR || DEFAULT_CACHE_DIR;

let staleGroups = new Set();
let groupProviders = {};
let celestrakDownUntil = 0;
let spaceTrackSession = null; // Promise<cookie|null>, shared by the parallel group fetches

const EARTH_RADIUS_KM = 6378.137;
const MU_KM3_S2 = 398600.4418;

// Satellite groups: CelesTrak path, Space-Track query, and the keyless fallback (if any)
const SAT_CATEGORIES = {
  stations: {
    celestrak: '/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
    spaceTrack: '/basicspacedata/query/class/gp/NORAD_CAT_ID/25544,48274/format/json',
    tleApi: { ids: [25544, 48274] }, // ISS, Tiangong (CSS)
  },
  lastDay: {
    celestrak: '/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json',
    spaceTrack: '/basicspacedata/query/class/gp/LAUNCH_DATE/%3Enow-30/DECAY_DATE/null-val/orderby/LAUNCH_DATE%20desc/limit/2000/format/json',
  },
  military: {
    // CelesTrak's hand-curated military group has no Space-Track equivalent
    celestrak: '/NORAD/elements/gp.php?GROUP=military&FORMAT=json',
  },
  starlink: {
    celestrak: '/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json',
    spaceTrack: '/basicspacedata/query/class/gp/OBJECT_NAME/STARLINK~~/DECAY_DATE/null-val/predicates/NORAD_CAT_ID/format/json',
    tleApi: { search: 'STARLINK' },
  },
  oneweb: {
    celestrak: '/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=json',
    spaceTrack: '/basicspacedata/query/class/gp/OBJECT_NAME/ONEWEB~~/DECAY_DATE/null-val/predicates/NORAD_CAT_ID/format/json',
    tleApi: { search: 'ONEWEB' },
  },
};

// An array of records, or { count } for providers that only report totals
const usable = data => Array.isArray(data) || Number.isFinite(data?.count);

function readCache(category) {
  try { return JSON.parse(readFileSync(join(cacheDir(), `${category}.json`), 'utf8')); } catch { return null; }
}

function writeCache(category, data, provider) {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const file = join(cacheDir(), `${category}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ fetchedAt: Date.now(), provider, data }));
    renameSync(`${file}.tmp`, file);
  } catch (e) {
    console.error(`[Space] Could not cache ${category}:`, e.message);
  }
}

async function fromCelesTrak(path) {
  if (Date.now() < celestrakDownUntil) return { error: 'CelesTrak skipped after a recent failure' };
  const data = await safeFetch(`${CELESTRAK_BASE}${path}`, { timeout: CELESTRAK_TIMEOUT_MS, retries: 0 });
  if (Array.isArray(data)) return data;
  celestrakDownUntil = Date.now() + CELESTRAK_BACKOFF_MS;
  // CelesTrak answers refused/duplicate downloads with a plain-text notice, not JSON
  if (data?.rawText) return { error: `CelesTrak: ${data.rawText.trim().slice(0, 160)}` };
  return { error: data?.error || 'Unexpected CelesTrak response' };
}

async function spaceTrackLogin() {
  const identity = process.env.SPACETRACK_USER;
  const password = process.env.SPACETRACK_PASSWORD;
  if (!identity || !password) return null;
  try {
    const res = await fetch(`${SPACETRACK_BASE}/ajaxauth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Crucix/1.0' },
      body: new URLSearchParams({ identity, password }),
      signal: AbortSignal.timeout(SPACETRACK_TIMEOUT_MS),
    });
    const body = await res.text();
    const cookie = (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    if (!res.ok || !cookie || /"Login"\s*:\s*"Failed"/i.test(body)) {
      console.error('[Space] Space-Track login failed — check SPACETRACK_USER / SPACETRACK_PASSWORD');
      return null;
    }
    return cookie;
  } catch (e) {
    console.error('[Space] Space-Track login error:', e.message);
    return null;
  }
}

async function fromSpaceTrack(path) {
  if (!path || !process.env.SPACETRACK_USER || !process.env.SPACETRACK_PASSWORD) return { error: 'Space-Track not configured' };
  spaceTrackSession ||= spaceTrackLogin();
  const cookie = await spaceTrackSession;
  if (!cookie) { spaceTrackSession = null; return { error: 'Space-Track login failed' }; }
  try {
    const res = await fetch(`${SPACETRACK_BASE}${path}`, {
      headers: { Cookie: cookie, 'User-Agent': 'Crucix/1.0' },
      signal: AbortSignal.timeout(SPACETRACK_TIMEOUT_MS),
    });
    if (res.status === 401) { spaceTrackSession = null; return { error: 'Space-Track session expired' }; }
    if (!res.ok) return { error: `Space-Track HTTP ${res.status}` };
    const data = await res.json();
    return Array.isArray(data) ? data : { error: 'Unexpected Space-Track response' };
  } catch (e) {
    return { error: `Space-Track: ${e.message}` };
  }
}

// Minimal OMM-style record from a two-line element set
function recordFromTle({ satelliteId, name, date, line2 }) {
  if (!line2) return null;
  return {
    OBJECT_NAME: name,
    NORAD_CAT_ID: satelliteId,
    EPOCH: date,
    INCLINATION: parseFloat(line2.slice(8, 16)),
    ECCENTRICITY: parseFloat(`0.${line2.slice(26, 33).trim()}`),
    MEAN_MOTION: parseFloat(line2.slice(52, 63)),
  };
}

async function fromTleApi(spec) {
  if (!spec) return { error: 'No keyless fallback for this group' };
  if (spec.search) {
    const data = await safeFetch(`${TLE_API_BASE}/?search=${encodeURIComponent(spec.search)}&page-size=1`, { timeout: TLE_API_TIMEOUT_MS, retries: 0 });
    return Number.isFinite(data?.totalItems) ? { count: data.totalItems } : { error: data?.error || 'Unexpected TLE API response' };
  }
  const results = await Promise.all(spec.ids.map(id => safeFetch(`${TLE_API_BASE}/${id}`, { timeout: TLE_API_TIMEOUT_MS, retries: 0 })));
  const records = results.map(r => (r?.error ? null : recordFromTle(r))).filter(Boolean);
  return records.length ? records : { error: results.find(r => r?.error)?.error || 'No TLE data' };
}

/**
 * Satellite records for a group, from the first provider that answers (cached, see CACHE_TTL_MS).
 * Returns an array of OMM-style records, { count } from count-only providers, or { error }.
 */
export async function getTLEs(category) {
  const spec = SAT_CATEGORIES[category];
  if (!spec) return { error: 'Invalid category' };

  const cached = readCache(category);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && usable(cached.data)) {
    groupProviders[category] = cached.provider || 'celestrak';
    return cached.data;
  }

  const errors = [];
  for (const [provider, fetchGroup] of [
    ['celestrak', () => fromCelesTrak(spec.celestrak)],
    ['space-track', () => fromSpaceTrack(spec.spaceTrack)],
    ['tle-api', () => fromTleApi(spec.tleApi)],
  ]) {
    const data = await fetchGroup();
    if (usable(data)) {
      writeCache(category, data, provider);
      groupProviders[category] = provider;
      return data;
    }
    errors.push(data?.error);
  }

  if (cached && usable(cached.data)) {
    staleGroups.add(category);
    groupProviders[category] = `${cached.provider || 'celestrak'} (cached)`;
    return cached.data;
  }
  return { error: errors.find(e => e && !/not configured|No keyless|skipped/.test(e)) || errors[0] || 'No satellite data available' };
}

const num = v => (v === null || v === undefined || v === '' ? undefined : Number(v));

// Fill orbit fields some providers omit (CelesTrak's JSON has no apogee/perigee/period)
export function withOrbit(sat) {
  const meanMotion = num(sat.MEAN_MOTION); // revolutions per day
  const ecc = num(sat.ECCENTRICITY) ?? 0;
  let apogee = num(sat.APOAPSIS), perigee = num(sat.PERIAPSIS), period = num(sat.PERIOD);
  if (meanMotion > 0) {
    const n = (meanMotion * 2 * Math.PI) / 86400;          // rad/s
    const a = Math.cbrt(MU_KM3_S2 / (n * n));              // semi-major axis, km
    apogee ??= +(a * (1 + ecc) - EARTH_RADIUS_KM).toFixed(1);
    perigee ??= +(a * (1 - ecc) - EARTH_RADIUS_KM).toFixed(1);
    period ??= +(1440 / meanMotion).toFixed(2);
  }
  return { ...sat, APOAPSIS: apogee, PERIAPSIS: perigee, PERIOD: period, INCLINATION: num(sat.INCLINATION), NORAD_CAT_ID: num(sat.NORAD_CAT_ID) };
}

// Get recent launches (from last 30 days TLEs)
async function getRecentLaunches() {
  const data = await getTLEs('lastDay');
  if (data.error || !Array.isArray(data)) {
    return { error: data.error || 'Failed to fetch launch data' };
  }

  const launches = data.map(withOrbit).map(sat => ({
    name: sat.OBJECT_NAME,
    noradId: sat.NORAD_CAT_ID,
    classification: sat.CLASSIFICATION_TYPE,
    launchDate: sat.LAUNCH_DATE,
    decayDate: sat.DECAY_DATE,
    period: sat.PERIOD,
    inclination: sat.INCLINATION,
    apogee: sat.APOAPSIS,
    perigee: sat.PERIAPSIS,
    epoch: sat.EPOCH,
    country: sat.COUNTRY_CODE,
    objectType: sat.OBJECT_TYPE,
  })).filter(s => s.name && s.noradId);

  launches.sort((a, b) => new Date(b.epoch || 0) - new Date(a.epoch || 0));

  const byCountry = {};
  launches.forEach(l => {
    const country = l.country || 'UNK';
    byCountry[country] = (byCountry[country] || 0) + 1;
  });

  return { totalObjects: launches.length, recentLaunches: launches.slice(0, 25), byCountry };
}

// Get space station data
async function getStationData() {
  const data = await getTLEs('stations');
  if (data.error || !Array.isArray(data)) {
    return { error: data.error || 'Failed to fetch station data' };
  }

  const stations = data.map(withOrbit).map(sat => ({
    name: sat.OBJECT_NAME,
    noradId: sat.NORAD_CAT_ID,
    apogee: sat.APOAPSIS,
    perigee: sat.PERIAPSIS,
    inclination: sat.INCLINATION,
    period: sat.PERIOD,
    epoch: sat.EPOCH,
  })).filter(s => s.name);

  const iss = stations.find(s => s.name.includes('ISS') || s.noradId === 25544);

  return { totalStations: stations.length, stations: stations.slice(0, 10), iss };
}

// Get military satellite count
async function getMilitaryCount() {
  const data = await getTLEs('military');
  if (data.error || !Array.isArray(data)) {
    return { count: 0, error: data.error };
  }

  const byCountry = {};
  data.forEach(sat => {
    const country = sat.COUNTRY_CODE || 'UNK';
    byCountry[country] = (byCountry[country] || 0) + 1;
  });

  return { count: data.length, byCountry };
}

// Get mega-constellation stats (Starlink, OneWeb)
async function getConstellationStats() {
  const [starlink, oneweb] = await Promise.all([
    getTLEs('starlink'),
    getTLEs('oneweb'),
  ]);

  const count = d => (Array.isArray(d) ? d.length : d?.count || 0);
  return { starlink: count(starlink), oneweb: count(oneweb) };
}

// Generate signals
function generateSignals(data) {
  const signals = [];

  if (data.launches?.totalObjects > 50) {
    signals.push(`HIGH LAUNCH TEMPO: ${data.launches.totalObjects} new objects tracked in last 30 days`);
  }

  const byCountry = data.launches?.byCountry || {};
  const cnLaunches = byCountry['PRC'] || byCountry['CN'] || 0;
  const ruLaunches = byCountry['CIS'] || byCountry['RU'] || 0;

  if (cnLaunches > 10) {
    signals.push(`CHINA SPACE ACTIVITY: ${cnLaunches} objects launched recently`);
  }
  if (ruLaunches > 5) {
    signals.push(`RUSSIA SPACE ACTIVITY: ${ruLaunches} objects launched recently`);
  }
  if (data.military?.count > 500) {
    signals.push(`MILITARY CONSTELLATION: ${data.military.count} tracked military satellites`);
  }
  if (data.constellations?.starlink > 6000) {
    signals.push(`STARLINK MEGA-CONSTELLATION: ${data.constellations.starlink} active satellites`);
  }

  return signals;
}

// Briefing export
export async function briefing() {
  staleGroups = new Set();
  groupProviders = {};
  try {
    const [launches, stations, military, constellations] = await Promise.all([
      getRecentLaunches(),
      getStationData(),
      getMilitaryCount(),
      getConstellationStats(),
    ]);

    const hasData = !launches.error || !stations.error || !military.error || constellations.starlink > 0 || constellations.oneweb > 0;

    if (!hasData) {
      return {
        source: 'Space/CelesTrak',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: launches.error || stations.error || military.error || 'Failed to fetch space data',
      };
    }

    const data = { launches, stations, military, constellations };
    const signals = generateSignals(data);

    return {
      source: 'Space/CelesTrak',
      timestamp: new Date().toISOString(),
      status: 'active',
      recentLaunches: launches.recentLaunches || [],
      totalNewObjects: launches.error ? null : launches.totalObjects,
      launchByCountry: launches.byCountry || {},
      spaceStations: stations.stations || [],
      iss: stations.iss || null,
      militarySatellites: military.error ? null : military.count,
      militaryByCountry: military.byCountry || {},
      constellations: constellations || {},
      signals,
      providers: groupProviders,
      ...(staleGroups.size ? { stale: true, staleGroups: [...staleGroups] } : {}),
    };
  } catch (e) {
    return {
      source: 'Space/CelesTrak',
      timestamp: new Date().toISOString(),
      status: 'error',
      error: e.message,
    };
  }
}

if (process.argv[1]?.endsWith('space.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
