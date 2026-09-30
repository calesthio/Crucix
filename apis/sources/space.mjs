// Space/CelesTrak — Satellite Activity Monitoring
// No API key required. Uses CelesTrak for public TLE data and launch info.
// Tracks: Recent launches, ISS position, satellite decay alerts, space debris.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { safeFetch } from '../utils/fetch.mjs';

const CELESTRAK_BASE = 'https://celestrak.org';

// CelesTrak asks clients not to re-download a group within 2 hours and firewalls
// IPs that do. Each group is cached on disk and refreshed at most every 2 hours;
// when a refresh fails, the stale copy is used rather than hammering it again.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000; // six groups in parallel must fit the 30s source budget
const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../runs/cache/celestrak', import.meta.url));
const cacheDir = () => process.env.CELESTRAK_CACHE_DIR || DEFAULT_CACHE_DIR;
let staleGroups = new Set();

// Satellite categories for monitoring
const SAT_CATEGORIES = {
  stations: '/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  lastDay: '/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json',
  military: '/NORAD/elements/gp.php?GROUP=military&FORMAT=json',
  gps: '/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=json',
  starlink: '/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json',
  oneweb: '/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=json',
};

function readCache(category) {
  try { return JSON.parse(readFileSync(join(cacheDir(), `${category}.json`), 'utf8')); } catch { return null; }
}

function writeCache(category, data) {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const file = join(cacheDir(), `${category}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ fetchedAt: Date.now(), data }));
    renameSync(`${file}.tmp`, file);
  } catch (e) {
    console.error(`[Space] Could not cache ${category}:`, e.message);
  }
}

// Get TLE data for a category (cached, see CACHE_TTL_MS)
export async function getTLEs(category) {
  const path = SAT_CATEGORIES[category];
  if (!path) return { error: 'Invalid category' };

  const cached = readCache(category);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const data = await safeFetch(`${CELESTRAK_BASE}${path}`, { timeout: FETCH_TIMEOUT_MS, retries: 0 });
  if (Array.isArray(data)) {
    writeCache(category, data);
    return data;
  }
  if (cached) {
    staleGroups.add(category);
    return cached.data;
  }
  // CelesTrak answers refused/duplicate downloads with a plain-text notice, not JSON
  if (data?.rawText) return { error: `CelesTrak: ${data.rawText.trim().slice(0, 160)}` };
  return { error: data?.error || 'Unexpected CelesTrak response' };
}

// Get recent launches (from last 30 days TLEs)
async function getRecentLaunches() {
  const data = await getTLEs('lastDay');
  if (data.error || !Array.isArray(data)) {
    return { error: data.error || 'Failed to fetch launch data' };
  }

  const launches = data.map(sat => ({
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

  const stations = data.map(sat => ({
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

  return {
    starlink: Array.isArray(starlink) ? starlink.length : 0,
    oneweb: Array.isArray(oneweb) ? oneweb.length : 0,
  };
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
  try {
    const [launches, stations, military, constellations] = await Promise.all([
      getRecentLaunches(),
      getStationData(),
      getMilitaryCount(),
      getConstellationStats(),
    ]);

    const hasData = !launches.error || !stations.error;

    if (!hasData) {
      return {
        source: 'Space/CelesTrak',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: launches.error || stations.error || 'Failed to fetch space data',
      };
    }

    const data = { launches, stations, military, constellations };
    const signals = generateSignals(data);

    return {
      source: 'Space/CelesTrak',
      timestamp: new Date().toISOString(),
      status: 'active',
      recentLaunches: launches.recentLaunches || [],
      totalNewObjects: launches.totalObjects || 0,
      launchByCountry: launches.byCountry || {},
      spaceStations: stations.stations || [],
      iss: stations.iss || null,
      militarySatellites: military.count || 0,
      militaryByCountry: military.byCountry || {},
      constellations: constellations || {},
      signals,
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
