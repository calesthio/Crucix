// NOAA / National Weather Service — Severe weather alerts & climate events
// No auth required. Real-time alerts.

import { safeFetch } from '../utils/fetch.mjs';
import { SourceError } from '../../lib/errors.mjs';

const NWS_BASE = 'https://api.weather.gov';

// Get all active weather alerts (US)
export async function getActiveAlerts(opts = {}) {
  const {
    severity = null,  // Extreme, Severe, Moderate, Minor
    urgency = null,   // Immediate, Expected, Future
    event = null,     // e.g. "Tornado Warning", "Hurricane Warning"
    limit = 50,
  } = opts;

  const params = new URLSearchParams({ limit: String(limit), status: 'actual' });
  if (severity) params.set('severity', severity);
  if (urgency) params.set('urgency', urgency);
  if (event) params.set('event', event);

  return safeFetch(`${NWS_BASE}/alerts/active?${params}`, {
    headers: { 'Accept': 'application/geo+json' },
  });
}

// Get severe alerts only
export async function getSevereAlerts() {
  return getActiveAlerts({ severity: 'Extreme,Severe' });
}

// Briefing — severe weather events that could impact markets/supply chains
export async function briefing() {
  const alerts = await getSevereAlerts();
  // Track source errors structurally without breaking the briefing flow
  const fetchError = alerts?.error
    ? new SourceError(`NOAA fetch failed: ${alerts.error}`, { source: 'NOAA/NWS', cause: alerts._sourceError })
    : null;
  const features = alerts?.features || [];

  // Categorize by impact type
  const hurricanes = features.filter(f => /hurricane|typhoon|tropical/i.test(f.properties?.event));
  const tornadoes = features.filter(f => /tornado/i.test(f.properties?.event));
  const floods = features.filter(f => /flood/i.test(f.properties?.event));
  const winter = features.filter(f => /blizzard|ice storm|winter/i.test(f.properties?.event));
  const fire = features.filter(f => /fire/i.test(f.properties?.event));
  const other = features.filter(f => {
    const e = f.properties?.event || '';
    return !/hurricane|typhoon|tropical|tornado|flood|blizzard|ice storm|winter|fire/i.test(e);
  });

  return {
    source: 'NOAA/NWS',
    timestamp: new Date().toISOString(),
    totalSevereAlerts: features.length,
    ...(fetchError ? { _sourceError: fetchError } : {}),
    summary: {
      hurricanes: hurricanes.length,
      tornadoes: tornadoes.length,
      floods: floods.length,
      winterStorms: winter.length,
      wildfires: fire.length,
      other: other.length,
    },
    topAlerts: features.slice(0, 15).map(f => {
      // Extract centroid from GeoJSON geometry
      let lat = null, lon = null;
      const geo = f.geometry;
      if (geo?.type === 'Polygon' && geo.coordinates?.[0]?.length) {
        const coords = geo.coordinates[0];
        lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      } else if (geo?.type === 'MultiPolygon' && geo.coordinates?.length) {
        const coords = geo.coordinates[0][0];
        lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      } else if (geo?.type === 'Point') {
        [lon, lat] = geo.coordinates;
      }
      return {
        event: f.properties?.event,
        severity: f.properties?.severity,
        urgency: f.properties?.urgency,
        headline: f.properties?.headline,
        areas: f.properties?.areaDesc,
        onset: f.properties?.onset,
        expires: f.properties?.expires,
        lat: lat != null ? +lat.toFixed(3) : null,
        lon: lon != null ? +lon.toFixed(3) : null,
      };
    }),
  };
}

if (process.argv[1]?.endsWith('noaa.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
