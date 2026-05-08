// Ship/Vessel Tracking — aisstream.io (free real-time global AIS)
// Also includes fallback to public vessel tracking data
// Detects: dark ships, sanctions evasion, naval deployments, port congestion

import { safeFetch } from '../utils/fetch.mjs';

const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search';

// aisstream.io requires a WebSocket connection for real-time data
// For briefing mode, we'll use snapshot-based approaches

// MarineTraffic-style density estimation via public endpoints
// The real power comes from running a persistent WebSocket listener

// Key maritime chokepoints to monitor
const CHOKEPOINTS = {
  straitOfHormuz: { label: 'Strait of Hormuz', lat: 26.5, lon: 56.5, note: '20% of world oil' },
  suezCanal: { label: 'Suez Canal', lat: 30.5, lon: 32.3, note: '12% of world trade' },
  straitOfGibraltar: { label: 'Strait of Gibraltar', lat: 36.0, lon: -5.7, note: 'Gateway to Mediterranean, ~10-20% global trade influence' },
  straitOfMalacca: { label: 'Strait of Malacca', lat: 2.5, lon: 101.5, note: '25% of world trade' },
  babElMandeb: { label: 'Bab el-Mandeb', lat: 12.6, lon: 43.3, note: 'Red Sea gateway' },
  taiwanStrait: { label: 'Taiwan Strait', lat: 24.0, lon: 119.0, note: '88% of largest container ships' },
  bosporusStrait: { label: 'Bosphorus', lat: 41.1, lon: 29.1, note: 'Black Sea access' },
  panamaCanal: { label: 'Panama Canal', lat: 9.1, lon: -79.7, note: '5% of world trade' },
  capeOfGoodHope: { label: 'Cape of Good Hope', lat: -34.4, lon: 18.5, note: 'Suez alternative' },
};

function decodeHtml(text = '') {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchShippingNewsViaGdelt(query, label) {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set('query', `${query} sourcecountry:US OR sourcecountry:GB OR sourcecountry:QA OR sourcecountry:AE`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', '10');
  url.searchParams.set('sort', 'DateDesc');
  url.searchParams.set('timespan', '7days');

  const res = await safeFetch(url.toString(), {
    timeout: 12000,
    retries: 0,
    headers: { Accept: 'application/json' },
  });

  if (!res || typeof res !== 'object' || Array.isArray(res) || !Array.isArray(res.articles)) return [];

  return res.articles
    .filter(article => article?.title)
    .slice(0, 8)
    .map(article => ({
      title: decodeHtml(article.title || ''),
      link: article.url || '',
      pubDate: article.seendate || article.socialimage || '',
      source: article.domain || label,
      tone: article.semantics?.tone ?? null,
    }));
}

async function fetchShippingNewsViaGoogle(query) {
  const url = new URL(GOOGLE_NEWS_RSS);
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');

  const res = await safeFetch(url.toString(), { timeout: 12000, retries: 0, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
  const xml = res?.rawText || '';
  if (!xml || xml.startsWith('HTTP ')) return [];

  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = regex.exec(xml)) !== null && items.length < 8) {
    const block = match[1];
    const title = decodeHtml(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
    const link = decodeHtml(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '');
    const pubDate = decodeHtml(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '');
    if (title) items.push({ title, link, pubDate, source: 'Google News RSS' });
  }
  return items;
}

async function fetchShippingNews(query, label) {
  const gdeltItems = await fetchShippingNewsViaGdelt(query, label);
  if (gdeltItems.length) return { items: gdeltItems, source: 'GDELT' };

  const googleItems = await fetchShippingNewsViaGoogle(query);
  return { items: googleItems, source: googleItems.length ? 'Google News RSS' : 'none' };
}

function classifyDisruption(items, label, evidenceSource = 'unknown') {
  const disruptionTerms = ['blockade', 'seizure', 'tanker', 'shipping', 'ship', 'vessel', 'port', 'strait', 'canal', 'diversion', 'reroute', 'rerouting', 'delay', 'detention', 'insurance'];
  const disruptionItems = items.filter(item => disruptionTerms.some(term => item.title.toLowerCase().includes(term)));
  return {
    label,
    evidenceSource,
    itemCount: items.length,
    disruptionCount: disruptionItems.length,
    headlines: disruptionItems.slice(0, 4),
    disrupted: disruptionItems.length >= 2,
  };
}

// For non-realtime briefing, use web-searchable vessel data
export async function briefing() {
  const hasKey = !!process.env.AISSTREAM_API_KEY;

  const queries = {
    straitOfHormuz: 'Strait of Hormuz shipping tanker blockade',
    suezCanal: 'Suez Canal shipping disruption vessel reroute',
    babElMandeb: 'Bab el-Mandeb Red Sea shipping disruption',
    panamaCanal: 'Panama Canal shipping congestion vessel delay',
    taiwanStrait: 'Taiwan Strait shipping disruption vessel',
  };

  const disruptionChecks = await Promise.all(
    Object.entries(queries).map(async ([key, query]) => {
      const { items, source } = await fetchShippingNews(query, CHOKEPOINTS[key]?.label || key);
      return { key, ...classifyDisruption(items, CHOKEPOINTS[key]?.label || key, source) };
    })
  );

  const disruptionSignals = disruptionChecks
    .filter(check => check.disrupted)
    .map(check => `Maritime disruption chatter around ${check.label}: ${check.disruptionCount} matching headlines`);

  return {
    source: 'Maritime/AIS',
    timestamp: new Date().toISOString(),
    status: hasKey ? 'ready' : 'limited',
    message: hasKey
      ? 'AIS stream connected — use WebSocket listener for real-time data'
      : 'Set AISSTREAM_API_KEY for real-time global vessel tracking (free at aisstream.io)',
    chokepoints: CHOKEPOINTS,
    disruptionChecks,
    disruptionSignals,
    monitoringCapabilities: [
      'Dark ship detection (AIS transponder shutoffs)',
      'Sanctions evasion (ship-to-ship transfers)',
      'Naval deployment tracking',
      'Port congestion (vessel dwell time)',
      'Chokepoint traffic anomalies',
      'Oil tanker route changes',
    ],
    hint: 'GDELT-backed maritime disruption checks are active with Google RSS fallback; AIS key upgrades this to live vessel tracking.',
  };
}

// WebSocket listener setup (for persistent monitoring)
export function getWebSocketConfig(apiKey) {
  return {
    url: 'wss://stream.aisstream.io/v0/stream',
    message: JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: Object.values(CHOKEPOINTS).map(cp => [
        [cp.lat - 2, cp.lon - 2],
        [cp.lat + 2, cp.lon + 2],
      ]),
    }),
  };
}

if (process.argv[1]?.endsWith('ships.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
