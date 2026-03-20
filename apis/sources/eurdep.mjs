// EURDEP — European Radiological Data Exchange Platform
// Operated by JRC (European Commission Joint Research Centre).
// Provides gamma dose rates from ~5,500 monitoring stations across Europe, including the UK.
// Public data, no auth required for basic access.
// Complements Safecast (citizen science) with official governmental readings.
//
// UK stations operated by UKHSA (UK Health Security Agency).
// Additional context from IAEA INES and RODOS/REM systems.

import { safeFetch } from '../utils/fetch.mjs';

// EURDEP web service endpoint
const EURDEP_BASE = 'https://eurdep.jrc.ec.europa.eu';

// UK monitoring station IDs (EURDEP station identifiers for key UK sites)
// Station codes follow the pattern: GB + location code
const UK_STATIONS = [
  { id: 'GBR_AWE',     label: 'Aldermaston (AWE)',       lat: 51.36,  lon: -1.17  },
  { id: 'GBR_LON',     label: 'London',                  lat: 51.51,  lon: -0.13  },
  { id: 'GBR_EDI',     label: 'Edinburgh',               lat: 55.95,  lon: -3.19  },
  { id: 'GBR_MAN',     label: 'Manchester',              lat: 53.48,  lon: -2.24  },
  { id: 'GBR_BRS',     label: 'Bristol',                 lat: 51.45,  lon: -2.58  },
  { id: 'GBR_HIN',     label: 'Hinkley Point',           lat: 51.21,  lon: -3.14  },
  { id: 'GBR_SEL',     label: 'Sellafield',              lat: 54.42,  lon: -3.49  },
  { id: 'GBR_HAR',     label: 'Hartlepool',              lat: 54.63,  lon: -1.20  },
  { id: 'GBR_HEY',     label: 'Heysham',                 lat: 54.03,  lon: -2.92  },
  { id: 'GBR_BEL',     label: 'Belfast',                 lat: 54.60,  lon: -5.93  },
  { id: 'GBR_CAR',     label: 'Cardiff',                 lat: 51.48,  lon: -3.18  },
  { id: 'GBR_INV',     label: 'Inverness',               lat: 57.48,  lon: -4.22  },
];

// Analytes of concern (same as EPA RadNet for cross-system consistency)
const KEY_ANALYTES = [
  'GAMMA_DOSE_RATE',
  'GROSS_BETA',
  'GROSS_ALPHA',
  'IODINE-131',
  'CESIUM-137',
  'CESIUM-134',
];

// Background gamma dose rate thresholds (nSv/h — nanoseiverts per hour)
// Normal UK background: ~70-150 nSv/h depending on geology
const GAMMA_THRESHOLDS = {
  normal: 150,    // above this, worth noting
  elevated: 300,  // significantly above background
  alarm: 1000,    // serious concern
};

// EURDEP gamma dose rate map data (most accessible public endpoint)
// Returns data for European stations as GeoJSON or JSON
async function fetchEURDEPGammaMap(hoursBack = 24) {
  // EURDEP's public REST endpoint for recent gamma data
  const endTime = new Date().toISOString();
  const startTime = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  // Try the EURDEP REST API for gamma dose rates
  const url = `${EURDEP_BASE}/Basic/Services/DataExchangeService.svc/GetGammaDoseRates` +
    `?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&format=json`;

  return safeFetch(url, { timeout: 25000 });
}

// Fetch RODOS/REM data for European gamma network (alternative public endpoint)
async function fetchREMData() {
  // Real-time European gamma monitoring via JRC RODOS
  return safeFetch(
    'https://rodos.jrc.ec.europa.eu/GammaMap/GammaMapWeb/RestAPI/GammaMap/GammaMapRest.svc/GetGammaDoseRates',
    { timeout: 25000 }
  );
}

// Check a gamma reading against thresholds
function assessReading(value_nSvh, location) {
  if (value_nSvh === null || value_nSvh < 0) return null;

  if (value_nSvh > GAMMA_THRESHOLDS.alarm) {
    return { level: 'ALARM', value: value_nSvh, location, ratio: (value_nSvh / GAMMA_THRESHOLDS.normal).toFixed(1) };
  }
  if (value_nSvh > GAMMA_THRESHOLDS.elevated) {
    return { level: 'ELEVATED', value: value_nSvh, location, ratio: (value_nSvh / GAMMA_THRESHOLDS.normal).toFixed(1) };
  }
  if (value_nSvh > GAMMA_THRESHOLDS.normal) {
    return { level: 'ABOVE_BACKGROUND', value: value_nSvh, location, ratio: (value_nSvh / GAMMA_THRESHOLDS.normal).toFixed(1) };
  }
  return null;
}

// Briefing — get UK radiation monitoring status from EURDEP
export async function briefing() {
  const signals = [];
  const readings = [];

  // Try to fetch live EURDEP data
  const [eurdepData, remData] = await Promise.allSettled([
    fetchEURDEPGammaMap(24),
    fetchREMData(),
  ]);

  // Process EURDEP gamma map data if available
  const eurdepResult = eurdepData.status === 'fulfilled' ? eurdepData.value : null;
  const remResult = remData.status === 'fulfilled' ? remData.value : null;

  // Extract UK station readings if data came back in a parseable format
  const rawData = eurdepResult || remResult;

  if (rawData && !rawData.error && !rawData.rawText?.includes('<html')) {
    // Data returned in some form — try to extract UK stations
    const stations = rawData.stations || rawData.features || rawData.data || [];

    if (Array.isArray(stations)) {
      for (const station of stations) {
        const countryCode = station.countryCode || station.country || station.properties?.countryCode || '';
        if (countryCode === 'GB' || countryCode === 'UK' || countryCode === 'GBR') {
          const value = parseFloat(station.value || station.properties?.value || 0);
          const label = station.stationName || station.name || station.properties?.stationName || 'UK Station';
          const lat = station.lat || station.latitude || station.geometry?.coordinates?.[1] || null;
          const lon = station.lon || station.longitude || station.geometry?.coordinates?.[0] || null;
          const date = station.endTime || station.time || station.date || null;

          readings.push({ label, value, unit: 'nSv/h', lat, lon, date });
          const alert = assessReading(value, label);
          if (alert) {
            signals.push(`${alert.level}: ${label} at ${alert.value} nSv/h (${alert.ratio}x background)`);
          }
        }
      }
    }
  }

  // If no live data, return stub with documented UK monitoring sites
  const dataAvailable = readings.length > 0;

  if (!dataAvailable) {
    signals.push('EURDEP live feed unavailable — UK monitoring network operational but data not retrieved');
  }

  return {
    source: 'EURDEP / UKHSA Radiation Monitoring',
    timestamp: new Date().toISOString(),
    coverage: 'UK (UKHSA network) + European stations via JRC EURDEP',
    dataAvailable,
    totalReadings: readings.length,
    readings: readings.slice(0, 30),
    signals: signals.length > 0
      ? signals
      : ['All EURDEP UK gamma readings within normal background levels (70–150 nSv/h)'],
    thresholds: {
      normalBackground: `< ${GAMMA_THRESHOLDS.normal} nSv/h`,
      elevated: `> ${GAMMA_THRESHOLDS.elevated} nSv/h`,
      alarm: `> ${GAMMA_THRESHOLDS.alarm} nSv/h`,
    },
    ukMonitoringSites: UK_STATIONS,
    keyAnalytes: KEY_ANALYTES,
    note: [
      'EURDEP provides near-real-time gamma dose rates from ~5,500 European stations.',
      'UK stations operated by UKHSA (UK Health Security Agency).',
      'Nuclear sites monitored: Sellafield, Hinkley Point, Heysham, Hartlepool, Sizewell.',
      'Safecast source provides citizen-science radiation readings as a complementary layer.',
    ],
    integrationNote: 'For direct UKHSA access, see: https://www.gov.uk/guidance/radiation-monitoring',
  };
}

if (process.argv[1]?.endsWith('eurdep.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
