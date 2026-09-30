// Space source — cache and provider fallback tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies, no network

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const MODULE_URL = new URL('../apis/sources/space.mjs', import.meta.url);
const realFetch = globalThis.fetch;
let loadCount = 0;
let dir;
let calls;
let routes;

// Fresh module per test so in-memory state (CelesTrak backoff, Space-Track session) starts clean
const loadSpace = () => import(`${MODULE_URL.href}?t=${loadCount++}`);

const ISS_TLE = {
  satelliteId: 25544, name: 'ISS (ZARYA)', date: '2026-09-29T19:40:36+00:00',
  line1: '1 25544U 98067A   26272.81986231  .00003740  00000-0  71685-4 0  9993',
  line2: '2 25544  51.6314 140.6663 0007036 204.8576 155.2074 15.48692916588024',
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const text = (body, status = 200) => new Response(body, { status });

function host(url) {
  if (url.includes('celestrak.org')) return 'celestrak';
  if (url.includes('space-track.org/ajaxauth/login')) return 'spacetrackLogin';
  if (url.includes('space-track.org')) return 'spacetrack';
  if (url.includes('tle.ivanstanojevic.me')) return 'tleapi';
  return 'other';
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crucix-space-'));
  process.env.CELESTRAK_CACHE_DIR = dir;
  delete process.env.SPACETRACK_USER;
  delete process.env.SPACETRACK_PASSWORD;
  calls = { celestrak: 0, spacetrackLogin: 0, spacetrack: 0, tleapi: 0, other: 0 };
  routes = {
    celestrak: () => json([{ OBJECT_NAME: 'SAT-1', NORAD_CAT_ID: 1, MEAN_MOTION: 15.5, ECCENTRICITY: 0.0007 }]),
    spacetrackLogin: () => json('', 200, { 'Set-Cookie': 'chocolatechip=abc; path=/' }),
    spacetrack: () => json([{ OBJECT_NAME: 'ST-SAT', NORAD_CAT_ID: '2', APOAPSIS: '421.5', PERIAPSIS: '415.0', PERIOD: '92.8', COUNTRY_CODE: 'US' }]),
    tleapi: url => (url.includes('search=') ? json({ totalItems: 7000, member: [] }) : json(ISS_TLE)),
  };
  globalThis.fetch = async (url, init = {}) => {
    const h = host(String(url));
    calls[h]++;
    return routes[h](String(url), init);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CELESTRAK_CACHE_DIR;
  delete process.env.SPACETRACK_USER;
  delete process.env.SPACETRACK_PASSWORD;
  rmSync(dir, { recursive: true, force: true });
});

function seedCache(category, data, ageMs, provider = 'celestrak') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${category}.json`), JSON.stringify({ fetchedAt: Date.now() - ageMs, provider, data }));
}

const HOURS = 60 * 60 * 1000;

describe('Space cache', () => {
  it('downloads once from CelesTrak, then serves from cache within 2 hours', async () => {
    const { getTLEs } = await loadSpace();
    assert.equal((await getTLEs('stations')).length, 1);
    assert.equal((await getTLEs('stations')).length, 1);
    assert.equal(calls.celestrak, 1);
    const saved = JSON.parse(readFileSync(join(dir, 'stations.json'), 'utf8'));
    assert.equal(saved.provider, 'celestrak');
  });

  it('refreshes once the cache is older than 2 hours', async () => {
    seedCache('military', [{ OBJECT_NAME: 'OLD' }], 3 * HOURS);
    const { getTLEs } = await loadSpace();
    assert.equal((await getTLEs('military'))[0].OBJECT_NAME, 'SAT-1');
  });

  it('serves stale cache when every provider fails', async () => {
    seedCache('lastDay', [{ OBJECT_NAME: 'CACHED' }], 3 * HOURS);
    routes.celestrak = () => text('refused');
    const { getTLEs } = await loadSpace();
    assert.equal((await getTLEs('lastDay'))[0].OBJECT_NAME, 'CACHED');
  });
});

describe('Space provider fallback', () => {
  it('falls back to Space-Track when CelesTrak refuses, sharing one login', async () => {
    process.env.SPACETRACK_USER = 'me@example.com';
    process.env.SPACETRACK_PASSWORD = 'pw';
    routes.celestrak = () => text('Access denied');
    const { getTLEs } = await loadSpace();
    const [stations, launches] = await Promise.all([getTLEs('stations'), getTLEs('lastDay')]);
    assert.equal(stations[0].OBJECT_NAME, 'ST-SAT');
    assert.equal(launches[0].OBJECT_NAME, 'ST-SAT');
    assert.equal(calls.spacetrackLogin, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, 'stations.json'), 'utf8')).provider, 'space-track');
  });

  it('skips CelesTrak for a while after it fails', async () => {
    routes.celestrak = () => text('refused');
    const { getTLEs } = await loadSpace();
    await getTLEs('starlink');
    await getTLEs('oneweb');
    assert.equal(calls.celestrak, 1);
  });

  it('uses the keyless TLE API for stations and constellation counts', async () => {
    routes.celestrak = () => text('refused');
    const { getTLEs } = await loadSpace();
    const stations = await getTLEs('stations');
    assert.equal(stations[0].OBJECT_NAME, 'ISS (ZARYA)');
    assert.equal(stations[0].INCLINATION, 51.6314);
    assert.equal(stations[0].RA_OF_ASC_NODE, 140.6663);
    assert.equal(stations[0].ECCENTRICITY, 0.0007036);
    assert.equal(stations[0].ARG_OF_PERICENTER, 204.8576);
    assert.equal(stations[0].MEAN_ANOMALY, 155.2074);
    assert.deepEqual(await getTLEs('starlink'), { count: 7000 });
  });

  it('has no keyless fallback for military, and reports the CelesTrak error', async () => {
    routes.celestrak = () => text('Access denied: too many requests');
    const { getTLEs } = await loadSpace();
    const data = await getTLEs('military');
    assert.match(data.error, /CelesTrak: Access denied/);
    assert.equal(calls.tleapi, 0);
  });

  it('falls through to the keyless API when Space-Track login fails', async () => {
    process.env.SPACETRACK_USER = 'me@example.com';
    process.env.SPACETRACK_PASSWORD = 'wrong';
    routes.celestrak = () => text('refused');
    routes.spacetrackLogin = () => json({ Login: 'Failed' });
    const { getTLEs } = await loadSpace();
    assert.deepEqual(await getTLEs('oneweb'), { count: 7000 });
    assert.equal(calls.spacetrack, 0);
  });
});

describe('Space briefing', () => {
  it('derives ISS altitude from orbital elements and records providers', async () => {
    routes.celestrak = () => text('refused');
    const { briefing } = await loadSpace();
    const result = await briefing();
    assert.equal(result.status, 'active');
    assert.ok(result.iss.apogee > 400 && result.iss.apogee < 440, `apogee ${result.iss.apogee}`);
    assert.ok(result.iss.perigee > 400 && result.iss.perigee < 440, `perigee ${result.iss.perigee}`);
    assert.equal(result.constellations.starlink, 7000);
    assert.equal(result.militarySatellites, null);
    assert.equal(result.providers.stations, 'tle-api');
    assert.equal(result.iss.raan, 140.6663);
    assert.equal(result.iss.meanAnomaly, 155.2074);
    assert.equal(result.providerHealth.CelesTrak.status, 'error');
    assert.equal(result.providerHealth['Space-Track'].status, 'no_credentials');
    assert.equal(result.providerHealth['TLE API'].status, 'partial');
  });

  it('marks the briefing stale when a group came from stale cache', async () => {
    for (const g of ['stations', 'lastDay', 'military', 'starlink', 'oneweb']) seedCache(g, [], 3 * HOURS);
    routes.celestrak = () => text('refused');
    routes.tleapi = () => text('down', 503);
    const { briefing } = await loadSpace();
    const result = await briefing();
    assert.equal(result.stale, true);
    assert.equal(result.providers.military, 'celestrak (cached)');
  });
});

describe('withOrbit', () => {
  it('computes apogee, perigee and period from mean motion and eccentricity', async () => {
    const { withOrbit } = await loadSpace();
    const iss = withOrbit({ MEAN_MOTION: 15.48692916, ECCENTRICITY: 0.0007036 });
    assert.ok(Math.abs(iss.PERIOD - 92.98) < 0.05, `period ${iss.PERIOD}`);
    assert.ok(iss.APOAPSIS > iss.PERIAPSIS);
  });

  it('keeps provider values and parses Space-Track strings', async () => {
    const { withOrbit } = await loadSpace();
    const sat = withOrbit({ APOAPSIS: '421.5', PERIAPSIS: '415.0', PERIOD: '92.8', NORAD_CAT_ID: '25544', MEAN_MOTION: '15.5' });
    assert.deepEqual([sat.APOAPSIS, sat.PERIAPSIS, sat.PERIOD, sat.NORAD_CAT_ID], [421.5, 415, 92.8, 25544]);
  });
});
