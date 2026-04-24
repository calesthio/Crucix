function toLowerText(value) {
  return String(value || '').toLowerCase();
}

function summarizeEmptyResult(src = {}) {
  if (!src || typeof src !== 'object') return false;
  const arrayKeys = [
    'hotspots', 'urgentPosts', 'topPosts', 'hdxDatasets', 'diseaseOutbreakNews', 'allArticles',
    'geoPoints', 'indexes', 'rates', 'commodities', 'crypto', 'alerts', 'stations', 'deadliestEvents',
    'recentLaunches', 'disruptionChecks', 'disruptionSignals'
  ];
  for (const key of arrayKeys) {
    if (Array.isArray(src[key]) && src[key].length > 0) return false;
  }
  const numericKeys = ['totalPosts', 'totalArticles', 'totalAlerts', 'totalReadings', 'totalEvents', 'totalNewObjects'];
  for (const key of numericKeys) {
    if (Number(src[key] || 0) > 0) return false;
  }
  const hasKnownEmptySignal =
    (Array.isArray(src.hdxDatasets) && src.hdxDatasets.length === 0) ||
    (Array.isArray(src.diseaseOutbreakNews) && src.diseaseOutbreakNews.length === 0) ||
    (Array.isArray(src.allArticles) && src.allArticles.length === 0) ||
    (Number(src.totalPosts) === 0 && src.status === 'ok') ||
    (Number(src.totalArticles) === 0) ||
    (Number(src.totalAlerts) === 0) ||
    (Number(src.totalReadings) === 0) ||
    (Number(src.totalEvents) === 0) ||
    (Number(src.totalNewObjects) === 0);
  return hasKnownEmptySignal;
}

export function classifySourceCounters(name, src = {}, sweep = {}) {
  const statusText = toLowerText(src.status);
  const errorText = [src.error, src.liveError, src.rwError, src.outbreakError].map(toLowerText).join(' ');
  const sourceText = toLowerText(src.source);
  const queryModeText = toLowerText(src.queryMode);
  const newsDebug = sweep.newsLlmDebug || {};

  const fallback =
    Boolean(src.fallback) ||
    Boolean(src.servedFromCache) ||
    src.cacheAgeMinutes != null ||
    Boolean(src.cached) ||
    statusText.includes('fallback') ||
    statusText.includes('web_scrape') ||
    sourceText.includes('fallback') ||
    queryModeText.includes('fallback') ||
    Boolean(src.rwError);

  const parseFailure =
    statusText.includes('parse') ||
    statusText.includes('invalid') ||
    errorText.includes('parse') ||
    errorText.includes('invalid json') ||
    errorText.includes('shape mismatch') ||
    errorText.includes('no-json-match');

  const llmFallback =
    name === 'GDELT' && (
      Boolean(newsDebug.fallbackReason) ||
      Number(newsDebug.heuristicFallbackCount || 0) > 0 ||
      Number(newsDebug.llmErrorCount || 0) > 0
    );

  const emptyResult = !src.error && !src.liveError && !src.rwError && !src.outbreakError && summarizeEmptyResult(src);

  return {
    fallbackCount: fallback ? 1 : 0,
    parseFailureCount: parseFailure ? 1 : 0,
    llmFallbackCount: llmFallback ? 1 : 0,
    emptyResultCount: emptyResult ? 1 : 0,
    fallback,
    parseFailure,
    llmFallback,
    emptyResult,
  };
}
