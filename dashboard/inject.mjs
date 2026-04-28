#!/usr/bin/env node
// Crucix Dashboard Data Synthesizer
// Reads runs/latest.json, fetches RSS news, generates signal-based ideas,
// and injects everything into dashboard/public/jarvis.html
//
// Exports synthesize(), generateIdeas(), fetchAllNews() for use by server.mjs

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import config from '../crucix.config.mjs';
import { createHash } from 'crypto';
import { createLLMProvider, OllamaProvider } from '../lib/llm/index.mjs';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';
import { buildSourceHealth } from '../lib/source-health.mjs';
import { buildEvidenceSummary } from '../lib/evidence-summary.mjs';
import { buildLlmCallTelemetry, combineLlmTelemetry } from '../lib/llm/telemetry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NEWS_LLM_BASE_URL = config.llm?.baseUrl || 'http://192.168.68.111:11434';

// === Helpers ===
const cyrillic = /[\u0400-\u04FF]/;
function isEnglish(text) {
  if (!text) return false;
  return !cyrillic.test(text.substring(0, 80));
}

// === Geo-tagging keyword map ===
const geoKeywords = {
  'Ukraine':[49,32],'Russia':[56,38],'Moscow':[55.7,37.6],'Kyiv':[50.4,30.5],
  'China':[35,105],'Beijing':[39.9,116.4],'Iran':[32,53],'Tehran':[35.7,51.4],
  'Israel':[31.5,35],'Gaza':[31.4,34.4],'Palestine':[31.9,35.2],
  'Syria':[35,38],'Iraq':[33,44],'Saudi':[24,45],'Yemen':[15,48],'Lebanon':[34,36],
  'India':[20,78],'Japan':[36,138],'Korea':[37,127],'Pyongyang':[39,125.7],
  'Taiwan':[23.5,121],'Philippines':[13,122],'Myanmar':[20,96],
  'Canada':[56,-96],'Mexico':[23,-102],'Brazil':[-14,-51],'Argentina':[-38,-63],
  'Colombia':[4,-74],'Venezuela':[7,-66],'Cuba':[22,-80],'Chile':[-35,-71],
  'Germany':[51,10],'France':[46,2],'UK':[54,-2],'Britain':[54,-2],'London':[51.5,-0.1],
  'Spain':[40,-4],'Italy':[42,12],'Poland':[52,20],'NATO':[50,4],'EU':[50,4],
  'Turkey':[39,35],'Greece':[39,22],'Romania':[46,25],'Finland':[64,26],'Sweden':[62,15],
  'Africa':[0,20],'Nigeria':[10,8],'South Africa':[-30,25],'Kenya':[-1,38],
  'Egypt':[27,30],'Libya':[27,17],'Sudan':[13,30],'Ethiopia':[9,38],
  'Somalia':[5,46],'Congo':[-4,22],'Uganda':[1,32],'Morocco':[32,-6],
  'Pakistan':[30,70],'Afghanistan':[33,65],'Bangladesh':[24,90],
  'Australia':[-25,134],'Indonesia':[-2,118],'Thailand':[15,100],
  'US':[39,-98],'America':[39,-98],'Washington':[38.9,-77],'Pentagon':[38.9,-77],
  'Trump':[38.9,-77],'White House':[38.9,-77],
  'Wall Street':[40.7,-74],'New York':[40.7,-74],'California':[37,-120],
  'Nepal':[28,84],'Cambodia':[12.5,105],'Malawi':[-13.5,34],'Burundi':[-3.4,29.9],
  'Oman':[21,57],'Netherlands':[52.1,5.3],'Gabon':[-0.8,11.6],
  'Peru':[-10,-76],'Ecuador':[-2,-78],'Bolivia':[-17,-65],
  'Singapore':[1.35,103.8],'Malaysia':[4.2,101.9],'Vietnam':[16,108],
  'Algeria':[28,3],'Tunisia':[34,9],'Zimbabwe':[-20,30],'Mozambique':[-18,35],
  // Americas expansion
  'Texas':[31,-100],'Florida':[28,-82],'Chicago':[41.9,-87.6],'Los Angeles':[34,-118],
  'San Francisco':[37.8,-122.4],'Seattle':[47.6,-122.3],'Miami':[25.8,-80.2],
  'Toronto':[43.7,-79.4],'Ottawa':[45.4,-75.7],'Vancouver':[49.3,-123.1],
  'São Paulo':[-23.5,-46.6],'Rio':[-22.9,-43.2],'Buenos Aires':[-34.6,-58.4],
  'Bogotá':[4.7,-74.1],'Lima':[-12,-77],'Santiago':[-33.4,-70.7],
  'Caracas':[10.5,-66.9],'Havana':[23.1,-82.4],'Panama':[9,-79.5],
  'Guatemala':[14.6,-90.5],'Honduras':[14.1,-87.2],'El Salvador':[13.7,-89.2],
  'Costa Rica':[10,-84],'Jamaica':[18.1,-77.3],'Haiti':[19,-72],
  'Dominican':[18.5,-70],'Puerto Rico':[18.2,-66.5],
  // More Asia-Pacific
  'Sri Lanka':[7,80],'Hong Kong':[22.3,114.2],'Taipei':[25,121.5],
  'Seoul':[37.6,127],'Osaka':[34.7,135.5],'Mumbai':[19.1,72.9],
  'Delhi':[28.6,77.2],'Shanghai':[31.2,121.5],'Shenzhen':[22.5,114.1],
  'Auckland':[-36.8,174.8],'Papua New Guinea':[-6.3,147],
  // More Europe
  'Berlin':[52.5,13.4],'Paris':[48.9,2.3],'Madrid':[40.4,-3.7],
  'Rome':[41.9,12.5],'Warsaw':[52.2,21],'Prague':[50.1,14.4],
  'Vienna':[48.2,16.4],'Budapest':[47.5,19.1],'Bucharest':[44.4,26.1],
  'Kyiv':[50.4,30.5],'Oslo':[59.9,10.7],'Copenhagen':[55.7,12.6],
  'Brussels':[50.8,4.4],'Zurich':[47.4,8.5],'Dublin':[53.3,-6.3],
  'Lisbon':[38.7,-9.1],'Athens':[37.9,23.7],'Minsk':[53.9,27.6],
  // More Africa
  'Nairobi':[-1.3,36.8],'Lagos':[6.5,3.4],'Accra':[5.6,-0.2],
  'Addis Ababa':[9,38.7],'Cape Town':[-33.9,18.4],'Johannesburg':[-26.2,28],
  'Kinshasa':[-4.3,15.3],'Khartoum':[15.6,32.5],'Mogadishu':[2.1,45.3],
  'Dakar':[14.7,-17.5],'Abuja':[9.1,7.5],
  // Tech/Economy keywords with US locations
  'Fed':[38.9,-77],'Congress':[38.9,-77],'Senate':[38.9,-77],
  'Silicon Valley':[37.4,-122],'NASA':[28.6,-80.6],'Pentagon':[38.9,-77],
  'IMF':[38.9,-77],'World Bank':[38.9,-77],'UN':[40.7,-74],
};

const NEWS_REGION_ALIASES = {
  us: 'United States', 'u.s.': 'United States', 'u.s': 'United States', america: 'United States', american: 'United States',
  eu: 'EU', 'e.u.': 'EU', uk: 'UK', 'u.k.': 'UK'
};

const NEWS_GENERIC_REGIONS = new Set(['UN', 'Congress', 'Fed', 'Senate', 'IMF', 'World Bank', 'Trump', 'White House', 'US', 'America', 'UK', 'Britain', 'EU', 'NATO']);

function normalizeNewsRegionLabel(region = '') {
  const cleaned = String(region || '').trim();
  if (!cleaned) return '';
  return NEWS_REGION_ALIASES[cleaned.toLowerCase()] || cleaned;
}

function buildPlacementDescriptor({ lat, lon, region, precision, basis, placementClass }) {
  return { lat, lon, region, precision, basis, placementClass };
}

function findGeoKeyword(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  const matches = [];
  for (const [keyword, [lat, lon]] of Object.entries(geoKeywords)) {
    const idx = lower.indexOf(keyword.toLowerCase());
    if (idx === -1) continue;
    matches.push({ keyword, lat, lon, idx, len: keyword.length, generic: NEWS_GENERIC_REGIONS.has(keyword) });
  }
  if (!matches.length) return null;
  const concreteMatches = matches.filter(m => !m.generic);
  const pool = concreteMatches.length ? concreteMatches : matches;
  pool.sort((a, b) => a.idx - b.idx || b.len - a.len);
  const best = pool[0];
  const precision = best.len > 10 ? 'subregion' : 'country';
  return buildPlacementDescriptor({ lat: best.lat, lon: best.lon, region: best.keyword, precision, basis: 'keyword', placementClass: `inferred-${precision}` });
}

function geoTagText(text) {
  return findGeoKeyword(text);
}

function buildTelegramNewsCandidates(posts = []) {
  const candidates = [];
  for (const post of posts) {
    const rawText = String(post?.text || '').replace(/\s+/g, ' ').trim();
    if (!rawText) continue;
    const geo = geoTagText(rawText);
    if (!geo) continue;
    candidates.push({
      title: rawText.substring(0, 160),
      source: post?.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram',
      date: post?.date || null,
      url: null,
      lat: geo.lat,
      lon: geo.lon,
      region: geo.region,
      placementPrecision: geo.precision,
      placementBasis: 'telegram-urgent',
      placementClass: geo.placementClass,
      urgent: true,
      urgentFlags: Array.isArray(post?.urgentFlags) ? post.urgentFlags : [],
    });
  }
  return candidates;
}

function resolveNewsPlacement(item = {}) {
  if (Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
    return buildPlacementDescriptor({
      lat: item.lat,
      lon: item.lon,
      region: normalizeNewsRegionLabel(item.region) || item.source || 'Source-native',
      precision: item.placementPrecision || 'source-native',
      basis: item.placementBasis || 'source-native',
      placementClass: item.placementClass || 'source-native',
    });
  }

  const titleGeo = findGeoKeyword(item.title);
  if (titleGeo && !NEWS_GENERIC_REGIONS.has(titleGeo.region)) return titleGeo;

  const normalizedRegion = normalizeNewsRegionLabel(item.region);
  const regionGeo = normalizedRegion ? findGeoKeyword(normalizedRegion) : null;
  if (regionGeo && !NEWS_GENERIC_REGIONS.has(regionGeo.region)) {
    return buildPlacementDescriptor({ ...regionGeo, precision: 'region', basis: 'region', placementClass: 'inferred-region' });
  }

  const sourceGeo = RSS_SOURCE_FALLBACKS[item.source];
  if (sourceGeo) return buildPlacementDescriptor({ ...sourceGeo, precision: 'source-fallback', basis: 'source', placementClass: 'source-fallback' });
  return null;
}

function quoteConfidence(q) {
  return q?.validation?.confidence || 'high';
}

function quoteFlags(q) {
  return q?.validation?.flags || [];
}

function normalizeRegion(text = '') {
  const lower = text.toLowerCase();
  if (/iran|tehran|hormuz|israel|lebanon|gaza|middle east|bab el-mandeb|red sea/.test(lower)) return 'middle_east';
  if (/ukraine|melitopol|chernobyl|zaporizhzhia|russia|baltic/.test(lower)) return 'ukraine';
  if (/taiwan|south china sea|china|beijing|taipei/.test(lower)) return 'taiwan';
  if (/korea|seoul|pyongyang/.test(lower)) return 'korea';
  if (/sudan|horn of africa|ethiopia|somalia|sahel/.test(lower)) return 'horn';
  if (/panama/.test(lower)) return 'panama';
  return 'global';
}

function groupUrgentByRegion(posts = []) {
  return posts.reduce((acc, post) => {
    const region = normalizeRegion(`${post.channel || ''} ${post.text || ''}`);
    if (!acc[region]) acc[region] = [];
    acc[region].push(post);
    return acc;
  }, {});
}

function regionWeight(region = 'global') {
  return {
    middle_east: 1.0,
    taiwan: 0.95,
    ukraine: 0.9,
    korea: 0.8,
    horn: 0.7,
    panama: 0.65,
    global: 0.5,
  }[region] ?? 0.5;
}

function signalAgeHours(nowTs, candidateTs) {
  const now = nowTs ? new Date(nowTs).getTime() : Date.now();
  const ts = candidateTs ? new Date(candidateTs).getTime() : NaN;
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, (now - ts) / 3600000);
}

function suspectDecayMultiplier(ageHours) {
  if (ageHours <= 2) return 1;
  if (ageHours <= 6) return 0.75;
  if (ageHours <= 12) return 0.5;
  return 0.3;
}

function thermalByRegion(thermal = []) {
  const map = {};
  for (const region of thermal) {
    map[normalizeRegion(region.region)] = region;
  }
  return map;
}

function airByRegion(air = []) {
  const map = {};
  for (const region of air) {
    map[normalizeRegion(region.region)] = region;
  }
  return map;
}

function buildCorroboratedSignals({ tg = {}, thermal = [], air = [], maritime = {}, markets = {}, nuke = [], health = [], nowTs = null }) {
  const corroborated = [];
  const add = (category, signal, confidence, reason, details = {}) => corroborated.push({ category, signal, confidence, reason, ...details });

  const urgentByRegion = groupUrgentByRegion(tg.urgent || []);
  const thermalMap = thermalByRegion(thermal);
  const airMap = airByRegion(air);

  for (const [region, posts] of Object.entries(urgentByRegion)) {
    if (region === 'global' || posts.length < 3) continue;
    const t = thermalMap[region];
    const a = airMap[region];
    const thermalSupport = (t?.night || 0) >= 10 || (t?.fires?.length || 0) >= 3;
    const airSupport = (a?.total || 0) > 0 || (a?.noCallsign || 0) > 0;
    if (thermalSupport || airSupport) {
      add('osint', `Regional corroboration: ${region}`, 'high', `${posts.length} urgent posts align with ${thermalSupport ? 'thermal' : 'air'} activity in the same region`, {
        region,
        regionalWeight: regionWeight(region),
        urgentPosts: posts.length,
        thermalNight: t?.night || 0,
        airTotal: a?.total || 0,
        evidenceSource: thermalSupport ? 'FIRMS' : 'OpenSky',
        sourceHealth: thermalSupport ? 'hard-data' : 'degraded-air-ok',
        freshestTs: posts.map(p => p.date).filter(Boolean).sort().pop() || nowTs,
      });
    }
  }

  const maritimeDisruptions = maritime?.disruptionChecks?.filter(check => check.disrupted) || [];
  if (maritimeDisruptions.length) {
    add('maritime', 'Shipping disruption reporting', 'medium', `${maritimeDisruptions.length} chokepoints have clustered shipping disruption headlines`, {
      region: 'global',
      regionalWeight: 0.75,
      chokepoints: maritimeDisruptions.map(x => x.label),
      evidenceSource: maritimeDisruptions[0]?.evidenceSource || 'news',
      evidence: maritimeDisruptions.flatMap(x => (x.headlines || []).map(h => ({
        title: h.title,
        url: h.link,
        source: h.source || x.evidenceSource || 'news',
      }))).slice(0, 6),
    });
  }

  if ((markets?.vix?.changePct || 0) > 0 && health.filter(h => h.err).length === 0) {
    add('market', 'Market move with clean source health', 'medium', 'Live market inputs are available without current source degradation', {
      vixChangePct: markets?.vix?.changePct || 0,
      evidenceSource: 'YFinance',
      sourceHealth: 'clean',
    });
  }

  if (nuke.some(site => site.anom === false) && !nuke.some(site => site.anom)) {
    add('nuclear', 'No multi-site nuclear confirmation', 'medium', 'Only isolated nuclear/radiation anomalies are present, with no multi-site corroboration', {
      evidenceSource: 'Safecast',
      sourceHealth: 'clean',
    });
  }

  return corroborated;
}

function buildSuspectSignals({ yfQuotes = {}, health = [], airMeta = null, nuke = [], nukeSignals = [], energy = {}, metals = {}, markets = {}, tg = {}, thermal = [], air = [], chokepoints = [], maritime = {}, nowTs = null }) {
  const suspects = [];

  const add = (category, signal, confidence, reason, details = {}) => {
    const ageHours = signalAgeHours(nowTs, details.freshestTs || details.timestamp || details.evidence?.[0]?.pubDate || null);
    const decayMultiplier = suspectDecayMultiplier(ageHours);
    suspects.push({ category, signal, confidence, reason, ageHours, decayMultiplier, ...details });
  };

  for (const symbol of ['BZ=F', 'CL=F', 'NG=F', 'GC=F', 'SI=F', '^VIX', 'TLT', 'HYG']) {
    const q = yfQuotes[symbol];
    if (!q) continue;
    const confidence = quoteConfidence(q);
    if (confidence !== 'high') {
      add('market', q.name || symbol, confidence, quoteFlags(q).join('; '), {
        symbol,
        rawPrice: q.price,
        effectivePrice: q.effectivePrice ?? q.price,
        changePct: q.changePct,
      });
    }
  }

  if (airMeta?.error) {
    add('source', 'OpenSky air activity', 'medium', airMeta.error, {
      fallback: Boolean(airMeta.fallback),
      source: airMeta.source,
      evidenceSource: airMeta.source || 'OpenSky',
      sourceHealth: 'degraded',
    });
  }

  for (const site of nuke.filter(n => n.anom)) {
    add('nuclear', site.site, 'low', `Radiation anomaly flagged at ${site.cpm} CPM and requires independent verification`, {
      cpm: site.cpm,
      readings: site.n,
      evidenceSource: 'Safecast',
      sourceHealth: 'single-source',
    });
  }

  for (const signal of nukeSignals || []) {
    if (/ELEVATED RADIATION|anomaly/i.test(signal)) {
      add('nuclear', 'Safecast anomaly signal', 'low', signal);
    }
  }

  const failedSources = health.filter(h => h.err).map(h => h.n);
  if (failedSources.length >= 2) {
    add('source', 'Multiple source degradations', 'medium', `${failedSources.length} sources degraded: ${failedSources.join(', ')}`);
  }

  if (energy?.signals?.length) {
    for (const signal of energy.signals.filter(s => /downgraded|low confidence/i.test(s))) {
      add('market', 'Energy signal downgrade', 'medium', signal);
    }
  }

  if (metals?.goldChangePct != null && Math.abs(metals.goldChangePct) >= 4 && !suspects.some(s => s.signal === 'Gold')) {
    add('market', 'Gold', 'medium', `Large gold move of ${metals.goldChangePct}% without explicit corroboration check result`);
  }

  if (markets?.vix?.changePct != null && Math.abs(markets.vix.changePct) >= 20 && !suspects.some(s => s.signal === 'VIX')) {
    add('market', 'VIX', 'medium', `Large VIX move of ${markets.vix.changePct}% should be cross-checked against equities and credit`);
  }

  const urgentPosts = tg?.urgent || [];
  const urgentCount = urgentPosts.length;
  const thermalTotal = thermal.reduce((sum, t) => sum + (t.det || 0), 0);
  const thermalNight = thermal.reduce((sum, t) => sum + (t.night || 0), 0);
  const airTotal = air.reduce((sum, a) => sum + (a.total || 0), 0);
  const chokepointCoverage = chokepoints.length;
  const urgentByRegion = groupUrgentByRegion(urgentPosts);
  const thermalMap = thermalByRegion(thermal);
  const airMap = airByRegion(air);

  if (urgentCount >= 8 && thermalTotal === 0 && airTotal === 0) {
    add('osint', 'Telegram urgent cluster', 'medium', `Telegram shows ${urgentCount} urgent posts without thermal or air corroboration in the same sweep`, {
      region: 'global',
      regionalWeight: regionWeight('global'),
      urgentPosts: urgentCount,
      thermalTotal,
      airTotal,
      freshestTs: urgentPosts.map(p => p.date).filter(Boolean).sort().pop() || nowTs,
    });
  }

  const blockadePosts = urgentPosts.filter(p => (p.urgentFlags || []).includes('blockade'));
  const maritimeSupport = maritime?.disruptionChecks?.filter(check => check.disrupted).length || 0;
  if (blockadePosts.length >= 2 && chokepointCoverage > 0 && airTotal === 0 && maritimeSupport === 0) {
    add('osint', 'Blockade / chokepoint claims', 'medium', `${blockadePosts.length} Telegram blockade-related posts are present, but neither air nor maritime disruption checks confirm them`, {
      region: 'middle_east',
      regionalWeight: regionWeight('middle_east'),
      urgentPosts: blockadePosts.length,
      airTotal,
      chokepoints: chokepointCoverage,
      maritimeSupport,
      evidenceSource: 'Telegram',
      sourceHealth: 'osint-only',
      freshestTs: blockadePosts.map(p => p.date).filter(Boolean).sort().pop() || nowTs,
      evidence: (maritime?.disruptionChecks || []).flatMap(check => (check.headlines || []).map(h => ({
        title: h.title,
        url: h.link,
        source: h.source || check.evidenceSource || 'news',
      }))).slice(0, 4),
    });
  }

  const conflictPosts = urgentPosts.filter(p => (p.urgentFlags || []).some(f => ['missile', 'strike', 'explosion', 'drone', 'bombardment'].includes(f)));
  for (const [region, posts] of Object.entries(urgentByRegion)) {
    if (region === 'global') continue;
    const kineticRegionalPosts = posts.filter(p => (p.urgentFlags || []).some(f => ['missile', 'strike', 'explosion', 'drone', 'bombardment'].includes(f)));
    const regionThermal = thermalMap[region];
    const regionAir = airMap[region];
    const regionThermalNight = regionThermal?.night || 0;
    const regionThermalTotal = regionThermal?.det || 0;
    const regionAirTotal = regionAir?.total || 0;

    if (kineticRegionalPosts.length >= 3 && regionThermalNight < 10 && regionThermalTotal < 50 && regionAirTotal === 0) {
      add('osint', `Kinetic conflict chatter: ${region}`, 'medium', `${kineticRegionalPosts.length} regional kinetic posts are not matched by regional thermal or air activity`, {
        region,
        regionalWeight: regionWeight(region),
        urgentPosts: kineticRegionalPosts.length,
        thermalTotal: regionThermalTotal,
        thermalNight: regionThermalNight,
        airTotal: regionAirTotal,
        evidenceSource: 'Telegram',
        sourceHealth: 'osint-only',
        freshestTs: kineticRegionalPosts.map(p => p.date).filter(Boolean).sort().pop() || nowTs,
      });
    }
  }

  if (conflictPosts.length >= 5 && thermalNight < 10 && thermalTotal < 50) {
    add('osint', 'Kinetic conflict chatter', 'medium', `${conflictPosts.length} kinetic Telegram posts are not matched by unusual thermal activity this sweep`, {
      urgentPosts: conflictPosts.length,
      thermalTotal,
      thermalNight,
    });
  }

  for (const region of thermal) {
    const highIntensity = region.fires?.filter(f => (f.frp || 0) > 10).length || 0;
    const normRegion = normalizeRegion(region.region);
    const regionalUrgent = urgentByRegion[normRegion]?.length || 0;
    const regionalAir = airMap[normRegion]?.total || 0;
    if (highIntensity >= 8 && regionalUrgent === 0) {
      add('thermal', region.region, 'medium', `${highIntensity} high-intensity thermal detections without supporting urgent Telegram chatter in the same region`, {
        thermalDetections: region.det,
        highIntensity,
      });
    }
    if (region.night >= 100 && regionalAir === 0) {
      add('thermal', `${region.region} night activity`, 'medium', `${region.night} night detections with no corroborating regional air activity available`, {
        thermalNight: region.night,
        airTotal: regionalAir,
        evidenceSource: 'FIRMS',
        sourceHealth: regionalAir === 0 ? 'air-missing' : 'clean',
      });
    }
  }

  if (airMeta?.fallback && urgentCount >= 4) {
    add('air', 'Air corroboration degraded', 'medium', `Using fallback or degraded air picture while ${urgentCount} urgent Telegram posts are active`, {
      urgentPosts: urgentCount,
      fallback: true,
    });
  }

  return suspects;
}

function sanitizeExternalUrl(raw) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sumAirHotspots(hotspots = []) {
  return hotspots.reduce((sum, hotspot) => sum + (hotspot.totalAircraft || 0), 0);
}

function summarizeAirHotspots(hotspots = []) {
  return hotspots.map(h => ({
    region: h.region,
    total: h.totalAircraft || 0,
    noCallsign: h.noCallsign || 0,
    highAlt: h.highAltitude || 0,
    top: Object.entries(h.byCountry || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
  }));
}

function loadOpenSkyFallback(currentTimestamp) {
  const runsDir = join(ROOT, 'runs');
  if (!existsSync(runsDir)) return null;

  const currentMs = currentTimestamp ? new Date(currentTimestamp).getTime() : NaN;
  const files = readdirSync(runsDir)
    .filter(name => /^briefing_.*\.json$/.test(name))
    .sort()
    .reverse();

  for (const file of files) {
    const filePath = join(runsDir, file);
    try {
      const prior = JSON.parse(readFileSync(filePath, 'utf8'));
      const priorTimestamp = prior.sources?.OpenSky?.timestamp || prior.crucix?.timestamp || null;
      if (priorTimestamp && Number.isFinite(currentMs) && new Date(priorTimestamp).getTime() >= currentMs) continue;

      const hotspots = prior.sources?.OpenSky?.hotspots || [];
      if (sumAirHotspots(hotspots) > 0) {
        return { file, timestamp: priorTimestamp, hotspots };
      }
    } catch {
      // Ignore unreadable historical runs and continue searching backward.
    }
  }

  return null;
}

// === RSS Fetching ===
async function fetchRSS(url, source) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim();
      const link = sanitizeExternalUrl((block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/)?.[1] || '').trim());
      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      if (title && title !== source) items.push({ title, date: pubDate, source, url: link || undefined });
    }
    return items;
  } catch (e) {
    console.log(`RSS fetch failed (${source}):`, e.message);
    return [];
  }
}

const RSS_SOURCE_FALLBACKS = {
  'SBS Australia': { lat: -35.2809, lon: 149.13, region: 'Australia' },
  'Indian Express': { lat: 28.6139, lon: 77.209, region: 'India' },
  'The Hindu': { lat: 13.0827, lon: 80.2707, region: 'India' },
  'MercoPress': { lat: -34.9011, lon: -56.1645, region: 'Uruguay' },
  'Africa News': { lat: 9.082, lon: 8.6753, region: 'Africa' },
  'RFI': { lat: 48.8566, lon: 2.3522, region: 'France' },
  'Euronews': { lat: 50, lon: 4, region: 'EU' }
};
const REGIONAL_NEWS_SOURCES = ['MercoPress', 'Indian Express', 'The Hindu', 'SBS Australia'];
const NEWS_REGION_TUNING = {
  Iran: { promptBias: 'Focus on whether Iran headlines are the same strike, negotiation, or nuclear development story before splitting them.', repairTimeout: 60000, maxRetries: 1 },
  Israel: { promptBias: 'Separate ceasefire, strike, hostage, and cabinet/politics stories unless the headline clearly refers to the same event.', repairTimeout: 60000, maxRetries: 1 },
  India: { promptBias: 'Prefer not to merge domestic politics and security stories unless the headline overlap is explicit.', repairTimeout: 50000, maxRetries: 1 },
  'South Africa': { promptBias: 'Treat corruption, policing, and coalition politics as separate stories unless they share the same named event.', repairTimeout: 50000, maxRetries: 1 },
  default: { promptBias: 'Merge only clear same-event duplicates. When uncertain, keep stories separate.', repairTimeout: 45000, maxRetries: 1 }
};

export async function fetchAllNews() {
  const feeds = [
    // Global
    ['http://feeds.bbci.co.uk/news/world/rss.xml', 'BBC'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'NYT'],
    ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
    // USA
    ['https://feeds.npr.org/1001/rss.xml', 'NPR'],
    ['https://feeds.bbci.co.uk/news/technology/rss.xml', 'BBC Tech'],
    ['http://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'BBC Science'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/Americas.xml', 'NYT Americas'],
    // Europe
    ['https://rss.dw.com/rdf/rss-en-all', 'DW'],
    ['https://www.france24.com/en/rss', 'France 24'],
    ['https://www.euronews.com/rss?format=mrss', 'Euronews'],
    // Africa & Cameroon region
    ['https://rss.dw.com/rdf/rss-en-africa', 'DW Africa'],
    ['https://www.rfi.fr/en/rss', 'RFI'],
    ['https://www.africanews.com/feed/rss', 'Africa News'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml', 'NYT Africa'],
    // Asia-Pacific
    ['https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml', 'NYT Asia'],
    ['https://www.sbs.com.au/news/topic/australia/feed', 'SBS Australia'],
    // India
    ['https://indianexpress.com/section/india/feed/', 'Indian Express'],
    ['https://www.thehindu.com/news/national/feeder/default.rss', 'The Hindu'],
    // South America
    ['https://en.mercopress.com/rss/latin-america', 'MercoPress'],
  ];

  const results = await Promise.allSettled(
    feeds.map(([url, source]) => fetchRSS(url, source))
  );

  const allNews = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // De-duplicate and geo-tag
  const seen = new Set();
  const geoNews = [];
  for (const item of allNews) {
    const key = item.title.substring(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const geo = resolveNewsPlacement(item);
    if (geo) {
      geoNews.push({
        title: item.title.substring(0, 100),
        source: item.source,
        date: item.date,
        url: item.url,
        lat: geo.lat,
        lon: geo.lon,
        region: geo.region,
        placementPrecision: geo.precision,
        placementBasis: geo.basis,
        placementClass: geo.placementClass,
      });
    }
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filtered = geoNews.filter(n => !n.date || new Date(n.date) >= cutoff);
  filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const selected = [];
  const selectedKeys = new Set();
  const keyFor = item => `${item.source}|${item.title}|${item.date}`;
  const pushUnique = item => {
    const key = keyFor(item);
    if (selectedKeys.has(key)) return;
    selected.push(item);
    selectedKeys.add(key);
  };

  // Reserve a little space so newly-added regional feeds are not crowded out by larger globals.
  for (const source of REGIONAL_NEWS_SOURCES) {
    filtered.filter(item => item.source === source).slice(0, 2).forEach(pushUnique);
  }
  filtered.forEach(pushUnique);
  return selected.slice(0, 50);
}

function stripHtmlEntities(text = '') {
  return String(text || '')
    .replace(/&#39;/g, "'")
    .replace(/&#33;/g, '!')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '');
}

function normalizeStoryKey(text = '') {
  return stripHtmlEntities(String(text || '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !['the','and','for','with','from','that','this','into','after','amid','over','under','will','have','has','had','says','say','news','latest','live','update','updates'].includes(w))
    .slice(0, 6)
    .join('_') || 'story';
}

function storySummaryFallback(title = '') {
  return stripHtmlEntities(title).substring(0, 120);
}

function stableClusterOffset(key = '', count = 0) {
  let hash = 0;
  const s = `${key}:${count}`;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  const angle = Math.abs(hash % 360) * (Math.PI / 180);
  const radius = Math.min(2.2, 0.45 + Math.max(0, count - 1) * 0.18);
  return { lat: +(Math.sin(angle) * radius).toFixed(3), lon: +(Math.cos(angle) * radius).toFixed(3) };
}

function significantStoryTokens(text = '') {
  return normalizeStoryKey(text).split('_').filter(Boolean);
}

function titleSimilarity(a = '', b = '') {
  const A = new Set(significantStoryTokens(a));
  const B = new Set(significantStoryTokens(b));
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  for (const token of A) if (B.has(token)) overlap += 1;
  return overlap / Math.max(Math.min(A.size, B.size), 1);
}

function heuristicStoryGroup(news = []) {
  const assignments = [];
  const groups = [];
  news.forEach((item, idx) => {
    const region = normalizeNewsRegionLabel(item.region || 'Global');
    const match = groups.find(g => g.region === region && titleSimilarity(g.seedTitle, item.title) >= 0.5);
    if (match) {
      match.items.push(idx);
      assignments.push({ idx, storyKey: match.storyKey, subject: match.subject, primaryRegion: region, confidence: 'heuristic' });
      return;
    }
    const subject = storySummaryFallback(item.title).split(':')[0].substring(0, 90);
    const storyKey = normalizeStoryKey(item.title);
    groups.push({ region, seedTitle: item.title, storyKey, subject, items: [idx] });
    assignments.push({ idx, storyKey, subject, primaryRegion: region, confidence: 'heuristic' });
  });
  return assignments;
}

function buildLlmCandidateSets(news = [], heuristic = []) {
  const byRegion = new Map();
  news.forEach((item, idx) => {
    const region = normalizeNewsRegionLabel(item.region || heuristic[idx]?.primaryRegion || 'Global');
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push({ idx, item, heuristic: heuristic[idx] });
  });
  const candidateSets = [];
  for (const [region, items] of byRegion.entries()) {
    const scored = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const score = titleSimilarity(items[i].item.title, items[j].item.title);
        if (score >= 0.22) scored.push({ a: items[i], b: items[j], score });
      }
    }
    if (scored.length) {
      scored.sort((x, y) => y.score - x.score);
      const deduped = Array.from(new Map(scored.flatMap(x => [[x.a.idx, x.a], [x.b.idx, x.b]])).values());
      candidateSets.push({ region, items: deduped.slice(0, 12), score: scored[0].score });
      continue;
    }
    if (items.length >= 2) {
      const recent = [...items].sort((a, b) => new Date(b.item.date || 0) - new Date(a.item.date || 0)).slice(0, Math.min(6, items.length));
      candidateSets.push({ region, items: recent, score: 0 });
    }
  }
  return candidateSets.sort((a, b) => b.items.length - a.items.length || b.score - a.score).slice(0, 6);
}

function getNewsLLMProvider(existingProvider = null) {
  if (existingProvider?.isConfigured && existingProvider.name === 'ollama') return existingProvider;
  if (config.llm?.provider === 'ollama' && config.llm?.model) {
    return new OllamaProvider({ model: config.llm.model, baseUrl: NEWS_LLM_BASE_URL });
  }
  return existingProvider;
}

function extractBalancedJsonFragment(text = '') {
  const input = String(text || '').trim();
  if (!input) return null;
  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || input;
  const starts = [];
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{' || ch === '[') starts.push(i);
  }
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{' || ch === '[') depth += 1;
      if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return candidate.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseClusterResponse(text = '', expectedLength = 0) {
  const fragment = extractBalancedJsonFragment(text);
  if (!fragment) return { ok: false, reason: 'no-json-match', parsed: null, fragment: null };
  let parsed;
  try {
    parsed = JSON.parse(fragment);
  } catch {
    return { ok: false, reason: 'json-parse-failed', parsed: null, fragment };
  }
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : null;
  if (!Array.isArray(items)) return { ok: false, reason: 'shape-mismatch', parsed: null, fragment };
  if (expectedLength && items.length !== expectedLength) return { ok: false, reason: 'shape-mismatch', parsed: items, fragment };
  return { ok: true, reason: null, parsed: items, fragment };
}

async function attemptClusterRepair(provider, rawText, slice, set, heuristic, news) {
  const system = 'You repair malformed model output into strict JSON only. Return no prose, no markdown.';
  const user = `Repair the prior clustering response into strict JSON. Return exactly one JSON object with key "items" containing exactly ${slice.length} objects. Schema per item: {idx:number, storyKey:string, subject:string, primaryRegion:string, confidence:string}. Valid idx values are only from this item list: ${JSON.stringify(slice)}. Prior response: ${JSON.stringify(String(rawText || '').slice(0, 6000))}`;
  const requestStartedAt = Date.now();
  const res = await provider.complete(system, user, { maxTokens: 1800, timeout: 45000 });
  const repairText = (res.text || '').trim();
  const parsed = parseClusterResponse(repairText, slice.length);
  return {
    repairText,
    parsed,
    telemetry: buildLlmCallTelemetry({
      surface: 'news-clustering-repair',
      provider: provider?.name || null,
      model: res?.model || provider?.model || null,
      usage: res?.usage || {},
      latencyMs: Date.now() - requestStartedAt,
      timeoutMs: 45000,
      completion: parsed.ok ? 'completed' : 'fallback-after-repair',
    }),
  };
}

function getRegionClusterTuning(region = '') {
  return NEWS_REGION_TUNING[region] || NEWS_REGION_TUNING.default;
}

function hashArtifactText(text = '') {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function compactArtifactSnippet(text = '', limit = 220) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit) || null;
}

function pushRepairArtifact(debug = {}, artifact = {}) {
  debug.repairArtifacts = Array.isArray(debug.repairArtifacts) ? debug.repairArtifacts : [];
  const maxSamples = Math.max(1, Number(config.review?.repairArtifactMaxSamples || 12));
  if (debug.repairArtifacts.length >= maxSamples) return;
  debug.repairArtifacts.push(artifact);
}

function buildRepairArtifact({ region = '', itemCount = 0, stage = 'initial', reason = 'unknown', rawText = '', repairText = '', retried = false, repairAttempted = false, fragment = null, error = null, provider = null, model = null, promptSystem = '', promptUser = '', repairSystem = '', repairUser = '', tuning = null } = {}) {
  return {
    region: region || 'unknown',
    itemCount: itemCount || 0,
    stage,
    reason,
    retried: Boolean(retried),
    repairAttempted: Boolean(repairAttempted),
    provider: provider || null,
    model: model || null,
    fingerprintVersion: 'cluster-repair-artifact-v1',
    promptFingerprint: promptSystem || promptUser ? hashArtifactText(`${promptSystem}\n---\n${promptUser}`) : null,
    repairPromptFingerprint: repairSystem || repairUser ? hashArtifactText(`${repairSystem}\n---\n${repairUser}`) : null,
    promptPreview: compactArtifactSnippet(promptUser, 160),
    repairPromptPreview: compactArtifactSnippet(repairUser, 160),
    tuningFingerprint: tuning ? hashArtifactText(JSON.stringify(tuning)) : null,
    tuning,
    rawHash: rawText ? hashArtifactText(rawText) : null,
    rawPreview: compactArtifactSnippet(rawText),
    fragmentHash: fragment ? hashArtifactText(fragment) : null,
    fragmentPreview: compactArtifactSnippet(fragment),
    repairHash: repairText ? hashArtifactText(repairText) : null,
    repairPreview: compactArtifactSnippet(repairText),
    error: error ? String(error).slice(0, 240) : null,
  };
}

function buildClusterFailureReview(debug = {}) {
  const perRegion = Array.isArray(debug.perRegion) ? debug.perRegion : [];
  const failures = perRegion.filter(entry => entry?.status === 'heuristic-fallback');
  const byReason = failures.reduce((acc, entry) => {
    const reason = entry.reason || 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const reviewItems = failures
    .map(entry => ({
      region: entry.region,
      reason: entry.reason || 'unknown',
      itemCount: entry.itemCount || 0,
      retried: Boolean(entry.retried),
      repairAttempted: Boolean(entry.repairAttempted),
      severity: entry.itemCount >= 5 ? 'high' : entry.itemCount >= 3 ? 'medium' : 'low',
      tuning: entry.tuning || null,
    }))
    .sort((a, b) => b.itemCount - a.itemCount || a.region.localeCompare(b.region))
    .slice(0, 6);
  return {
    failedRegionCount: failures.length,
    topReasons: Object.entries(byReason)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4),
    reviewItems,
  };
}

async function consolidateNewsWithLLM(news = [], llmProvider = null, options = {}) {
  const heuristic = heuristicStoryGroup(news);
  const mode = options.mode === 'off' ? 'off' : options.mode === 'force' ? 'force' : 'auto';
  const provider = mode === 'off' ? null : getNewsLLMProvider(llmProvider);
  const debug = {
    requestedMode: mode,
    provider: provider?.name || null,
    baseUrl: provider?.baseUrl || null,
    providerConfigured: Boolean(provider?.isConfigured),
    attempted: false,
    used: false,
    fallbackReason: null,
    candidateSets: [],
    candidateSetCount: 0,
    llmSuccessCount: 0,
    llmErrorCount: 0,
    heuristicFallbackCount: 0,
    repairAttemptCount: 0,
    repairSuccessCount: 0,
    retryCount: 0,
    backoffCount: 0,
    tunedRegionCount: 0,
    perRegion: [],
    repairArtifacts: [],
    telemetry: {
      clusteringCalls: [],
      repairCalls: [],
      clusteringSummary: null,
      repairSummary: null,
      aggregate: null,
    },
  };
  if (!news.length) {
    debug.fallbackReason = 'no-news';
    return { hints: heuristic, debug };
  }
  if (mode === 'off') {
    debug.fallbackReason = 'operator-disabled';
    return { hints: heuristic, debug };
  }
  if (!provider?.isConfigured) {
    debug.fallbackReason = mode === 'force' ? 'llm-unavailable-forced' : 'llm-unavailable';
    return { hints: heuristic, debug };
  }
  const candidateSets = buildLlmCandidateSets(news, heuristic);
  debug.attempted = candidateSets.length > 0;
  debug.candidateSetCount = candidateSets.length;
  debug.candidateSets = candidateSets.map(set => ({ region: set.region, idxs: set.items.map(x => x.idx) }));
  if (!candidateSets.length) {
    debug.fallbackReason = 'no-candidate-sets';
    return { hints: heuristic, debug };
  }
  let mergedHints = [...heuristic];
  for (const set of candidateSets) {
    const slice = set.items.map(({ idx, item, heuristic: h }) => ({ idx, title: item.title, source: item.source, region: item.region, heuristicStoryKey: h?.storyKey || null }));
    const tuning = getRegionClusterTuning(set.region);
    if (tuning !== NEWS_REGION_TUNING.default) debug.tunedRegionCount += 1;
    const system = 'You consolidate nearby news headlines into repeated-story groups. Return strict JSON only, no prose, no markdown fences.';
    const user = `Region: ${set.region}. ${tuning.promptBias} Group only these likely-near-duplicate headlines if they are about the same underlying event. Prefer the place impacted by the event, not the nationality of actors. Reuse the same storyKey for same-story items. Return exactly one JSON object with key "items" containing exactly ${slice.length} objects, one per idx. Schema per item: {idx:number, storyKey:string, subject:string, primaryRegion:string, confidence:string}. Use only these items: ${JSON.stringify(slice)}`;
    const repairSystem = 'You repair malformed model output into strict JSON only. Return no prose, no markdown.';
    const buildRepairUser = raw => `Repair the prior clustering response into strict JSON. Return exactly one JSON object with key "items" containing exactly ${slice.length} objects. Schema per item: {idx:number, storyKey:string, subject:string, primaryRegion:string, confidence:string}. Valid idx values are only from this item list: ${JSON.stringify(slice)}. Prior response: ${JSON.stringify(String(raw || '').slice(0, 6000))}`;
    let usedRepair = false;
    let repairAttempted = false;
    let retried = false;
    let parsedResult = { ok: false, reason: 'not-attempted', parsed: null };
    let lastText = '';
    try {
      for (let attempt = 0; attempt <= (tuning.maxRetries || 0); attempt++) {
        if (attempt > 0) {
          retried = true;
          debug.retryCount += 1;
          debug.backoffCount += 1;
          await new Promise(resolve => setTimeout(resolve, Math.min(800 * attempt, 1500)));
        }
        const retryNote = attempt > 0 ? ' Retry because the prior response was not parseable JSON. Return only the strict JSON object.' : '';
        const requestStartedAt = Date.now();
        const res = await provider.complete(system, `${user}${retryNote}`, { maxTokens: 1400, timeout: tuning.repairTimeout || 45000 });
        debug.telemetry.clusteringCalls.push(buildLlmCallTelemetry({
          surface: 'news-clustering',
          provider: provider?.name || null,
          model: res?.model || provider?.model || null,
          usage: res?.usage || {},
          latencyMs: Date.now() - requestStartedAt,
          timeoutMs: tuning.repairTimeout || 45000,
          completion: 'completed',
        }));
        lastText = (res.text || '').trim();
        debug[`raw_${set.region}${attempt > 0 ? `_retry${attempt}` : ''}`] = lastText.substring(0, 3000);
        parsedResult = parseClusterResponse(lastText, slice.length);
        if (parsedResult.ok) break;
      }
      if (!parsedResult.ok && ['no-json-match', 'json-parse-failed', 'shape-mismatch'].includes(parsedResult.reason)) {
        debug.repairAttemptCount += 1;
        repairAttempted = true;
        try {
          const repair = await attemptClusterRepair(provider, lastText, slice, set, heuristic, news);
          if (repair?.telemetry) debug.telemetry.repairCalls.push(repair.telemetry);
          debug[`repair_${set.region}`] = repair.repairText.substring(0, 3000);
          if (repair.parsed.ok) {
            parsedResult = repair.parsed;
            usedRepair = true;
            debug.repairSuccessCount += 1;
          } else {
            pushRepairArtifact(debug, buildRepairArtifact({
              region: set.region,
              itemCount: slice.length,
              stage: 'repair-failed',
              reason: repair.parsed.reason || parsedResult.reason || 'repair-failed',
              rawText: lastText,
              repairText: repair.repairText,
              retried,
              repairAttempted,
              fragment: repair.parsed.fragment || parsedResult.fragment || null,
              provider: provider?.name || null,
              model: provider?.model || null,
              promptSystem: system,
              promptUser: user,
              repairSystem,
              repairUser: buildRepairUser(lastText),
              tuning: { maxRetries: tuning.maxRetries || 0, repairTimeout: tuning.repairTimeout || 45000, promptBias: tuning.promptBias || null },
            }));
            parsedResult = repair.parsed;
          }
        } catch (repairErr) {
          debug[`repair_error_${set.region}`] = repairErr.message;
          pushRepairArtifact(debug, buildRepairArtifact({
            region: set.region,
            itemCount: slice.length,
            stage: 'repair-error',
            reason: parsedResult.reason || 'repair-error',
            rawText: lastText,
            retried,
            repairAttempted,
            fragment: parsedResult.fragment || null,
            error: repairErr.message,
            provider: provider?.name || null,
            model: provider?.model || null,
            promptSystem: system,
            promptUser: user,
            repairSystem,
            repairUser: buildRepairUser(lastText),
            tuning: { maxRetries: tuning.maxRetries || 0, repairTimeout: tuning.repairTimeout || 45000, promptBias: tuning.promptBias || null },
          }));
        }
      }
      if (!parsedResult.ok) {
        if (repairAttempted && !debug.repairArtifacts.some(artifact => artifact.region === set.region && artifact.reason === parsedResult.reason && artifact.rawHash === (lastText ? hashArtifactText(lastText) : null))) {
          pushRepairArtifact(debug, buildRepairArtifact({
            region: set.region,
            itemCount: slice.length,
            stage: 'fallback-after-repair',
            reason: parsedResult.reason,
            rawText: lastText,
            retried,
            repairAttempted,
            fragment: parsedResult.fragment || null,
            provider: provider?.name || null,
            model: provider?.model || null,
            promptSystem: system,
            promptUser: user,
            repairSystem,
            repairUser: buildRepairUser(lastText),
            tuning: { maxRetries: tuning.maxRetries || 0, repairTimeout: tuning.repairTimeout || 45000, promptBias: tuning.promptBias || null },
          }));
        }
        debug.heuristicFallbackCount += 1;
        debug.perRegion.push({ region: set.region, status: 'heuristic-fallback', reason: parsedResult.reason, itemCount: slice.length, repairAttempted, retried, tuning: { maxRetries: tuning.maxRetries || 0, repairTimeout: tuning.repairTimeout || 45000 } });
        continue;
      }
      const parsed = parsedResult.parsed;
      debug.used = true;
      debug.llmSuccessCount += 1;
      debug.perRegion.push({ region: set.region, status: usedRepair ? 'llm-repaired' : retried ? 'llm-used-retry' : 'llm-used', reason: usedRepair ? 'repair-success' : retried ? 'retry-success' : null, itemCount: slice.length, repairAttempted, retried, tuning: { maxRetries: tuning.maxRetries || 0, repairTimeout: tuning.repairTimeout || 45000 } });
      for (const x of parsed) {
        if (!Number.isInteger(x?.idx) || !news[x.idx]) continue;
        mergedHints[x.idx] = {
          idx: x.idx,
          storyKey: normalizeStoryKey(x.storyKey || heuristic[x.idx]?.storyKey || news[x.idx]?.title),
          subject: storySummaryFallback(x.subject || heuristic[x.idx]?.subject || news[x.idx]?.title),
          primaryRegion: normalizeNewsRegionLabel(x.primaryRegion || heuristic[x.idx]?.primaryRegion || news[x.idx]?.region || 'Global'),
          confidence: x.confidence || 'llm'
        };
      }
    } catch (err) {
      debug.llmErrorCount += 1;
      debug.heuristicFallbackCount += 1;
      debug[`error_${set.region}`] = err.message;
      debug.perRegion.push({ region: set.region, status: 'heuristic-fallback', reason: err.message, itemCount: slice.length, repairAttempted: false, retried, tuning: { maxRetries: tuning.maxRetries || 0, repairTimeout: tuning.repairTimeout || 45000 } });
    }
  }
  if (!debug.used && !debug.fallbackReason) debug.fallbackReason = debug.attempted ? 'all-candidate-sets-fell-back' : 'no-candidate-sets';
  if (debug.used && !debug.fallbackReason && debug.heuristicFallbackCount > 0) debug.fallbackReason = 'partial-fallback';
  debug.review = buildClusterFailureReview(debug);
  debug.repairArtifactCount = Array.isArray(debug.repairArtifacts) ? debug.repairArtifacts.length : 0;
  debug.telemetry.clusteringSummary = combineLlmTelemetry(debug.telemetry.clusteringCalls);
  debug.telemetry.repairSummary = combineLlmTelemetry(debug.telemetry.repairCalls);
  debug.telemetry.aggregate = combineLlmTelemetry([...debug.telemetry.clusteringCalls, ...debug.telemetry.repairCalls]);
  return { hints: mergedHints, debug };
}

function inferRuntimeSourceAttribution(item = {}) {
  const type = String(item?.type || '').trim().toLowerCase();
  const source = String(item?.source || '').trim();
  const normalizedSource = source.toLowerCase();
  if (type === 'telegram' || normalizedSource === 'telegram') return 'Telegram';
  if (type === 'reddit' || normalizedSource === 'reddit') return 'Reddit';
  if (type === 'bluesky' || normalizedSource === 'bluesky') return 'Bluesky';
  if (type === 'gdelt' || normalizedSource === 'gdelt') return 'GDELT';
  if (type === 'rss' || type === 'news' || !type) return 'GDELT';
  return source || 'unknown';
}

function summarizeClusterSources(cluster = {}) {
  const counts = new Map();
  for (const item of Array.isArray(cluster.items) ? cluster.items : []) {
    const source = String(item?.source || 'unknown').trim() || 'unknown';
    const type = String(item?.type || 'unknown').trim() || 'unknown';
    const runtimeSource = inferRuntimeSourceAttribution(item);
    const key = `${source}__${type}__${runtimeSource}`;
    const current = counts.get(key) || { source, type, runtimeSource, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  const entries = Array.from(counts.values()).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source) || a.type.localeCompare(b.type));
  return {
    totalItems: Array.isArray(cluster.items) ? cluster.items.length : 0,
    uniqueSources: entries.length,
    entries,
    topSources: entries.slice(0, 5),
  };
}

function classifyClusterQuality(cluster = {}) {
  const flags = [];
  const llmConfidence = cluster.llmConfidence || 'heuristic';
  const storyCount = cluster.items?.length || cluster.storyCount || 0;
  const sourceCount = cluster.sourceSet?.size || cluster.sourceCount || 0;
  const placementBasis = cluster.placementBasis || 'keyword';
  const placementPrecision = cluster.placementPrecision || 'country';
  const placementClass = cluster.placementClass || (placementPrecision === 'source-fallback' ? 'source-fallback' : placementBasis === 'region' ? 'inferred-region' : `inferred-${placementPrecision}`);

  if (sourceCount <= 1) flags.push('single-source');
  if (storyCount <= 1) flags.push('single-story');
  if (llmConfidence === 'heuristic') flags.push('heuristic-only');
  if (llmConfidence === 'high') flags.push('llm-backed');
  if (placementClass === 'source-fallback') flags.push('source-fallback-placement');
  if (placementClass === 'source-native') flags.push('source-native-placement');
  if (placementBasis === 'keyword' && sourceCount <= 1) flags.push('keyword-placement-thin');

  let quality = 'medium';
  if (sourceCount >= 3 && storyCount >= 3 && llmConfidence !== 'heuristic') quality = 'high';
  else if (sourceCount <= 1 || storyCount <= 1) quality = 'low';
  else if (llmConfidence === 'heuristic' && sourceCount <= 2) quality = 'low';

  const confidenceLabel = quality === 'high'
    ? 'strong'
    : quality === 'low'
      ? 'weak'
      : 'moderate';

  return { quality, confidenceLabel, qualityFlags: Array.from(new Set(flags)) };
}

function summarizeClusterReviewMetrics(clusters = []) {
  const lowConfidenceClusters = clusters.filter(cluster =>
    cluster.quality === 'low' ||
    cluster.confidenceLabel === 'weak' ||
    (cluster.qualityFlags || []).includes('heuristic-only') ||
    (cluster.qualityFlags || []).includes('single-source')
  );

  const mergeCandidateClusters = clusters.filter(cluster =>
    (cluster.storyCount || 0) >= 3 &&
    (((cluster.qualityFlags || []).includes('heuristic-only')) || (cluster.llmConfidence || 'heuristic') === 'heuristic')
  );

  const splitCandidateClusters = clusters.filter(cluster =>
    (cluster.storyCount || 0) <= 1 &&
    (cluster.sourceCount || 0) <= 1 &&
    (cluster.qualityFlags || []).includes('heuristic-only')
  );

  const splitPressureByRegion = splitCandidateClusters.reduce((acc, cluster) => {
    const region = cluster.region || 'Unknown';
    acc.set(region, (acc.get(region) || 0) + 1);
    return acc;
  }, new Map());

  const topSplitRegions = Array.from(splitPressureByRegion.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([region, count]) => ({ region, count }));

  const suspiciousNearDuplicates = [];
  for (let i = 0; i < splitCandidateClusters.length; i++) {
    for (let j = i + 1; j < splitCandidateClusters.length; j++) {
      const a = splitCandidateClusters[i];
      const b = splitCandidateClusters[j];
      if ((a.region || '') !== (b.region || '')) continue;
      const similarity = titleSimilarity(a.headline || a.summary || '', b.headline || b.summary || '');
      if (similarity < 0.5) continue;
      suspiciousNearDuplicates.push({
        region: a.region || 'Unknown',
        similarity: Number(similarity.toFixed(2)),
        clusterA: { id: a.id || null, headline: a.headline || a.summary || null, sourceCount: a.sourceCount || 0, storyCount: a.storyCount || 0 },
        clusterB: { id: b.id || null, headline: b.headline || b.summary || null, sourceCount: b.sourceCount || 0, storyCount: b.storyCount || 0 },
      });
    }
  }
  suspiciousNearDuplicates.sort((a, b) => b.similarity - a.similarity || String(a.region).localeCompare(String(b.region)));

  return {
    lowConfidenceCount: lowConfidenceClusters.length,
    mergeCandidateCount: mergeCandidateClusters.length,
    splitCandidateCount: splitCandidateClusters.length,
    topSplitRegions,
    suspiciousNearDuplicateCount: suspiciousNearDuplicates.length,
    suspiciousNearDuplicates: suspiciousNearDuplicates.slice(0, 8),
  };
}

export async function buildNewsClusters(news = [], llmProvider = null, options = {}) {
  const { hints: llmHints, debug: llmDebug } = await consolidateNewsWithLLM(news, llmProvider, options);
  const hintMap = new Map(llmHints.filter(x => Number.isInteger(x?.idx)).map(x => [x.idx, x]));
  const groups = new Map();
  news.forEach((item, idx) => {
    const hint = hintMap.get(idx);
    const region = normalizeNewsRegionLabel(hint?.primaryRegion || item.region || 'Global');
    const geo = resolveNewsPlacement({ ...item, region }) || item;
    const storyKey = normalizeStoryKey(hint?.storyKey || hint?.subject || item.title);
    const clusterKey = `${region}::${storyKey}`;
    if (!groups.has(clusterKey)) {
      groups.set(clusterKey, {
        id: clusterKey,
        lat: geo.lat,
        lon: geo.lon,
        region,
        storyKey,
        headline: hint?.subject || storySummaryFallback(item.title),
        summary: hint?.subject || storySummaryFallback(item.title),
        items: [],
        sourceSet: new Set(),
        placementPrecision: geo.placementPrecision || geo.precision || item.placementPrecision || 'country',
        placementBasis: geo.placementBasis || geo.basis || item.placementBasis || 'keyword',
        placementClass: geo.placementClass || item.placementClass || 'inferred-country',
        llmConfidence: hint?.confidence || null,
      });
    }
    const cluster = groups.get(clusterKey);
    cluster.items.push(item);
    cluster.sourceSet.add(item.source);
    if ((item.date || '') > (cluster.latestDate || '')) cluster.latestDate = item.date;
  });
  const clusters = Array.from(groups.values()).map(cluster => {
    const offset = stableClusterOffset(cluster.id, cluster.items.length);
    const quality = classifyClusterQuality(cluster);
    const sourceProvenance = summarizeClusterSources(cluster);
    return {
      id: cluster.id,
      lat: +(cluster.lat + offset.lat).toFixed(3),
      lon: +(cluster.lon + offset.lon).toFixed(3),
      region: cluster.region,
      headline: cluster.headline,
      summary: cluster.summary,
      storyCount: cluster.items.length,
      sourceCount: cluster.sourceSet.size,
      sourceProvenance,
      latestDate: cluster.latestDate || null,
      placementPrecision: cluster.placementPrecision,
      placementBasis: cluster.placementBasis,
      placementClass: cluster.placementClass,
      llmConfidence: cluster.llmConfidence,
      quality: quality.quality,
      confidenceLabel: quality.confidenceLabel,
      qualityFlags: quality.qualityFlags,
      items: cluster.items.slice(0, 6),
    };
  }).sort((a, b) => b.storyCount - a.storyCount || new Date(b.latestDate || 0) - new Date(a.latestDate || 0));
  return {
    clusters,
    llmDebug,
    qualitySummary: {
      high: clusters.filter(c => c.quality === 'high').length,
      medium: clusters.filter(c => c.quality === 'medium').length,
      low: clusters.filter(c => c.quality === 'low').length,
      llmBacked: clusters.filter(c => c.qualityFlags.includes('llm-backed')).length,
      heuristicOnly: clusters.filter(c => c.qualityFlags.includes('heuristic-only')).length,
      singleSource: clusters.filter(c => c.qualityFlags.includes('single-source')).length,
      reviewMetrics: summarizeClusterReviewMetrics(clusters),
    },
  };
}

// === Leverageable Ideas from Signals ===
export function generateIdeas(V2) {
  const ideas = [];
  const vix = V2.fred.find(f => f.id === 'VIXCLS');
  const hy = V2.fred.find(f => f.id === 'BAMLH0A0HYM2');
  const spread = V2.fred.find(f => f.id === 'T10Y2Y');

  if (V2.tg.urgent.length > 3 && V2.energy.wti > 68) {
    ideas.push({
      title: 'Conflict-Energy Nexus Active',
      text: `${V2.tg.urgent.length} urgent conflict signals with WTI at $${V2.energy.wti}. Geopolitical risk premium may expand. Consider energy exposure.`,
      type: 'long', confidence: 'Medium', horizon: 'swing'
    });
  }
  if (vix && vix.value > 20) {
    ideas.push({
      title: 'Elevated Volatility Regime',
      text: `VIX at ${vix.value} — fear premium elevated. Portfolio hedges justified. Short-term equity upside is capped.`,
      type: 'hedge', confidence: vix.value > 25 ? 'High' : 'Medium', horizon: 'tactical'
    });
  }
  if (vix && vix.value > 20 && hy && hy.value > 3) {
    ideas.push({
      title: 'Safe Haven Demand Rising',
      text: `VIX ${vix.value} + HY spread ${hy.value}% = risk-off building. Gold, treasuries, quality dividends may outperform.`,
      type: 'hedge', confidence: 'Medium', horizon: 'tactical'
    });
  }
  if (V2.energy.wtiRecent.length > 1) {
    const latest = V2.energy.wtiRecent[0];
    const oldest = V2.energy.wtiRecent[V2.energy.wtiRecent.length - 1];
    const pct = ((latest - oldest) / oldest * 100).toFixed(1);
    if (Math.abs(pct) > 3) {
      ideas.push({
        title: pct > 0 ? 'Oil Momentum Building' : 'Oil Under Pressure',
        text: `WTI moved ${pct > 0 ? '+' : ''}${pct}% recently to $${V2.energy.wti}/bbl. ${pct > 0 ? 'Energy and commodity names benefit.' : 'Demand concerns may be emerging.'}`,
        type: pct > 0 ? 'long' : 'watch', confidence: 'Medium', horizon: 'swing'
      });
    }
  }
  if (spread) {
    ideas.push({
      title: spread.value > 0 ? 'Yield Curve Normalizing' : 'Yield Curve Inverted',
      text: `10Y-2Y spread at ${spread.value.toFixed(2)}. ${spread.value > 0 ? 'Recession signal fading — cyclical rotation possible.' : 'Inversion persists — defensive positioning warranted.'}`,
      type: 'watch', confidence: 'Medium', horizon: 'strategic'
    });
  }
  const debt = parseFloat(V2.treasury.totalDebt);
  if (debt > 35e12) {
    ideas.push({
      title: 'Fiscal Trajectory Supports Hard Assets',
      text: `National debt at $${(debt / 1e12).toFixed(1)}T. Long-term gold, bitcoin, and real asset appreciation thesis intact.`,
      type: 'long', confidence: 'High', horizon: 'strategic'
    });
  }
  const totalThermal = V2.thermal.reduce((s, t) => s + t.det, 0);
  if (totalThermal > 30000 && V2.tg.urgent.length > 2) {
    ideas.push({
      title: 'Satellite Confirms Conflict Intensity',
      text: `${totalThermal.toLocaleString()} thermal detections + ${V2.tg.urgent.length} urgent OSINT flags. Defense sector procurement may accelerate.`,
      type: 'watch', confidence: 'Medium', horizon: 'swing'
    });
  }

  // Yield Curve + Labor Interaction
  const unemployment = V2.bls.find(b => b.id === 'LNS14000000' || b.id === 'UNRATE');
  const payrolls = V2.bls.find(b => b.id === 'CES0000000001' || b.id === 'PAYEMS');
  if (spread && unemployment && payrolls) {
    const weakLabor = (unemployment.value > 4.3) || (payrolls.momChange && payrolls.momChange < -50);
    if (spread.value > 0.3 && weakLabor) {
      ideas.push({
        title: 'Steepening Curve Meets Weak Labor',
        text: `10Y-2Y at ${spread.value.toFixed(2)} + UE ${unemployment.value}%. Curve steepening with deteriorating employment = recession positioning warranted.`,
        type: 'hedge', confidence: 'High', horizon: 'tactical'
      });
    }
  }

  // ACLED Conflict + Energy Momentum
  const conflictEvents = V2.acled?.totalEvents || 0;
  if (conflictEvents > 50 && V2.energy.wtiRecent.length > 1) {
    const wtiMove = V2.energy.wtiRecent[0] - V2.energy.wtiRecent[V2.energy.wtiRecent.length - 1];
    if (wtiMove > 2) {
      ideas.push({
        title: 'Conflict Fueling Energy Momentum',
        text: `${conflictEvents} ACLED events this week + WTI up $${wtiMove.toFixed(1)}. Conflict-energy transmission channel active.`,
        type: 'long', confidence: 'Medium', horizon: 'swing'
      });
    }
  }

  // Defense + Conflict Intensity
  const totalFatalities = V2.acled?.totalFatalities || 0;
  const totalThermalAll = V2.thermal.reduce((s, t) => s + t.det, 0);
  if (totalFatalities > 500 && totalThermalAll > 20000) {
    ideas.push({
      title: 'Defense Procurement Acceleration Signal',
      text: `${totalFatalities.toLocaleString()} conflict fatalities + ${totalThermalAll.toLocaleString()} thermal detections. Defense contractors may see accelerated procurement.`,
      type: 'long', confidence: 'Medium', horizon: 'swing'
    });
  }

  // HY Spread + VIX Divergence
  if (hy && vix) {
    const hyWide = hy.value > 3.5;
    const vixLow = vix.value < 18;
    const hyTight = hy.value < 2.5;
    const vixHigh = vix.value > 25;
    if (hyWide && vixLow) {
      ideas.push({
        title: 'Credit Stress Ignored by Equity Vol',
        text: `HY spread ${hy.value.toFixed(1)}% (wide) but VIX only ${vix.value.toFixed(0)} (complacent). Equity may be underpricing credit deterioration.`,
        type: 'watch', confidence: 'Medium', horizon: 'tactical'
      });
    } else if (hyTight && vixHigh) {
      ideas.push({
        title: 'Equity Fear Exceeds Credit Stress',
        text: `VIX at ${vix.value.toFixed(0)} but HY spread only ${hy.value.toFixed(1)}%. Equity vol may be overshooting — credit markets aren't confirming.`,
        type: 'watch', confidence: 'Medium', horizon: 'tactical'
      });
    }
  }

  // Supply Chain + Inflation Pipeline
  const ppi = V2.bls.find(b => b.id === 'WPUFD49104' || b.id === 'PCU--PCU--');
  const cpi = V2.bls.find(b => b.id === 'CUUR0000SA0' || b.id === 'CPIAUCSL');
  if (ppi && cpi && V2.gscpi) {
    const supplyPressure = V2.gscpi.value > 0.5;
    const ppiRising = ppi.momChangePct > 0.3;
    if (supplyPressure && ppiRising) {
      ideas.push({
        title: 'Inflation Pipeline Building Pressure',
        text: `GSCPI at ${V2.gscpi.value.toFixed(2)} (${V2.gscpi.interpretation}) + PPI momentum +${ppi.momChangePct?.toFixed(1)}%. Input costs flowing through — CPI may follow.`,
        type: 'long', confidence: 'Medium', horizon: 'strategic'
      });
    }
  }

  return ideas.slice(0, 8);
}

// === Synthesize raw sweep data into dashboard format ===
export async function synthesize(data, llmProvider = createLLMProvider(config.llm), options = {}) {
  const openSkySource = data.sources.OpenSky || {};
  const liveAirHotspots = openSkySource.hotspots || [];
  const sourceProvidedFallback = openSkySource.servedFromCache
    ? {
        file: openSkySource.cacheFile,
        timestamp: openSkySource.timestamp,
        hotspots: liveAirHotspots,
        cacheAgeMinutes: openSkySource.cacheAgeMinutes,
        providedBySource: true,
      }
    : null;
  const airFallback = sourceProvidedFallback || (sumAirHotspots(liveAirHotspots) > 0
    ? null
    : loadOpenSkyFallback(openSkySource.timestamp || data.crucix?.timestamp));
  const effectiveAirHotspots = airFallback?.hotspots || liveAirHotspots;
  const air = summarizeAirHotspots(effectiveAirHotspots);
  const thermal = (data.sources.FIRMS?.hotspots || []).map(h => ({
    region: h.region, det: h.totalDetections || 0, night: h.nightDetections || 0,
    hc: h.highConfidence || 0,
    fires: (h.highIntensity || []).slice(0, 8).map(f => ({ lat: f.lat, lon: f.lon, frp: f.frp || 0 }))
  }));
  const tSignals = data.sources.FIRMS?.signals || [];
  const maritimeData = data.sources.Maritime || {};
  const chokepoints = Object.values(maritimeData.chokepoints || {}).map(c => ({
    label: c.label || c.name, note: c.note || '', lat: c.lat || 0, lon: c.lon || 0
  }));
  const nuke = (data.sources.Safecast?.sites || []).map(s => ({
    site: s.site, key: s.key || '', anom: s.anomaly || false, cpm: s.avgCPM, n: s.recentReadings || 0
  }));
  const nukeSignals = (data.sources.Safecast?.signals || []).filter(s => s);
  const sdrData = data.sources.KiwiSDR || {};
  const sdrNet = sdrData.network || {};
  const sdrConflict = sdrData.conflictZones || {};
  const sdrZones = Object.values(sdrConflict).map(z => ({
    region: z.region, count: z.count || 0,
    receivers: (z.receivers || []).slice(0, 5).map(r => ({ name: r.name || '', lat: r.lat || 0, lon: r.lon || 0 }))
  }));
  const tgData = data.sources.Telegram || {};
  const tgUrgent = (tgData.urgentPosts || []).filter(p => isEnglish(p.text)).map(p => ({
    channel: p.channel, text: p.text?.substring(0, 200), views: p.views, date: p.date, urgentFlags: p.urgentFlags || []
  }));
  const tgUrgentNews = buildTelegramNewsCandidates(tgUrgent);
  const tgTop = (tgData.topPosts || []).filter(p => isEnglish(p.text)).map(p => ({
    channel: p.channel, text: p.text?.substring(0, 200), views: p.views, date: p.date, urgentFlags: []
  }));
  const who = (data.sources.WHO?.diseaseOutbreakNews || []).slice(0, 10).map(w => ({
    title: w.title?.substring(0, 120), date: w.date, summary: w.summary?.substring(0, 150)
  }));
  const fred = (data.sources.FRED?.indicators || []).map(f => ({
    id: f.id, label: f.label, value: f.value, date: f.date,
    recent: f.recent || [],
    momChange: f.momChange, momChangePct: f.momChangePct
  }));
  const energyData = data.sources.EIA || {};
  const oilPrices = energyData.oilPrices || {};
  const wtiRecent = (oilPrices.wti?.recent || []).map(d => d.value);
  const energy = {
    wti: oilPrices.wti?.value, brent: oilPrices.brent?.value,
    natgas: energyData.gasPrice?.value, crudeStocks: energyData.inventories?.crudeStocks?.value,
    wtiRecent, signals: energyData.signals || []
  };
  const bls = data.sources.BLS?.indicators || [];
  const treasuryData = data.sources.Treasury || {};
  const debtArr = treasuryData.debt || [];
  const treasury = { totalDebt: debtArr[0]?.totalDebt || '0', signals: treasuryData.signals || [] };
  const gscpi = data.sources.GSCPI?.latest || null;
  const defense = (data.sources.USAspending?.recentDefenseContracts || []).slice(0, 5).map(c => ({
    recipient: c.recipient?.substring(0, 40), amount: c.amount, desc: c.description?.substring(0, 80)
  }));
  const noaa = {
    totalAlerts: data.sources.NOAA?.totalSevereAlerts || 0,
    alerts: (data.sources.NOAA?.topAlerts || []).filter(a => a.lat != null && a.lon != null).slice(0, 10).map(a => ({
      event: a.event, severity: a.severity, headline: a.headline?.substring(0, 120),
      lat: a.lat, lon: a.lon
    }))
  };

  // EPA RadNet — pass through geo-tagged readings
  const epaData = data.sources.EPA || {};
  const epaStations = [];
  const seenEpa = new Set();
  for (const r of (epaData.readings || [])) {
    if (r.lat == null || r.lon == null) continue;
    const key = `${r.lat},${r.lon}`;
    if (seenEpa.has(key)) continue;
    seenEpa.add(key);
    epaStations.push({ location: r.location, state: r.state, lat: r.lat, lon: r.lon, analyte: r.analyte, result: r.result, unit: r.unit });
  }
  const epa = { totalReadings: epaData.totalReadings || 0, stations: epaStations.slice(0, 10) };

  // Space/CelesTrak satellite data
  const spaceData = data.sources.Space || {};
  // Approximate subsatellite position from TLE orbital elements
  function estimateSatPosition(sat) {
    if (!sat?.inclination || !sat?.epoch) return null;
    const epoch = new Date(sat.epoch);
    const now = new Date();
    const elapsed = (now - epoch) / 1000;
    const period = (sat.period || 92.7) * 60; // minutes to seconds
    const orbits = elapsed / period;
    const frac = orbits % 1;
    const lat = sat.inclination * Math.sin(frac * 2 * Math.PI);
    const lonShift = (elapsed / 86400) * 360;
    const orbitLon = frac * 360;
    const lon = ((orbitLon - lonShift) % 360 + 540) % 360 - 180;
    return { lat: +lat.toFixed(2), lon: +lon.toFixed(2), name: sat.name };
  }
  const issPos = estimateSatPosition(spaceData.iss);
  const spaceStations = (spaceData.spaceStations || []).map(s => estimateSatPosition(s)).filter(Boolean);
  const space = {
    totalNewObjects: spaceData.totalNewObjects || 0,
    militarySats: spaceData.militarySatellites || 0,
    militaryByCountry: spaceData.militaryByCountry || {},
    constellations: spaceData.constellations || {},
    iss: spaceData.iss || null,
    issPosition: issPos,
    stationPositions: spaceStations.slice(0, 5),
    recentLaunches: (spaceData.recentLaunches || []).slice(0, 10).map(l => ({
      name: l.name, country: l.country, epoch: l.epoch,
      apogee: l.apogee, perigee: l.perigee, type: l.objectType
    })),
    launchByCountry: spaceData.launchByCountry || {},
    signals: spaceData.signals || [],
  };

  // ACLED conflict events
  const acledData = data.sources.ACLED || {};
  const acled = acledData.error ? { totalEvents: 0, totalFatalities: 0, byRegion: {}, byType: {}, deadliestEvents: [] } : {
    totalEvents: acledData.totalEvents || 0,
    totalFatalities: acledData.totalFatalities || 0,
    byRegion: acledData.byRegion || {},
    byType: acledData.byType || {},
    deadliestEvents: (acledData.deadliestEvents || []).slice(0, 15).map(e => ({
      date: e.date, type: e.type, country: e.country, location: e.location,
      fatalities: e.fatalities || 0, lat: e.lat || null, lon: e.lon || null
    }))
  };

  // GDELT news articles + geo events
  const gdeltData = data.sources.GDELT || {};
  const gdelt = {
    totalArticles: gdeltData.totalArticles || 0,
    conflicts: (gdeltData.conflicts || []).length,
    economy: (gdeltData.economy || []).length,
    health: (gdeltData.health || []).length,
    crisis: (gdeltData.crisis || []).length,
    topTitles: (gdeltData.allArticles || []).slice(0, 5).map(a => a.title?.substring(0, 80)),
    geoPoints: (gdeltData.geoPoints || []).slice(0, 20).map(p => ({
      lat: p.lat, lon: p.lon, name: (p.name || '').substring(0, 80), count: p.count || 1
    }))
  };

  const { entries: health, summary: healthSummary } = buildSourceHealth(data);
  const openSkyHealth = health.find(entry => entry.name === 'OpenSky') || null;

  // === Yahoo Finance live market data ===
  const yfData = data.sources.YFinance || {};
  const yfQuotes = yfData.quotes || {};
  const markets = {
    indexes: (yfData.indexes || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.effectivePrice ?? q.price,
      rawPrice: q.price, change: q.change, changePct: q.changePct, history: q.history || [],
      validation: q.validation || null
    })),
    rates: (yfData.rates || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.effectivePrice ?? q.price,
      rawPrice: q.price, change: q.change, changePct: q.changePct, validation: q.validation || null
    })),
    commodities: (yfData.commodities || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.effectivePrice ?? q.price,
      rawPrice: q.price, change: q.change, changePct: q.changePct, history: q.history || [],
      validation: q.validation || null
    })),
    crypto: (yfData.crypto || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.effectivePrice ?? q.price,
      rawPrice: q.price, change: q.change, changePct: q.changePct, validation: q.validation || null
    })),
    vix: yfQuotes['^VIX'] ? {
      value: yfQuotes['^VIX'].effectivePrice ?? yfQuotes['^VIX'].price,
      rawValue: yfQuotes['^VIX'].price,
      change: yfQuotes['^VIX'].change,
      changePct: yfQuotes['^VIX'].changePct,
      validation: yfQuotes['^VIX'].validation || null,
    } : null,
    timestamp: yfData.summary?.timestamp || null,
  };

  const yfGold = yfQuotes['GC=F'];
  const yfSilver = yfQuotes['SI=F'];
  const metals = {
    gold: yfGold?.effectivePrice ?? yfGold?.price,
    goldRaw: yfGold?.price,
    goldChange: yfGold?.change,
    goldChangePct: yfGold?.changePct,
    goldRecent: yfGold?.history?.map(h => h.close) || [],
    goldValidation: yfGold?.validation || null,
    silver: yfSilver?.effectivePrice ?? yfSilver?.price,
    silverRaw: yfSilver?.price,
    silverChange: yfSilver?.change,
    silverChangePct: yfSilver?.changePct,
    silverRecent: yfSilver?.history?.map(h => h.close) || [],
    silverValidation: yfSilver?.validation || null,
  };

  // Override stale EIA prices with live Yahoo Finance data if available
  const yfWti = yfQuotes['CL=F'];
  const yfBrent = yfQuotes['BZ=F'];
  const yfNatgas = yfQuotes['NG=F'];
  if (yfWti?.effectivePrice ?? yfWti?.price) energy.wti = yfWti.effectivePrice ?? yfWti.price;
  if (yfBrent?.effectivePrice ?? yfBrent?.price) energy.brent = yfBrent.effectivePrice ?? yfBrent.price;
  if (yfNatgas?.effectivePrice ?? yfNatgas?.price) energy.natgas = yfNatgas.effectivePrice ?? yfNatgas.price;
  if (yfWti?.history?.length) energy.wtiRecent = yfWti.history.map(h => h.close);
  if (yfBrent?.validation?.confidence === 'low') {
    energy.signals = energy.signals || [];
    energy.signals.push(`Brent live quote downgraded to low confidence, using prior close $${yfBrent.prevClose} instead of raw $${yfBrent.price}`);
  }

  // Fetch RSS and fold in geocodable urgent Telegram items so high-salience OSINT events are eligible for clustering and map placement.
  const rssNews = await fetchAllNews();
  const news = [...tgUrgentNews, ...rssNews];
  const { clusters: newsClusters, llmDebug: newsLlmDebug, qualitySummary: newsClusterQuality } = await buildNewsClusters(news, llmProvider, { mode: options.newsLlmMode || 'auto' });

  const corroboratedSignals = buildCorroboratedSignals({
    tg: { urgent: tgUrgent, topPosts: tgTop, posts: tgData.totalPosts || 0 },
    thermal,
    air,
    maritime: maritimeData,
    markets,
    nuke,
    health,
    nowTs: data.crucix?.timestamp || new Date().toISOString(),
  }).sort((a, b) => (b.regionalWeight || 0) - (a.regionalWeight || 0));

  const suspectSignals = buildSuspectSignals({
    yfQuotes,
    health,
    airMeta: {
      fallback: Boolean(airFallback),
      source: airFallback ? 'OpenSky fallback' : 'OpenSky',
      queriedRegionCount: Array.isArray(openSkySource.queriedRegions) ? openSkySource.queriedRegions.length : 0,
      carriedForwardCount: effectiveAirHotspots.filter(h => h?.carriedForward).length,
      ...(openSkySource.error ? { error: openSkySource.error } : {}),
      ...(openSkySource.liveError ? { liveError: openSkySource.liveError } : {}),
      ...(airFallback?.cacheAgeMinutes != null ? { cacheAgeMinutes: airFallback.cacheAgeMinutes } : {}),
    },
    nuke,
    nukeSignals,
    energy,
    metals,
    markets,
    tg: { urgent: tgUrgent, topPosts: tgTop, posts: tgData.totalPosts || 0 },
    thermal,
    air,
    chokepoints,
    maritime: maritimeData,
    nowTs: data.crucix?.timestamp || new Date().toISOString(),
  }).sort((a, b) => ((b.regionalWeight || 0) * (b.decayMultiplier || 1)) - ((a.regionalWeight || 0) * (a.decayMultiplier || 1)));

  const evidenceSummary = buildEvidenceSummary({
    nowTs: data.crucix?.timestamp || new Date().toISOString(),
    airMeta: {
      fallback: Boolean(airFallback),
      timestamp: airFallback?.timestamp || openSkySource.timestamp || data.crucix?.timestamp || null,
      source: airFallback ? 'OpenSky fallback' : 'OpenSky',
      queriedRegions: openSkySource.queriedRegions || [],
      queriedRegionCount: Array.isArray(openSkySource.queriedRegions) ? openSkySource.queriedRegions.length : 0,
      carriedForwardCount: effectiveAirHotspots.filter(h => h?.carriedForward).length,
      ...(airFallback ? { fallbackFile: airFallback.file } : {}),
      ...(airFallback?.cacheAgeMinutes != null ? { cacheAgeMinutes: airFallback.cacheAgeMinutes } : {}),
      ...(openSkySource.queryMode ? { queryMode: openSkySource.queryMode } : {}),
      ...(openSkySource.cooldownUntil ? { cooldownUntil: openSkySource.cooldownUntil } : {}),
      ...(openSkySource.runtimeState ? { runtimeState: openSkySource.runtimeState } : {}),
      ...(openSkySource.error ? { error: openSkySource.error } : {}),
      ...(openSkySource.liveError ? { liveError: openSkySource.liveError } : {}),
    },
    markets,
    tg: { urgent: tgUrgent, topPosts: tgTop, posts: tgData.totalPosts || 0 },
    news,
    healthSummary,
    openSkyHealth,
  });

  const evidenceSummarySignals = [evidenceSummary.headline];
  if (corroboratedSignals.length) {
    const top = corroboratedSignals[0];
    evidenceSummarySignals.push(`CORROBORATED: ${top.signal} (${top.confidence})`);
  }
  if (suspectSignals.length) {
    const top = suspectSignals[0];
    evidenceSummarySignals.push(`SUSPECT: ${top.signal} (${top.confidence})`);
  }

  const V2 = {
    meta: data.crucix, air, thermal, tSignals: [...evidenceSummarySignals, ...tSignals], chokepoints, nuke, nukeSignals,
    airMeta: {
      fallback: Boolean(airFallback),
      liveTotal: sumAirHotspots(liveAirHotspots),
      timestamp: airFallback?.timestamp || openSkySource.timestamp || data.crucix?.timestamp || null,
      source: airFallback ? 'OpenSky fallback' : 'OpenSky',
      queriedRegions: openSkySource.queriedRegions || [],
      queriedRegionCount: Array.isArray(openSkySource.queriedRegions) ? openSkySource.queriedRegions.length : 0,
      carriedForwardCount: effectiveAirHotspots.filter(h => h?.carriedForward).length,
      ...(airFallback ? { fallbackFile: airFallback.file } : {}),
      ...(airFallback?.cacheAgeMinutes != null ? { cacheAgeMinutes: airFallback.cacheAgeMinutes } : {}),
      ...(openSkySource.queryMode ? { queryMode: openSkySource.queryMode } : {}),
      ...(openSkySource.cooldownUntil ? { cooldownUntil: openSkySource.cooldownUntil } : {}),
      ...(openSkySource.runtimeState ? { runtimeState: openSkySource.runtimeState } : {}),
      ...(openSkySource.error ? { error: openSkySource.error } : {}),
      ...(openSkySource.liveError ? { liveError: openSkySource.liveError } : {}),
    },
    sdr: { total: sdrNet.totalReceivers || 0, online: sdrNet.online || 0, zones: sdrZones },
    tg: { posts: tgData.totalPosts || 0, urgent: tgUrgent, topPosts: tgTop },
    who, fred, energy, metals, bls, treasury, gscpi, defense, noaa, epa, acled, gdelt, space, health, healthSummary, evidenceSummary, news, newsClusters, newsLlmDebug, newsClusterQuality,
    markets, // Live Yahoo Finance market data
    maritime: {
      disruptionChecks: maritimeData.disruptionChecks || [],
      disruptionSignals: maritimeData.disruptionSignals || [],
    },
    corroboratedSignals,
    suspectSignals,
    ideas: [], ideasSource: 'disabled',
    // newsFeed for ticker (merged RSS + GDELT + Telegram)
    newsFeed: buildNewsFeed(news, gdeltData, tgUrgent, tgTop),
  };

  return V2;
}

// === Unified News Feed for Ticker ===
function buildNewsFeed(rssNews, gdeltData, tgUrgent, tgTop) {
  const feed = [];

  // RSS news
  for (const n of rssNews) {
    feed.push({
      headline: n.title, source: n.source, type: 'rss',
      timestamp: n.date, region: n.region, urgent: false, url: n.url
    });
  }

  // GDELT top articles
  for (const a of (gdeltData.allArticles || []).slice(0, 10)) {
    if (a.title) {
      const geo = geoTagText(a.title);
      feed.push({
        headline: a.title.substring(0, 100), source: 'GDELT', type: 'gdelt',
        timestamp: new Date().toISOString(), region: geo?.region || 'Global', urgent: false, url: sanitizeExternalUrl(a.url)
      });
    }
  }

  // Telegram urgent
  for (const p of tgUrgent.slice(0, 10)) {
    const text = (p.text || '').replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
    feed.push({
      headline: text.substring(0, 100), source: p.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram', timestamp: p.date, region: 'OSINT', urgent: true
    });
  }

  // Telegram top (non-urgent)
  for (const p of tgTop.slice(0, 5)) {
    const text = (p.text || '').replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
    feed.push({
      headline: text.substring(0, 100), source: p.channel?.toUpperCase() || 'TELEGRAM',
      type: 'telegram', timestamp: p.date, region: 'OSINT', urgent: false
    });
  }

  // Filter to last 30 days, sort by timestamp descending, limit to 50
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = feed.filter(item => !item.timestamp || new Date(item.timestamp) >= cutoff);
  recent.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  const selected = [];
  const selectedKeys = new Set();
  const keyFor = item => `${item.type}|${item.source}|${item.headline}|${item.timestamp}`;
  const pushUnique = item => {
    const key = keyFor(item);
    if (selectedKeys.has(key)) return;
    selected.push(item);
    selectedKeys.add(key);
  };

  for (const source of REGIONAL_NEWS_SOURCES) {
    recent.filter(item => item.source === source).slice(0, 2).forEach(pushUnique);
  }
  recent.forEach(pushUnique);
  return selected.slice(0, 50);
}

// === CLI Mode: inject into HTML file ===
function getCliArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function cliInject() {
  const data = JSON.parse(readFileSync(join(ROOT, 'runs/latest.json'), 'utf8'));
  const htmlOverride = getCliArg('--html');
  const shouldOpen = !process.argv.includes('--no-open');

  console.log('Fetching RSS news feeds...');
  const llmProvider = createLLMProvider(config.llm);
  const V2 = await synthesize(data, llmProvider);

  if (llmProvider?.isConfigured) {
    try {
      console.log(`[LLM] Generating ideas via ${llmProvider.name}...`);
      const llmIdeas = await generateLLMIdeas(llmProvider, V2, null, []);
      if (llmIdeas?.length) {
        V2.ideas = llmIdeas;
        V2.ideasSource = 'llm';
        console.log(`[LLM] Generated ${llmIdeas.length} ideas`);
      } else {
        V2.ideas = [];
        V2.ideasSource = 'llm-failed';
        console.log('[LLM] No ideas returned');
      }
    } catch (err) {
      V2.ideas = [];
      V2.ideasSource = 'llm-failed';
      console.log('[LLM] Idea generation failed:', err.message);
    }
  } else {
    V2.ideas = [];
    V2.ideasSource = 'disabled';
  }
  console.log(`Generated ${V2.ideas.length} leverageable ideas`);

  const json = JSON.stringify(V2);
  console.log('\n--- Synthesis ---');
  console.log('Size:', json.length, 'bytes | Air:', V2.air.length, '| Thermal:', V2.thermal.length,
    '| News:', V2.news.length, '| Ideas:', V2.ideas.length, '| Sources:', V2.health.length);

  const htmlPath = htmlOverride || join(ROOT, 'dashboard/public/jarvis.html');
  let html = readFileSync(htmlPath, 'utf8');
  // Use a replacer function so JSON is inserted literally even if it contains `$`.
  html = html.replace(/^(let|const) D = .*;\s*$/m, () => 'let D = ' + json + ';');
  writeFileSync(htmlPath, html);
  console.log('Data injected into jarvis.html!');

  if (!shouldOpen) return;

  // Auto-open dashboard in default browser
  // NOTE: On Windows, `start` in PowerShell is an alias for Start-Service, not cmd's start.
  // We must use `cmd /c start ""` to ensure it works in both cmd.exe and PowerShell.
  const openCmd = process.platform === 'win32' ? 'cmd /c start ""' :
                  process.platform === 'darwin' ? 'open' : 'xdg-open';
  const dashUrl = htmlPath.replace(/\\/g, '/');
  exec(`${openCmd} "${dashUrl}"`, (err) => {
    if (err) console.log('Could not auto-open browser:', err.message);
    else console.log('Dashboard opened in browser!');
  });
}

// Run CLI if invoked directly
const isMain = process.argv[1]
  && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  await cliInject();
}
