#!/usr/bin/env node
// Crucix Dashboard Data Synthesizer
// Reads runs/latest.json, fetches RSS news, generates signal-based ideas,
// and injects everything into dashboard/public/jarvis.html
//
// Exports synthesize(), generateIdeas(), fetchAllNews() for use by server.mjs

import { exec } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../crucix.config.mjs';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// === Helpers ===
const cyrillic = /[\u0400-\u04FF]/;
function isEnglish(text) {
  if (!text) return false;
  return !cyrillic.test(text.substring(0, 80));
}

// === Geo-tagging keyword map ===
const geoKeywords = {
  'Ukraine': [49, 32], 'Russia': [56, 38], 'Moscow': [55.7, 37.6], 'Kyiv': [50.4, 30.5],
  'China': [35, 105], 'Beijing': [39.9, 116.4], 'Iran': [32, 53], 'Tehran': [35.7, 51.4],
  'Israel': [31.5, 35], 'Gaza': [31.4, 34.4], 'Palestine': [31.9, 35.2],
  'Syria': [35, 38], 'Iraq': [33, 44], 'Saudi': [24, 45], 'Yemen': [15, 48], 'Lebanon': [34, 36],
  'India': [20, 78], 'Japan': [36, 138], 'Korea': [37, 127], 'Pyongyang': [39, 125.7],
  'Taiwan': [23.5, 121], 'Philippines': [13, 122], 'Myanmar': [20, 96],
  'Canada': [56, -96], 'Mexico': [23, -102], 'Brazil': [-14, -51], 'Argentina': [-38, -63],
  'Colombia': [4, -74], 'Venezuela': [7, -66], 'Cuba': [22, -80], 'Chile': [-35, -71],
  'Germany': [51, 10], 'France': [46, 2], 'UK': [54, -2], 'Britain': [54, -2], 'London': [51.5, -0.1],
  'Spain': [40, -4], 'Italy': [42, 12], 'Poland': [52, 20], 'NATO': [50, 4], 'EU': [50, 4],
  'Turkey': [39, 35], 'Greece': [39, 22], 'Romania': [46, 25], 'Finland': [64, 26], 'Sweden': [62, 15],
  'Africa': [0, 20], 'Nigeria': [10, 8], 'South Africa': [-30, 25], 'Kenya': [-1, 38],
  'Egypt': [27, 30], 'Libya': [27, 17], 'Sudan': [13, 30], 'Ethiopia': [9, 38],
  'Somalia': [5, 46], 'Congo': [-4, 22], 'Uganda': [1, 32], 'Morocco': [32, -6],
  'Pakistan': [30, 70], 'Afghanistan': [33, 65], 'Bangladesh': [24, 90],
  'Australia': [-25, 134], 'Indonesia': [-2, 118], 'Thailand': [15, 100],
  'US': [39, -98], 'America': [39, -98], 'Washington': [38.9, -77], 'Pentagon': [38.9, -77],
  'Trump': [38.9, -77], 'White House': [38.9, -77],
  'Wall Street': [40.7, -74], 'New York': [40.7, -74], 'California': [37, -120],
  'Nepal': [28, 84], 'Cambodia': [12.5, 105], 'Malawi': [-13.5, 34], 'Burundi': [-3.4, 29.9],
  'Oman': [21, 57], 'Netherlands': [52.1, 5.3], 'Gabon': [-0.8, 11.6],
  'Peru': [-10, -76], 'Ecuador': [-2, -78], 'Bolivia': [-17, -65],
  'Singapore': [1.35, 103.8], 'Malaysia': [4.2, 101.9], 'Vietnam': [16, 108],
  'Algeria': [28, 3], 'Tunisia': [34, 9], 'Zimbabwe': [-20, 30], 'Mozambique': [-18, 35],
  // Americas expansion
  'Texas': [31, -100], 'Florida': [28, -82], 'Chicago': [41.9, -87.6], 'Los Angeles': [34, -118],
  'San Francisco': [37.8, -122.4], 'Seattle': [47.6, -122.3], 'Miami': [25.8, -80.2],
  'Toronto': [43.7, -79.4], 'Ottawa': [45.4, -75.7], 'Vancouver': [49.3, -123.1],
  'São Paulo': [-23.5, -46.6], 'Rio': [-22.9, -43.2], 'Buenos Aires': [-34.6, -58.4],
  'Bogotá': [4.7, -74.1], 'Lima': [-12, -77], 'Santiago': [-33.4, -70.7],
  'Caracas': [10.5, -66.9], 'Havana': [23.1, -82.4], 'Panama': [9, -79.5],
  'Guatemala': [14.6, -90.5], 'Honduras': [14.1, -87.2], 'El Salvador': [13.7, -89.2],
  'Costa Rica': [10, -84], 'Jamaica': [18.1, -77.3], 'Haiti': [19, -72],
  'Dominican': [18.5, -70], 'Puerto Rico': [18.2, -66.5],
  // More Asia-Pacific
  'Sri Lanka': [7, 80], 'Hong Kong': [22.3, 114.2], 'Taipei': [25, 121.5],
  'Seoul': [37.6, 127], 'Osaka': [34.7, 135.5], 'Mumbai': [19.1, 72.9],
  'Delhi': [28.6, 77.2], 'Shanghai': [31.2, 121.5], 'Shenzhen': [22.5, 114.1],
  'Auckland': [-36.8, 174.8], 'Papua New Guinea': [-6.3, 147],
  // More Europe
  'Berlin': [52.5, 13.4], 'Paris': [48.9, 2.3], 'Madrid': [40.4, -3.7],
  'Rome': [41.9, 12.5], 'Warsaw': [52.2, 21], 'Prague': [50.1, 14.4],
  'Vienna': [48.2, 16.4], 'Budapest': [47.5, 19.1], 'Bucharest': [44.4, 26.1],
  'Kyiv': [50.4, 30.5], 'Oslo': [59.9, 10.7], 'Copenhagen': [55.7, 12.6],
  'Brussels': [50.8, 4.4], 'Zurich': [47.4, 8.5], 'Dublin': [53.3, -6.3],
  'Lisbon': [38.7, -9.1], 'Athens': [37.9, 23.7], 'Minsk': [53.9, 27.6],
  // More Africa
  'Nairobi': [-1.3, 36.8], 'Lagos': [6.5, 3.4], 'Accra': [5.6, -0.2],
  'Addis Ababa': [9, 38.7], 'Cape Town': [-33.9, 18.4], 'Johannesburg': [-26.2, 28],
  'Kinshasa': [-4.3, 15.3], 'Khartoum': [15.6, 32.5], 'Mogadishu': [2.1, 45.3],
  'Dakar': [14.7, -17.5], 'Abuja': [9.1, 7.5],
  // Tech/Economy keywords with US locations
  'Fed': [38.9, -77], 'Congress': [38.9, -77], 'Senate': [38.9, -77],
  'Silicon Valley': [37.4, -122], 'NASA': [28.6, -80.6], 'Pentagon': [38.9, -77],
  'IMF': [38.9, -77], 'World Bank': [38.9, -77], 'UN': [40.7, -74],
};

function geoTagText(text) {
  if (!text) return null;
  for (const [keyword, [lat, lon]] of Object.entries(geoKeywords)) {
    if (text.includes(keyword)) {
      return { lat, lon, region: keyword };
    }
  }
  return null;
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

export async function fetchAllNews() {
  const feeds = [
    // Existing core
    ['http://feeds.bbci.co.uk/news/world/rss.xml', 'BBC World'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'NYT World'],
    ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/Americas.xml', 'NYT Americas'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml', 'NYT Asia'],
    ['https://feeds.bbci.co.uk/news/technology/rss.xml', 'BBC Tech'],
    ['http://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'BBC Science'],
    // WSJ feeds
    ['https://feeds.content.dowjones.io/public/rss/RSSWorldNews', 'WSJ World'],
    ['https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness', 'WSJ Business'],
    ['https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', 'WSJ Markets'],
    ['https://feeds.content.dowjones.io/public/rss/RSSUSnews', 'WSJ US News'],
    ['https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', 'MarketWatch'],
    // Premium financial & wire
    ['https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best', 'Reuters'],
    ['https://www.ft.com/news-feed?format=rss.&page=1', 'FT'],
    ['https://feeds.bloomberg.com/markets/news.rss', 'Bloomberg'],
    // Business & markets
    ['https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', 'NYT Business'],
    ['https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml', 'NYT Dealbook'],
    ['https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJdEVhZXw==&_gl=1*1ffo59h*_ga*MTM1NjEyMzA0My4xNzAyMzk0NTEz*_ga_ZQWF70T3FK*MTcwMzAxODA2NS4yLjEuMTcwMzAxODExMC4xNS4wLjA.', 'BusinessWire'],
    ['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', 'CNBC'],
    ['https://feeds.bbci.co.uk/news/business/rss.xml', 'BBC Business'],
    // Breaking & news aggregators
    ['https://api.axios.com/feed/', 'Axios'],
    ['https://www.huffpost.com/section/world-news/feed', 'HuffPost World'],
    ['http://rssfeeds.usatoday.com/UsatodaycomNation-TopStories', 'USA Today'],
    // Tech & specialized
    ['https://www.wired.com/feed/rss', 'Wired'],
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
    const geo = geoTagText(item.title);
    if (geo) {
      geoNews.push({
        title: item.title.substring(0, 100),
        source: item.source,
        date: item.date,
        url: item.url,
        lat: geo.lat + (Math.random() - 0.5) * 2,
        lon: geo.lon + (Math.random() - 0.5) * 2,
        region: geo.region
      });
    }
  }

  geoNews.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return geoNews.slice(0, 100);
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
export async function synthesize(data) {
  const air = (data.sources.OpenSky?.hotspots || []).map(h => ({
    region: h.region, total: h.totalAircraft || 0, noCallsign: h.noCallsign || 0,
    highAlt: h.highAltitude || 0,
    top: Object.entries(h.byCountry || {}).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }));
  const thermal = (data.sources.FIRMS?.hotspots || []).map(h => ({
    region: h.region, det: h.totalDetections || 0, night: h.nightDetections || 0,
    hc: h.highConfidence || 0,
    fires: (h.highIntensity || []).slice(0, 8).map(f => ({ lat: f.lat, lon: f.lon, frp: f.frp || 0 }))
  }));
  const tSignals = data.sources.FIRMS?.signals || [];
  const chokepoints = Object.values(data.sources.Maritime?.chokepoints || {}).map(c => ({
    label: c.label || c.name, note: c.note || '', lat: c.lat || 0, lon: c.lon || 0
  }));
  const nuke = (data.sources.Safecast?.sites || []).map(s => ({
    site: s.site, anom: s.anomaly || false, cpm: s.avgCPM, n: s.recentReadings || 0
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

  const health = Object.entries(data.sources).map(([name, src]) => ({
    n: name, err: Boolean(src.error), stale: Boolean(src.stale)
  }));

  // === Yahoo Finance live market data ===
  const yfData = data.sources.YFinance || {};
  const yfQuotes = yfData.quotes || {};
  const markets = {
    indexes: (yfData.indexes || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct, history: q.history || []
    })),
    rates: (yfData.rates || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct
    })),
    commodities: (yfData.commodities || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct, history: q.history || []
    })),
    crypto: (yfData.crypto || []).map(q => ({
      symbol: q.symbol, name: q.name, price: q.price,
      change: q.change, changePct: q.changePct
    })),
    vix: yfQuotes['^VIX'] ? {
      value: yfQuotes['^VIX'].price,
      change: yfQuotes['^VIX'].change,
      changePct: yfQuotes['^VIX'].changePct,
    } : null,
    timestamp: yfData.summary?.timestamp || null,
  };

  // Override stale EIA prices with live Yahoo Finance data if available
  const yfWti = yfQuotes['CL=F'];
  const yfBrent = yfQuotes['BZ=F'];
  const yfNatgas = yfQuotes['NG=F'];
  if (yfWti?.price) energy.wti = yfWti.price;
  if (yfBrent?.price) energy.brent = yfBrent.price;
  if (yfNatgas?.price) energy.natgas = yfNatgas.price;
  if (yfWti?.history?.length) energy.wtiRecent = yfWti.history.map(h => h.close);

  // Fetch RSS
  const news = await fetchAllNews();

  // Crypto market data
  const cryptoData = data.sources.Crypto || {};
  const crypto = {
    btc: cryptoData.btc || null,
    eth: cryptoData.eth || null,
    dominance: cryptoData.dominance,
    marketCap: cryptoData.marketCap,
    volume24h: cryptoData.volume24h,
    timestamp: cryptoData.timestamp,
  };

  // Internet health & BGP hijacks
  const cloudflareData = data.sources.Cloudflare || {};
  const internet = {
    bgp: {
      hijacks: (cloudflareData.radar?.hijacks || []).map(h => ({
        asn: h.asn, asnName: h.asnName, location: h.location, severity: h.severity
      })),
      status: cloudflareData.radar?.status || 'NORMAL',
    },
    health: {
      global: cloudflareData.health?.global_ok_pct,
      regional: cloudflareData.health?.regional_health || {},
      status: cloudflareData.health?.status || 'UNKNOWN',
    },
    timestamp: cloudflareData.timestamp,
  };

  const V2 = {
    meta: data.crucix, air, thermal, tSignals, chokepoints, nuke, nukeSignals,
    sdr: { total: sdrNet.totalReceivers || 0, online: sdrNet.online || 0, zones: sdrZones },
    tg: { posts: tgData.totalPosts || 0, urgent: tgUrgent, topPosts: tgTop },
    who, fred, energy, bls, treasury, gscpi, defense, noaa, epa, acled, gdelt, space, health, news,
    markets, crypto, internet, // Live Yahoo Finance + Crypto + Internet health
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

  // Sort by timestamp descending, limit to 50
  feed.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return feed.slice(0, 50);
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
  const V2 = await synthesize(data);
  const llmProvider = createLLMProvider(config.llm);

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
