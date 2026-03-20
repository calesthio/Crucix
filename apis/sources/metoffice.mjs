// UK Met Office + Environment Agency — Weather Warnings & Flood Alerts
// Met Office DataPoint API (optional key): datapoint.metoffice.gov.uk/public/data/
// Environment Agency Flood Monitoring API (free, no key): environment.data.gov.uk/flood-monitoring
// UK weather categories: storms, flooding, wind, snow, ice, fog — no hurricanes or tornadoes

import { safeFetch } from '../utils/fetch.mjs';

const EA_BASE = 'https://environment.data.gov.uk/flood-monitoring';
const MO_BASE = 'http://datapoint.metoffice.gov.uk/public/data';

// Get active flood warnings from the Environment Agency (England)
export async function getFloodWarnings(opts = {}) {
  const { severity = null, limit = 50 } = opts;

  const params = new URLSearchParams({
    '_limit': String(limit),
    'min-severity': severity || '1', // 1=Severe, 2=Warning, 3=Alert, 4=No longer in force
  });

  return safeFetch(`${EA_BASE}/id/floods?${params}`, {
    headers: { 'Accept': 'application/json' },
  });
}

// Get severe flood warnings only (severity <= 2 = Severe + Warning)
export async function getSevereFloodWarnings() {
  return safeFetch(`${EA_BASE}/id/floods?min-severity=1&severity-operator=lte&_limit=50`, {
    headers: { 'Accept': 'application/json' },
  });
}

// Get Met Office weather warnings via DataPoint (requires API key)
export async function getMetOfficeWarnings(apiKey) {
  if (!apiKey) return null;
  return safeFetch(
    `${MO_BASE}/txt/wxfcs/nationalpark/json/capabilities?key=${apiKey}`,
    { timeout: 15000 }
  );
}

// Map EA severity codes to labels
const SEVERITY_LABELS = {
  1: 'Severe Flood Warning',
  2: 'Flood Warning',
  3: 'Flood Alert',
  4: 'No Longer in Force',
};

// Map flood severity to a NOAA-compatible level for downstream processing
const SEVERITY_MAP = {
  1: 'Extreme',
  2: 'Severe',
  3: 'Moderate',
  4: 'Minor',
};

// Extract county/region from area description
function extractRegion(area) {
  if (!area) return null;
  // EA area descriptions often include county: "River Severn at Shrewsbury, Shropshire"
  const parts = area.split(',');
  return parts[parts.length - 1]?.trim() || null;
}

// Briefing — UK weather warnings and flood alerts
export async function briefing() {
  const apiKey = process.env.MET_OFFICE_API_KEY || null;

  // Fetch EA flood data for England (always available, no key)
  const floodData = await getFloodWarnings({ severity: null, limit: 100 });
  const floods = floodData?.items || [];

  // Separate by severity
  const severe = floods.filter(f => f.severity === 1 || f.severityLevel === 1);
  const warnings = floods.filter(f => f.severity === 2 || f.severityLevel === 2);
  const alerts = floods.filter(f => f.severity === 3 || f.severityLevel === 3);
  const inactive = floods.filter(f => f.severity === 4 || f.severityLevel === 4);

  // Build alert objects
  const topAlerts = floods.slice(0, 20).map(f => {
    const sev = f.severityLevel || f.severity || 3;
    const easting = f.easting || null;
    const northing = f.northing || null;

    // Convert British National Grid (Easting/Northing) to approximate lat/lon
    // Using a rough approximation (not geodetically precise but good enough for mapping)
    let lat = null, lon = null;
    if (easting && northing) {
      // Very rough BNG to WGS84 approximation for mainland UK
      lat = 49.0 + (northing / 1000000) * 9.1;
      lon = -7.5 + (easting / 1000000) * 15.0;
    } else if (f.lat) {
      lat = f.lat;
      lon = f.long || f.lon;
    }

    return {
      id: f['@id'] || f.floodAreaID || null,
      event: SEVERITY_LABELS[sev] || 'Flood Alert',
      severity: SEVERITY_MAP[sev] || 'Moderate',
      area: f.description || f.label || 'Unknown area',
      region: extractRegion(f.county || f.description),
      county: f.county || null,
      currentlyFlagged: f.isTidal != null ? !f.isTidal : null,
      floodType: f.isTidal ? 'Tidal' : 'Fluvial',
      timeRaised: f.timeRaised || f.raised || null,
      timeSeverityChanged: f.timeSeverityChanged || null,
      lat: lat ? +lat.toFixed(3) : null,
      lon: lon ? +lon.toFixed(3) : null,
    };
  });

  // Regional summary
  const byCounty = {};
  for (const f of floods) {
    const county = f.county || 'Unknown';
    byCounty[county] = (byCounty[county] || 0) + 1;
  }

  const signals = [];
  if (severe.length > 0) {
    signals.push(`${severe.length} SEVERE FLOOD WARNING(S) active — immediate danger to life/property`);
  }
  if (warnings.length > 5) {
    signals.push(`${warnings.length} Flood Warnings active across England`);
  }
  if (alerts.length > 10) {
    signals.push(`${alerts.length} Flood Alerts in effect — be prepared`);
  }
  if (floods.length === 0) {
    signals.push('No active flood warnings — conditions within normal range');
  }

  return {
    source: 'Met Office / Environment Agency',
    timestamp: new Date().toISOString(),
    coverage: 'England (EA flood data) — Scotland/Wales/NI covered by separate agencies',
    totalActiveAlerts: floods.filter(f => (f.severityLevel || f.severity) <= 3).length,
    summary: {
      severeFloodWarnings: severe.length,
      floodWarnings: warnings.length,
      floodAlerts: alerts.length,
      noLongerInForce: inactive.length,
    },
    topAlerts,
    byCounty: Object.fromEntries(
      Object.entries(byCounty).sort((a, b) => b[1] - a[1]).slice(0, 15)
    ),
    signals,
    metOfficeKey: apiKey ? 'configured' : 'not set — set MET_OFFICE_API_KEY for enhanced weather warnings',
    dataSource: {
      floodData: 'Environment Agency Flood Monitoring API (free, real-time)',
      weatherWarnings: apiKey
        ? 'Met Office DataPoint (authenticated)'
        : 'Met Office DataPoint (unauthenticated — limited data)',
    },
  };
}

if (process.argv[1]?.endsWith('metoffice.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
