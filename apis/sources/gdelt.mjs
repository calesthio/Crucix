// GDELT — Global Database of Events, Language, and Tone
// No auth required. Updates every 15 minutes. Monitors news in 100+ languages.
// DOC 2.0 API: full-text search across last 3 months of global news
// GEO 2.0 API: geolocation mapping of events

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://api.gdeltproject.org/api/v2';

// Search recent global events/articles by keyword
export async function searchEvents(query = '', opts = {}) {
  const {
    mode = 'ArtList',       // ArtList, TimelineVol, TimelineVolInfo, TimelineTone, TimelineLang, TimelineSourceCountry
    maxRecords = 75,
    timespan = '24h',       // e.g. "24h", "7d", "3m"
    format = 'json',
    sortBy = 'DateDesc',    // DateDesc, DateAsc, ToneDesc, ToneAsc
  } = opts;

  // If no query, use broad geopolitical terms
  const q = query || 'conflict OR crisis OR military OR sanctions OR war OR economy';
  const params = new URLSearchParams({
    query: q,
    mode,
    maxrecords: String(maxRecords),
    timespan,
    format,
    sort: sortBy,
  });

  return safeFetch(`${BASE}/doc/doc?${params}`);
}

// Get tone/sentiment timeline for a topic
export async function toneTrend(query, timespan = '7d') {
  const params = new URLSearchParams({
    query,
    mode: 'TimelineTone',
    timespan,
    format: 'json',
  });
  return safeFetch(`${BASE}/doc/doc?${params}`);
}

// Get volume timeline for a topic (how much coverage)
export async function volumeTrend(query, timespan = '7d') {
  const params = new URLSearchParams({
    query,
    mode: 'TimelineVol',
    timespan,
    format: 'json',
  });
  return safeFetch(`${BASE}/doc/doc?${params}`);
}

// GEO API — geographic event mapping
export async function geoEvents(query = '', opts = {}) {
  const {
    mode = 'PointData',
    timespan = '24h',
    format = 'GeoJSON',
    maxPoints = 500,
  } = opts;

  const q = query || 'conflict OR military OR protest OR explosion';
  const params = new URLSearchParams({
    query: q,
    mode,
    timespan,
    format,
    maxpoints: String(maxPoints),
  });

  return safeFetch(`${BASE}/geo/geo?${params}`);
}

// Compact article for briefing
function compactArticle(a) {
  return {
    title: a.title,
    url: a.url,
    date: a.seendate,
    domain: a.domain,
    language: a.language,
    country: a.sourcecountry,
  };
}

// GDELT rate limit: 1 request per 5 seconds
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Briefing mode — get top global events summary (sequential due to rate limit)
export async function briefing() {
  // Single broad query to stay within rate limits
  const all = await searchEvents(
    'conflict OR military OR economy OR crisis OR war OR sanctions OR tariff OR strike OR outbreak',
    { maxRecords: 50, timespan: '24h' }
  );

  const articles = (all?.articles || []).map(compactArticle);

  // Categorize by keyword matching in titles
  const categorize = (keywords) => articles.filter(a =>
    keywords.some(k => a.title?.toLowerCase().includes(k))
  );

  // Geo events — get mapped event locations (separate API, respects rate limit)
  await delay(5500);
  let geoPoints = [];
  try {
    const geo = await geoEvents('conflict OR military OR protest OR crisis', { maxPoints: 30, timespan: '24h' });
    geoPoints = (geo?.features || []).filter(f => f.geometry?.coordinates).map(f => ({
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      name: f.properties?.name || f.properties?.html || '',
      count: f.properties?.count || 1,
      type: f.properties?.type || 'event',
    }));
  } catch (e) { /* geo endpoint optional — don't break briefing */ }

  return {
    source: 'GDELT',
    timestamp: new Date().toISOString(),
    totalArticles: articles.length,
    allArticles: articles,
    geoPoints,
    conflicts: categorize(['military', 'conflict', 'war', 'strike', 'missile', 'attack', 'bomb', 'troops']),
    economy: categorize(['economy', 'recession', 'inflation', 'market', 'sanctions', 'tariff', 'trade', 'gdp']),
    health: categorize(['pandemic', 'outbreak', 'epidemic', 'disease', 'virus', 'health']),
    crisis: categorize(['crisis', 'disaster', 'emergency', 'refugee', 'famine']),
  };
}

// Run standalone
if (process.argv[1]?.endsWith('gdelt.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
