#!/usr/bin/env node

// Crucix-UK Master Orchestrator — UK-centric intelligence sweep
// Runs all intelligence sources in parallel, UK data sources replacing US equivalents.
// Outputs structured JSON for LLM synthesis into actionable briefings.

import './utils/env.mjs'; // Load API keys from .env
import { pathToFileURL } from 'node:url';

// === Tier 1: Core OSINT & Geopolitical ===
import { briefing as gdelt } from './sources/gdelt.mjs';
import { briefing as opensky } from './sources/opensky.mjs';
import { briefing as firms } from './sources/firms.mjs';
import { briefing as ships } from './sources/ships.mjs';
import { briefing as safecast } from './sources/safecast.mjs';
import { briefing as acled } from './sources/acled.mjs';
import { briefing as reliefweb } from './sources/reliefweb.mjs';
import { briefing as who } from './sources/who.mjs';
import { briefing as ofac } from './sources/ofac.mjs';           // US OFAC + UK OFSI
import { briefing as opensanctions } from './sources/opensanctions.mjs';
import { briefing as adsb } from './sources/adsb.mjs';

// === Tier 2: Economic & Financial (UK-centric) ===
import { briefing as boe } from './sources/boe.mjs';             // Bank of England (replaces FRED)
import { briefing as ukdmo } from './sources/ukdmo.mjs';         // UK DMO gilts (replaces US Treasury)
import { briefing as ons } from './sources/ons.mjs';             // ONS UK stats (replaces BLS)
import { briefing as ukpower } from './sources/ukpower.mjs';     // UK energy/grid (replaces EIA)
import { briefing as gscpi } from './sources/gscpi.mjs';         // NY Fed GSCPI (global supply chains)
import { briefing as ukspending } from './sources/ukspending.mjs'; // UK Contracts Finder (replaces USAspending)
import { briefing as comtrade } from './sources/comtrade.mjs';

// === Tier 3: Weather, Environment, Technology, Social (UK-centric) ===
import { briefing as metoffice } from './sources/metoffice.mjs'; // UK Met Office/EA (replaces NOAA)
import { briefing as eurdep } from './sources/eurdep.mjs';       // EURDEP radiation (replaces EPA RadNet)
import { briefing as ukpatents } from './sources/ukpatents.mjs'; // UK/EU patents (replaces USPTO)
import { briefing as bluesky } from './sources/bluesky.mjs';
import { briefing as reddit } from './sources/reddit.mjs';       // UK-focused subreddits
import { briefing as telegram } from './sources/telegram.mjs';
import { briefing as kiwisdr } from './sources/kiwisdr.mjs';

// === Tier 4: Space & Satellites ===
import { briefing as space } from './sources/space.mjs';

// === Tier 5: Live Market Data (UK-centric) ===
import { briefing as yfinance } from './sources/yfinance.mjs';   // FTSE 100, GBP/USD, Brent, gilts ETF

const SOURCE_TIMEOUT_MS = 30_000; // 30s max per individual source

export async function runSource(name, fn, ...args) {
  const start = Date.now();
  let timer;
  try {
    const dataPromise = fn(...args);
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Source ${name} timed out after ${SOURCE_TIMEOUT_MS / 1000}s`)), SOURCE_TIMEOUT_MS);
    });
    const data = await Promise.race([dataPromise, timeoutPromise]);
    return { name, status: 'ok', durationMs: Date.now() - start, data };
  } catch (e) {
    return { name, status: 'error', durationMs: Date.now() - start, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function fullBriefing() {
  console.error('[Crucix-UK] Starting UK intelligence sweep — 27 sources...');
  const start = Date.now();

  const allPromises = [
    // Tier 1: Core OSINT & Geopolitical
    runSource('GDELT', gdelt),
    runSource('OpenSky', opensky),
    runSource('FIRMS', firms),
    runSource('Maritime', ships),
    runSource('Safecast', safecast),
    runSource('ACLED', acled),
    runSource('ReliefWeb', reliefweb),
    runSource('WHO', who),
    runSource('OFAC+OFSI', ofac),                                  // US + UK sanctions
    runSource('OpenSanctions', opensanctions),
    runSource('ADS-B', adsb),

    // Tier 2: Economic & Financial (UK-centric)
    runSource('BoE', boe),                                         // Bank of England
    runSource('UK-DMO', ukdmo),                                    // UK gilts & fiscal
    runSource('ONS', ons),                                         // UK CPI, unemployment, GDP
    runSource('UK-Power', ukpower),                                // National Grid ESO
    runSource('GSCPI', gscpi),
    runSource('UK-Spending', ukspending),                          // UK Contracts Finder
    runSource('Comtrade', comtrade),

    // Tier 3: Weather, Environment, Technology, Social (UK-centric)
    runSource('MetOffice', metoffice),                             // UK weather & flood warnings
    runSource('EURDEP', eurdep),                                   // UK/European radiation
    runSource('UK-Patents', ukpatents),                            // UK/EU patent intelligence
    runSource('Bluesky', bluesky),
    runSource('Reddit', reddit),                                   // UK-focused subreddits
    runSource('Telegram', telegram),
    runSource('KiwiSDR', kiwisdr),

    // Tier 4: Space & Satellites
    runSource('Space', space),

    // Tier 5: Live Market Data (UK-centric)
    runSource('YFinance', yfinance),                               // FTSE 100, GBP/USD, Brent crude
  ];

  // Each runSource has its own 30s timeout, so allSettled will resolve
  // within ~30s even if APIs hang. Global timeout is a safety net.
  const results = await Promise.allSettled(allPromises);

  const sources = results.map(r => r.status === 'fulfilled' ? r.value : { status: 'failed', error: r.reason?.message });
  const totalMs = Date.now() - start;

  const output = {
    crucix: {
      version: '2.0.0-uk',
      edition: 'UK',
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

  console.error(`[Crucix-UK] Sweep complete in ${totalMs}ms — ${output.crucix.sourcesOk}/${sources.length} sources returned data`);
  return output;
}

// Run and output when executed directly
const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryHref && import.meta.url === entryHref) {
  const data = await fullBriefing();
  console.log(JSON.stringify(data, null, 2));
}
