function validTs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function ageMinutes(value, nowMs) {
  const ts = validTs(value);
  if (ts == null) return null;
  return +((nowMs - ts) / 60000).toFixed(1);
}

function classifyFreshness(age, warnMinutes) {
  if (age == null) return 'unknown';
  if (age <= warnMinutes) return 'fresh';
  if (age <= warnMinutes * 4) return 'aging';
  return 'stale';
}

function classifyEvidenceMode(source = {}) {
  if (source.degraded && source.cached) return 'fallback-cached';
  if (source.degraded && source.carriedForward) return 'degraded-carried';
  if (source.degraded) return 'degraded-live';
  if (source.cached) return 'cached';
  if (source.carriedForward) return 'carried-forward';
  return source.mode || 'live';
}

function compactModeTag(source = {}) {
  const mode = classifyEvidenceMode(source);
  if (mode === 'live' || mode === 'aggregated') return source.freshness;
  return `${source.freshness}/${mode}`;
}

export function buildEvidenceSummary({ nowTs, airMeta = {}, markets = {}, tg = {}, news = [], healthSummary = {}, openSkyHealth = null }) {
  const nowMs = validTs(nowTs) || Date.now();
  const marketAge = ageMinutes(markets.timestamp, nowMs);
  const telegramAge = ageMinutes(tg.topPosts?.[0]?.date || tg.urgent?.[0]?.date, nowMs);
  const newsAge = ageMinutes(news?.[0]?.date, nowMs);
  const airAge = ageMinutes(airMeta.timestamp, nowMs);

  const sources = [
    {
      area: 'air',
      source: airMeta.source || 'OpenSky',
      freshness: classifyFreshness(airAge, 30),
      ageMinutes: airAge,
      mode: airMeta.fallback ? 'fallback' : 'live',
      degraded: Boolean(openSkyHealth?.degraded),
      cached: airMeta.cacheAgeMinutes != null,
      carriedForward: Boolean(airMeta.carriedForwardCount),
      carriedForwardCount: airMeta.carriedForwardCount || 0,
      queriedRegionCount: airMeta.queriedRegionCount || 0,
      note: airMeta.liveError || airMeta.error || null,
    },
    {
      area: 'markets',
      source: 'YFinance',
      freshness: classifyFreshness(marketAge, 20),
      ageMinutes: marketAge,
      mode: 'live',
      degraded: false,
      cached: false,
      carriedForward: false,
      note: null,
    },
    {
      area: 'telegram',
      source: 'Telegram',
      freshness: classifyFreshness(telegramAge, 30),
      ageMinutes: telegramAge,
      mode: 'live',
      degraded: false,
      cached: false,
      carriedForward: false,
      note: null,
    },
    {
      area: 'news',
      source: 'RSS/GDELT',
      freshness: classifyFreshness(newsAge, 120),
      ageMinutes: newsAge,
      mode: 'aggregated',
      degraded: false,
      cached: false,
      carriedForward: false,
      note: null,
    }
  ];

  const sourcesWithMode = sources.map(source => ({
    ...source,
    evidenceMode: classifyEvidenceMode(source),
  }));

  return {
    sources: sourcesWithMode,
    counts: {
      fresh: sourcesWithMode.filter(s => s.freshness === 'fresh').length,
      aging: sourcesWithMode.filter(s => s.freshness === 'aging').length,
      stale: sourcesWithMode.filter(s => s.freshness === 'stale').length,
      degraded: sourcesWithMode.filter(s => s.degraded).length,
      cached: sourcesWithMode.filter(s => s.cached).length,
      carriedForward: sourcesWithMode.filter(s => s.carriedForward).length,
      failedSources: healthSummary.failed || 0,
    },
    headline: sourcesWithMode
      .map(s => `${s.area}:${compactModeTag(s)}`)
      .join(' | '),
  };
}
