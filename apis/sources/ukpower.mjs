// UK Power & Energy — National Grid ESO + Energy Markets
// Replaces EIA (US Energy Information Administration) with UK energy data.
//
// Sources:
//   National Grid ESO API (free, no key): api.nationalgrideso.com
//   ELEXON BMRS API (free, no key): api.elexon.co.uk
//   Yahoo Finance (NBP gas, Brent crude — via yfinance module)
//
// UK energy context:
//   - Brent crude (not WTI) is the UK/European oil benchmark
//   - NBP (National Balancing Point) is the UK natural gas benchmark
//   - UK electricity generation mix: renewables (~45%), gas (~30%), nuclear (~15%), imports (~10%)
//   - OFGEM regulates UK energy retail markets

import { safeFetch } from '../utils/fetch.mjs';

const NESO_BASE = 'https://api.nationalgrideso.com/api/1/datastore_search';
const ELEXON_BASE = 'https://api.elexon.co.uk/BMRS/api/v1';

// National Grid ESO resource IDs for key datasets
const NESO_RESOURCES = {
  generationMix:    '7c5d1a26-0ba3-4f0e-a8b4-a4cdcd2a5e2f', // Live generation mix
  interconnectors:  'b017027b-6e5e-4caa-9c4a-23234d3b4aaf', // Cross-channel power flows
  demandForecast:   '7c5d1a26-0ba3-4f0e-a8b4-a4cdcd2a5e2f', // Demand forecast
};

// Fetch current UK electricity generation mix from National Grid ESO
async function fetchGenerationMix() {
  // Carbon Intensity API (api.carbonintensity.org.uk) — excellent free UK grid data
  return safeFetch('https://api.carbonintensity.org.uk/generation', {
    headers: { 'Accept': 'application/json' },
    timeout: 15000,
  });
}

// Fetch UK carbon intensity (gCO2/kWh) — a proxy for gas vs renewables mix
async function fetchCarbonIntensity() {
  return safeFetch('https://api.carbonintensity.org.uk/intensity', {
    headers: { 'Accept': 'application/json' },
    timeout: 15000,
  });
}

// Fetch UK regional carbon intensity
async function fetchRegionalIntensity() {
  return safeFetch('https://api.carbonintensity.org.uk/regional', {
    headers: { 'Accept': 'application/json' },
    timeout: 15000,
  });
}

// Fetch UK electricity demand and generation from ELEXON BMRS
async function fetchELEXONData() {
  // System frequency and demand — key for grid stability monitoring
  const params = new URLSearchParams({
    settlementDate: new Date().toISOString().split('T')[0],
    format: 'json',
  });
  return safeFetch(`${ELEXON_BASE}/datasets/FUELHH?${params}`, { timeout: 20000 });
}

// Compact generation source for briefing
function compactGeneration(fuel, level) {
  return { fuel, pct: level != null ? Math.round(level * 10) / 10 : null };
}

// Briefing — UK power grid and energy market data
export async function briefing() {
  const [genData, intensityData] = await Promise.allSettled([
    fetchGenerationMix(),
    fetchCarbonIntensity(),
  ]);

  const signals = [];
  const generationMix = [];

  // Process generation mix
  const gen = genData.status === 'fulfilled' ? genData.value : null;
  const genFuels = gen?.data?.generationmix || [];

  for (const fuel of genFuels) {
    generationMix.push(compactGeneration(fuel.fuel, fuel.perc));
  }

  // Key generation percentages
  const renewables = genFuels
    .filter(f => ['wind', 'solar', 'hydro', 'biomass'].includes(f.fuel))
    .reduce((sum, f) => sum + (f.perc || 0), 0);
  const gas = genFuels.find(f => f.fuel === 'gas')?.perc || null;
  const nuclear = genFuels.find(f => f.fuel === 'nuclear')?.perc || null;
  const coal = genFuels.find(f => f.fuel === 'coal')?.perc || null;
  const imports = genFuels.find(f => f.fuel === 'imports')?.perc || null;
  const wind = genFuels.find(f => f.fuel === 'wind')?.perc || null;

  // Signals from generation data
  if (gas !== null && gas > 50) {
    signals.push(`UK gas generation elevated at ${gas.toFixed(1)}% — grid highly exposed to gas prices`);
  }
  if (wind !== null && wind > 45) {
    signals.push(`High UK wind generation at ${wind.toFixed(1)}% — negative price risk in wholesale market`);
  }
  if (wind !== null && wind < 5) {
    signals.push(`WIND DROUGHT: UK wind at only ${wind.toFixed(1)}% — gas dependency high, price risk`);
  }
  if (coal !== null && coal > 1) {
    signals.push(`UK coal generation at ${coal.toFixed(1)}% — emergency backup in use`);
  }
  if (imports !== null && imports > 20) {
    signals.push(`UK power imports at ${imports.toFixed(1)}% — high dependency on interconnectors`);
  }

  // Carbon intensity
  const intensity = intensityData.status === 'fulfilled' ? intensityData.value : null;
  const carbonIntensity = intensity?.data?.[0]?.intensity;

  if (carbonIntensity?.actual != null) {
    if (carbonIntensity.actual > 250) {
      signals.push(`UK grid carbon intensity HIGH at ${carbonIntensity.actual} gCO2/kWh — gas-heavy generation`);
    } else if (carbonIntensity.actual < 100) {
      signals.push(`UK grid very clean at ${carbonIntensity.actual} gCO2/kWh — high renewables`);
    }
  }

  return {
    source: 'National Grid ESO / Carbon Intensity API / ELEXON',
    timestamp: new Date().toISOString(),
    ukElectricity: {
      generationMix,
      summary: {
        renewablesPct: genFuels.length > 0 ? Math.round(renewables * 10) / 10 : null,
        gasPct: gas,
        nuclearPct: nuclear,
        coalPct: coal,
        windPct: wind,
        importsPct: imports,
      },
      carbonIntensity: carbonIntensity ? {
        actual: carbonIntensity.actual,
        forecast: carbonIntensity.forecast,
        index: carbonIntensity.index, // very low / low / moderate / high / very high
      } : null,
    },
    energyContext: {
      oilBenchmark: 'Brent Crude (ICE) — UK/European standard (see YFinance source for live prices)',
      gasBenchmark: 'NBP (National Balancing Point) — UK natural gas benchmark',
      electricityMarket: 'GB Electricity Market (OFGEM regulated, NESO operated)',
      interconnectors: ['IFA (France 2GW)', 'BritNed (Netherlands 1GW)', 'NEMO (Belgium 1GW)',
                        'Viking (Denmark 1.4GW)', 'NSL (Norway 1.4GW)'],
    },
    signals: signals.length > 0
      ? signals
      : ['UK energy grid operating within normal parameters'],
    note: [
      'Carbon Intensity API provides real-time UK grid generation mix and CO2 intensity.',
      'Brent crude and NBP gas prices tracked in YFinance source.',
      'OFGEM price cap and wholesale market data available at ofgem.gov.uk.',
    ],
  };
}

if (process.argv[1]?.endsWith('ukpower.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
