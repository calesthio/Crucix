// WHO — World Health Organization Global Health Observatory
// No auth required. Disease outbreak monitoring.

import { safeFetch } from '../utils/fetch.mjs';

const GHO_BASE = 'https://ghoapi.azureedge.net/api';
const DON_API = 'https://www.who.int/api/news/diseaseoutbreaknews';

// Get GHO indicator data
export async function getIndicator(code, opts = {}) {
  const { filter = '', top = 20 } = opts;
  let url = `${GHO_BASE}/${code}?$top=${top}&$orderby=TimeDim desc`;
  if (filter) url += `&$filter=${filter}`;
  return safeFetch(url);
}

// Key health indicators
const INDICATORS = {
  MDG_0000000020: 'TB incidence (per 100k)',
  MALARIA_EST_CASES: 'Malaria estimated cases',
  WHOSIS_000001: 'Life expectancy at birth',
  UHC_INDEX_REPORTED: 'UHC Service Coverage Index',
};

// Get Disease Outbreak News via WHO JSON API
// The old RSS feed at /feeds/entity/don/en/rss.xml returns 404.
// This JSON endpoint returns ~50 items; OData $orderby is ignored by
// the server, so we sort client-side by PublicationDate descending.
export async function getOutbreakNews() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(DON_API, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const items = data?.value || [];

    // Sort by PublicationDate descending (server ignores $orderby)
    items.sort((a, b) => {
      const da = new Date(a.PublicationDate || 0);
      const db = new Date(b.PublicationDate || 0);
      return db - da;
    });

    // Filter to last 30 days only
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = items.filter(item => new Date(item.PublicationDate || 0) >= cutoff);

    return recent.map(item => ({
      title: item.Title,
      date: item.PublicationDate,
      donId: item.DonId || null,
      url: item.ItemDefaultUrl
        ? `https://www.who.int/emergencies/disease-outbreak-news${item.ItemDefaultUrl}`
        : null,
      summary: (item.Summary || item.Overview || '').replace(/<[^>]*>/g, '').slice(0, 300) || null,
    }));
  } catch (e) {
    return { error: e.message };
  }
}

// Briefing
export async function briefing() {
  const outbreaks = await getOutbreakNews();

  return {
    source: 'WHO',
    timestamp: new Date().toISOString(),
    diseaseOutbreakNews: Array.isArray(outbreaks) ? outbreaks.slice(0, 15) : [],
    outbreakError: Array.isArray(outbreaks) ? null : outbreaks.error,
    monitoringCapabilities: [
      'Disease Outbreak News (DONs)',
      'Global health indicators (GHO)',
      'Pandemic early warning signals',
      'Cross-reference with GDELT health event mentions',
    ],
  };
}

if (process.argv[1]?.endsWith('who.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
