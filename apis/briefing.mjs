#!/usr/bin/env node

// Crucix Master Orchestrator — runs all intelligence sources in parallel
// Outputs structured JSON for Claude to synthesize into actionable briefing

import './utils/env.mjs'; // Load API keys from .env
import { pathToFileURL } from 'node:url';
import { VERSION } from '../lib/version.mjs';
import { summarizeSourceHealth } from '../lib/source-health.mjs';

// === Tier 1: Core OSINT & Geopolitical ===
import { briefing as gdelt } from './sources/gdelt.mjs';
import { briefing as opensky } from './sources/opensky.mjs';
import { briefing as firms } from './sources/firms.mjs';
import { briefing as ships } from './sources/ships.mjs';
import { briefing as safecast } from './sources/safecast.mjs';
import { briefing as acled } from './sources/acled.mjs';
import { briefing as reliefweb } from './sources/reliefweb.mjs';
import { briefing as who } from './sources/who.mjs';
import { briefing as ofac } from './sources/ofac.mjs';
import { briefing as opensanctions } from './sources/opensanctions.mjs';
import { briefing as adsb } from './sources/adsb.mjs';

// === Tier 2: Economic & Financial ===
import { briefing as fred } from './sources/fred.mjs';
import { briefing as treasury } from './sources/treasury.mjs';
import { briefing as bls } from './sources/bls.mjs';
import { briefing as eia } from './sources/eia.mjs';
import { briefing as gscpi } from './sources/gscpi.mjs';
import { briefing as usaspending } from './sources/usaspending.mjs';
import { briefing as comtrade } from './sources/comtrade.mjs';

// === Tier 3: Weather, Environment, Technology, Social ===
import { briefing as noaa } from './sources/noaa.mjs';
import { briefing as epa } from './sources/epa.mjs';
import { briefing as patents } from './sources/patents.mjs';
import { briefing as bluesky } from './sources/bluesky.mjs';
import { briefing as reddit } from './sources/reddit.mjs';
import { briefing as telegram } from './sources/telegram.mjs';
import { briefing as kiwisdr } from './sources/kiwisdr.mjs';

// === Tier 4: Space & Satellites ===
import { briefing as space } from './sources/space.mjs';

// === Tier 5: Live Market Data ===
import { briefing as yfinance } from './sources/yfinance.mjs';

// === Tier 6: Cyber & Infrastructure ===
import { briefing as cisaKev } from './sources/cisa-kev.mjs';
import { briefing as cloudflareRadar } from './sources/cloudflare-radar.mjs';

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

// Source registry — [display name, fn]. Keys are read from process.env at sweep time.
const SOURCES = [
  // Tier 1: Core OSINT & Geopolitical
  ['GDELT', gdelt],
  ['OpenSky', opensky],
  ['FIRMS', firms],
  ['Maritime', ships],
  ['Safecast', safecast],
  ['ACLED', acled],
  ['ReliefWeb', reliefweb],
  ['WHO', who],
  ['OFAC', ofac],
  ['OpenSanctions', opensanctions],
  ['ADS-B', adsb],
  // Tier 2: Economic & Financial
  ['FRED', () => fred(process.env.FRED_API_KEY)],
  ['Treasury', treasury],
  ['BLS', () => bls(process.env.BLS_API_KEY)],
  ['EIA', () => eia(process.env.EIA_API_KEY)],
  ['GSCPI', gscpi],
  ['USAspending', usaspending],
  ['Comtrade', comtrade],
  // Tier 3: Weather, Environment, Technology, Social
  ['NOAA', noaa],
  ['EPA', epa],
  ['Patents', patents],
  ['Bluesky', bluesky],
  ['Reddit', reddit],
  ['Telegram', telegram],
  ['KiwiSDR', kiwisdr],
  // Tier 4: Space & Satellites
  ['Space', space],
  // Tier 5: Live Market Data
  ['YFinance', yfinance],
  // Tier 6: Cyber & Infrastructure
  ['CISA-KEV', cisaKev],
  ['Cloudflare-Radar', cloudflareRadar],
];

// Space is one adapter backed by three independently reported upstream providers.
export const SOURCE_COUNT = SOURCES.length + 2;

export async function fullBriefing() {
  console.error(`[Crucix] Starting intelligence sweep — ${SOURCE_COUNT} sources...`);
  const start = Date.now();

  const allPromises = SOURCES.map(([name, fn]) => runSource(name, fn));

  // Each runSource has its own 30s timeout, so allSettled will resolve
  // within ~30s even if APIs hang. Global timeout is a safety net.
  const results = await Promise.allSettled(allPromises);

  const sources = results.map(r => r.status === 'fulfilled' ? r.value : { status: 'failed', error: r.reason?.message });
  const totalMs = Date.now() - start;

  const output = {
    crucix: {
      version: VERSION,
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

  Object.assign(output.crucix, summarizeSourceHealth(output).counts);
  console.error(`[Crucix] Sweep complete in ${totalMs}ms — ${output.crucix.sourcesOk}/${output.crucix.sourcesQueried} healthy, ${output.crucix.sourcesDegraded} degraded, ${output.crucix.sourcesUnconfigured} unconfigured, ${output.crucix.sourcesFailed} failed`);
  return output;
}

// Run and output when executed directly
const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryHref && import.meta.url === entryHref) {
  const data = await fullBriefing();
  console.log(JSON.stringify(data, null, 2));
}
