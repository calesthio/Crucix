// WHO — World Health Organization Global Health Observatory
// No auth required. Disease outbreak monitoring.

import { safeFetch } from '../utils/fetch.mjs';

const GHO_BASE = 'https://ghoapi.azureedge.net/api';
const DON_API = 'https://www.who.int/api/news/diseaseoutbreaknews';
const DON_QUERY = '?$top=25&$orderby=PublicationDate desc&$expand=Regions,EmergencyEvent';

function extractCaseSignalScore(text = '') {
  const normalized = text.toLowerCase();
  let score = 0;

  const keywordWeights = [
    [/marburg|ebola/i, 35],
    [/cholera|polio|yellow fever|meningitis/i, 24],
    [/mpox|avian influenza|influenza a\(h5n1\)|measles|dengue/i, 18],
    [/death|deaths|fatal|fatalities|killed/i, 22],
    [/community transmission|cross-border|rapid spread|surge/i, 14],
    [/vaccination|containment|response update/i, -4],
  ];

  for (const [pattern, weight] of keywordWeights) {
    if (pattern.test(normalized)) score += weight;
  }

  const cases = normalized.match(/(\d[\d,\.]*)\s+(case|cases)/i);
  const deaths = normalized.match(/(\d[\d,\.]*)\s+(death|deaths|fatalities)/i);
  if (cases) score += Math.min(18, Math.floor(Number(cases[1].replace(/[^\d]/g, '')) / 50));
  if (deaths) score += Math.min(20, Math.floor(Number(deaths[1].replace(/[^\d]/g, '')) / 5));

  return score;
}

function rankOutbreak(item) {
  const combinedText = [item.Title, item.Summary, item.Overview, item.Assessment]
    .filter(Boolean)
    .join(' ');
  const contentScore = extractCaseSignalScore(combinedText);
  const recencyDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(item.PublicationDate || 0).getTime()) / (24 * 60 * 60 * 1000))
  );
  const recencyBoost = Math.max(0, 40 - recencyDays);
  const stalenessPenalty = recencyDays > 180
    ? Math.min(50, Math.floor((recencyDays - 180) / 30))
    : 0;
  const severityScore = Math.max(0, recencyBoost + contentScore - stalenessPenalty);

  let severity = 'monitor';
  if (severityScore >= 55) severity = 'critical';
  else if (severityScore >= 35) severity = 'high';
  else if (severityScore >= 20) severity = 'elevated';

  return { severityScore, severity };
}

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

function stripHtml(text, limit = 300) {
  return (text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, limit) || null;
}

// Get Disease Outbreak News via WHO JSON API.
// As of 2026-05-17, the official `outbreaks` endpoint exists but returns an
// empty array, while `diseaseoutbreaknews` returns the live DON items.
export async function getOutbreakNews() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${DON_API}${DON_QUERY}`, {
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

    // Prefer recent items, but the official DON feed is sparse and may go
    // many months without new records. Fall back to the latest available
    // entries so the UI can still show the official WHO alert set.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = items.filter(item => new Date(item.PublicationDate || 0) >= cutoff);
    const selectedItems = recent.length > 0 ? recent : items;

    const mapped = selectedItems
      .map(item => {
        const { severityScore, severity } = rankOutbreak(item);
        return {
          title: item.Title,
          date: item.PublicationDate,
          lastModified: item.LastModified || null,
          donId: item.DonId || null,
          url: item.ItemDefaultUrl
            ? `https://www.who.int/emergencies/disease-outbreak-news/item${item.ItemDefaultUrl}`
            : null,
          summary: stripHtml(item.Summary || item.Overview, 420),
          overview: stripHtml(item.Overview, 560),
          assessment: stripHtml(item.Assessment, 320),
          response: stripHtml(item.Response, 260),
          whoRegion: item.Regions?.Title || null,
          whoRegionCode: item.Regions?.WhoRegionCode || null,
          emergencyEvent: item.EmergencyEvent?.Title || null,
          emergencyEventId: item.EmergencyEvent?.EventId || null,
          emergencyEventStartDate: item.EmergencyEvent?.EmergencyEventStartDate || null,
          severity,
          severityScore,
        };
      })
      .sort((a, b) => {
        if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
        return new Date(b.date || 0) - new Date(a.date || 0);
      });

    const deduped = [];
    const seen = new Set();
    for (const item of mapped) {
      const key = `${item.emergencyEventId || item.emergencyEvent || item.title}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    return deduped;
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
