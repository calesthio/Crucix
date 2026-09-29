// OpenSky Network — Real-time flight tracking
// Anonymous: 400 API credits/day. With an account (OAuth2 API client): 4,000/day,
// 8,000/day for active feeders. Set OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET to authenticate.
// Tracks all aircraft with ADS-B transponders including many military.

import { safeFetch } from '../utils/fetch.mjs';
import '../utils/env.mjs';

const BASE = 'https://opensky-network.org/api';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const TOKEN_REFRESH_MARGIN_MS = 60_000; // refresh a minute before expiry

// === OAuth2 client-credentials token (optional) ===
let cachedToken = null;       // { value, expiresAt }
let pendingToken = null;      // shared in-flight request so parallel hotspot calls fetch once
let lastAuthError = null;

function hasCredentials() {
  return Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);
}

async function requestToken() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Crucix/1.0' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.OPENSKY_CLIENT_ID,
        client_secret: process.env.OPENSKY_CLIENT_SECRET,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`token request failed: HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    const json = await res.json();
    if (!json.access_token) throw new Error('token response missing access_token');
    const ttlMs = (Number(json.expires_in) || 1800) * 1000;
    return { value: json.access_token, expiresAt: Date.now() + ttlMs - TOKEN_REFRESH_MARGIN_MS };
  } finally {
    clearTimeout(timer);
  }
}

// Returns Authorization headers, or {} to fall back to anonymous access.
export async function getAuthHeaders() {
  if (!hasCredentials()) return {};
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return { Authorization: `Bearer ${cachedToken.value}` };
  }
  if (!pendingToken) {
    pendingToken = requestToken()
      .then(token => { cachedToken = token; lastAuthError = null; return token; })
      .catch(err => { cachedToken = null; lastAuthError = err.message; return null; })
      .finally(() => { pendingToken = null; });
  }
  const token = await pendingToken;
  return token ? { Authorization: `Bearer ${token.value}` } : {};
}

// Only clear the token that actually failed, so parallel 401s don't trigger a refresh each
function invalidateToken(authHeader) {
  if (cachedToken && authHeader === `Bearer ${cachedToken.value}`) cachedToken = null;
}

// Authenticated GET with one retry on 401 (expired/revoked token)
async function openskyFetch(url, opts = {}) {
  let headers = await getAuthHeaders();
  let data = await safeFetch(url, { ...opts, headers });
  if (headers.Authorization && typeof data?.error === 'string' && data.error.startsWith('HTTP 401')) {
    invalidateToken(headers.Authorization);
    headers = await getAuthHeaders();
    data = await safeFetch(url, { ...opts, headers });
  }
  return data;
}

// Get all current flights (global state vector)
export async function getAllFlights() {
  return openskyFetch(`${BASE}/states/all`, { timeout: 30000 });
}

// Get flights in a bounding box (lat/lon)
export async function getFlightsInArea(lamin, lomin, lamax, lomax) {
  const params = new URLSearchParams({
    lamin: String(lamin),
    lomin: String(lomin),
    lamax: String(lamax),
    lomax: String(lomax),
  });
  return openskyFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get flights by specific aircraft (ICAO24 hex codes)
export async function getFlightsByIcao(icao24List) {
  const icao = Array.isArray(icao24List) ? icao24List : [icao24List];
  const params = icao.map(i => `icao24=${i}`).join('&');
  return openskyFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get departures from an airport in a time range
export async function getDepartures(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return openskyFetch(`${BASE}/flights/departure?${params}`);
}

// Get arrivals at an airport
export async function getArrivals(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return openskyFetch(`${BASE}/flights/arrival?${params}`);
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
  // Resolve the token once up front so all hotspot requests share it
  const authHeaders = await getAuthHeaders();
  const authMode = authHeaders.Authorization ? 'oauth2' : 'anonymous';
  const results = await Promise.all(
    hotspotEntries.map(async ([key, box]) => {
      const data = await getFlightsInArea(box.lamin, box.lomin, box.lamax, box.lomax);
      const error = data?.error || null;
      const states = data?.states || [];
      return {
        region: box.label,
        key,
        totalAircraft: states.length,
        // states format: [icao24, callsign, origin_country, ...]
        byCountry: states.reduce((acc, s) => {
          const country = s[2] || 'Unknown';
          acc[country] = (acc[country] || 0) + 1;
          return acc;
        }, {}),
        // Flag potentially interesting (military often have no callsign or specific patterns)
        noCallsign: states.filter(s => !s[1]?.trim()).length,
        highAltitude: states.filter(s => s[7] && s[7] > 12000).length, // >12km altitude
        ...(error ? { error } : {}),
      };
    })
  );

  const hotspotErrors = results
    .filter(r => r.error)
    .map(r => ({ region: r.region, error: r.error }));

  return {
    source: 'OpenSky',
    timestamp: new Date().toISOString(),
    authMode,
    ...(hasCredentials() && lastAuthError ? { authError: lastAuthError } : {}),
    hotspots: results,
    ...(hotspotErrors.length ? {
      error: hotspotErrors.length === results.length
        ? `OpenSky unavailable across all hotspots: ${hotspotErrors[0].error}`
        : `OpenSky unavailable for ${hotspotErrors.length}/${results.length} hotspots`,
      hotspotErrors,
    } : {}),
  };
}

if (process.argv[1]?.endsWith('opensky.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
