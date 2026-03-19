#!/usr/bin/env node

// Crucix Master Orchestrator — runs all intelligence sources in parallel
// Outputs structured JSON for Claude to synthesize into actionable briefing

import { pathToFileURL } from 'node:url';
import './utils/env.mjs'; // Load API keys from .env

// === Tier 1: Core OSINT & Geopolitical ===
import { briefing as acled } from './sources/acled.mjs';
import { briefing as adsb } from './sources/adsb.mjs';
import { briefing as firms } from './sources/firms.mjs';
import { briefing as gdelt } from './sources/gdelt.mjs';
import { briefing as ofac } from './sources/ofac.mjs';
import { briefing as opensanctions } from './sources/opensanctions.mjs';
import { briefing as opensky } from './sources/opensky.mjs';
import { briefing as reliefweb } from './sources/reliefweb.mjs';
import { briefing as safecast } from './sources/safecast.mjs';
import { briefing as ships } from './sources/ships.mjs';
import { briefing as who } from './sources/who.mjs';

// === Tier 2: Economic & Financial ===
import { briefing as bls } from './sources/bls.mjs';
import { briefing as comtrade } from './sources/comtrade.mjs';
import { briefing as eia } from './sources/eia.mjs';
import { briefing as fred } from './sources/fred.mjs';
import { briefing as gscpi } from './sources/gscpi.mjs';
import { briefing as treasury } from './sources/treasury.mjs';
import { briefing as usaspending } from './sources/usaspending.mjs';

// === Tier 3: Weather, Environment, Technology, Social ===
import { briefing as bluesky } from './sources/bluesky.mjs';
import { briefing as epa } from './sources/epa.mjs';
import { briefing as kiwisdr } from './sources/kiwisdr.mjs';
import { briefing as noaa } from './sources/noaa.mjs';
import { briefing as patents } from './sources/patents.mjs';
import { briefing as reddit } from './sources/reddit.mjs';
import { briefing as telegram } from './sources/telegram.mjs';

// === Tier 4: Space & Satellites ===
import { briefing as space } from './sources/space.mjs';

// === Tier 5: Live Market Data ===
import { briefing as yfinance } from './sources/yfinance.mjs';

export async function runSource(name, fn, ...args) {
  const start = Date.now();
  try {
    const data = await fn(...args);
    return { name, status: 'ok', durationMs: Date.now() - start, data };
  } catch (e) {
    return { name, status: 'error', durationMs: Date.now() - start, error: e.message };
  }
}

export async function fullBriefing() {
  console.error('[Crucix] Starting intelligence sweep — 27 sources...');
  const start = Date.now();

  const results = await Promise.allSettled([
    // Tier 1: Core OSINT & Geopolitical
    runSource('GDELT', gdelt),
    runSource('OpenSky', opensky),
    runSource('FIRMS', firms),
    runSource('Maritime', ships),
    runSource('Safecast', safecast),
    runSource('ACLED', acled),
    runSource('ReliefWeb', reliefweb),
    runSource('WHO', who),
    runSource('OFAC', ofac),
    runSource('OpenSanctions', opensanctions),
    runSource('ADS-B', adsb),

    // Tier 2: Economic & Financial
    runSource('FRED', fred, process.env.FRED_API_KEY),
    runSource('Treasury', treasury),
    runSource('BLS', bls, process.env.BLS_API_KEY),
    runSource('EIA', eia, process.env.EIA_API_KEY),
    runSource('GSCPI', gscpi),
    runSource('USAspending', usaspending),
    runSource('Comtrade', comtrade),

    // Tier 3: Weather, Environment, Technology, Social
    runSource('NOAA', noaa),
    runSource('EPA', epa),
    runSource('Patents', patents),
    runSource('Bluesky', bluesky),
    runSource('Reddit', reddit),
    runSource('Telegram', telegram),
    runSource('KiwiSDR', kiwisdr),

    // Tier 4: Space & Satellites
    runSource('Space', space),

    // Tier 5: Live Market Data
    runSource('YFinance', yfinance),
  ]);

  const sources = results.map(r => r.status === 'fulfilled' ? r.value : { status: 'failed', error: r.reason?.message });
  const totalMs = Date.now() - start;

  const output = {
    crucix: {
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      totalDurationMs: totalMs,
      sourcesQueried: sources.length,
      sourcesOk: sources.filter(s => s.status === 'ok').length,
      sourcesFailed: sources.filter(s => s.status !== 'ok').length,
    },
    sources: Object.fromEntries(
      sources.filter(s => s.status === 'ok').map(s => [s.name, s.data])
    ),
    errors: sources.filter(s => s.status !== 'ok').map(s => ({ name: s.name, error: s.error })),
    timing: Object.fromEntries(
      sources.map(s => [s.name, { status: s.status, ms: s.durationMs }])
    ),
  };

  console.error(`[Crucix] Sweep complete in ${totalMs}ms — ${output.crucix.sourcesOk}/${sources.length} sources returned data`);
  return output;
}

// Run and output when executed directly
const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryHref && import.meta.url === entryHref) {
  const data = await fullBriefing();
  console.log(JSON.stringify(data, null, 2));
}
