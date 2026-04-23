const DEFAULT_FRESHNESS_MINUTES = 60;

const SOURCE_CATALOG = {
  'GDELT': { category: 'news', trustClass: 'medium', freshnessTargetMinutes: 30, evidenceMode: 'event-database' },
  'OpenSky': { category: 'air', trustClass: 'high', freshnessTargetMinutes: 20, evidenceMode: 'live-sensor' },
  'FIRMS': { category: 'thermal', trustClass: 'high', freshnessTargetMinutes: 30, evidenceMode: 'satellite' },
  'Maritime': { category: 'maritime', trustClass: 'medium', freshnessTargetMinutes: 60, evidenceMode: 'derived-osint' },
  'Safecast': { category: 'radiation', trustClass: 'medium', freshnessTargetMinutes: 180, evidenceMode: 'sensor-network' },
  'ACLED': { category: 'conflict', trustClass: 'high', freshnessTargetMinutes: 1440, evidenceMode: 'curated-database' },
  'ReliefWeb': { category: 'humanitarian', trustClass: 'high', freshnessTargetMinutes: 180, evidenceMode: 'curated-feed' },
  'WHO': { category: 'health', trustClass: 'high', freshnessTargetMinutes: 360, evidenceMode: 'official-feed' },
  'OFAC': { category: 'sanctions', trustClass: 'high', freshnessTargetMinutes: 1440, evidenceMode: 'official-feed' },
  'OpenSanctions': { category: 'sanctions', trustClass: 'high', freshnessTargetMinutes: 1440, evidenceMode: 'curated-database' },
  'ADS-B': { category: 'air', trustClass: 'medium', freshnessTargetMinutes: 20, evidenceMode: 'live-sensor' },
  'FRED': { category: 'macro', trustClass: 'high', freshnessTargetMinutes: 1440, evidenceMode: 'official-api' },
  'Treasury': { category: 'macro', trustClass: 'high', freshnessTargetMinutes: 1440, evidenceMode: 'official-api' },
  'BLS': { category: 'macro', trustClass: 'high', freshnessTargetMinutes: 4320, evidenceMode: 'official-api' },
  'EIA': { category: 'energy', trustClass: 'high', freshnessTargetMinutes: 1440, evidenceMode: 'official-api' },
  'GSCPI': { category: 'macro', trustClass: 'high', freshnessTargetMinutes: 10080, evidenceMode: 'official-dataset' },
  'USAspending': { category: 'procurement', trustClass: 'high', freshnessTargetMinutes: 10080, evidenceMode: 'official-api' },
  'Comtrade': { category: 'trade', trustClass: 'high', freshnessTargetMinutes: 10080, evidenceMode: 'official-api' },
  'NOAA': { category: 'weather', trustClass: 'high', freshnessTargetMinutes: 60, evidenceMode: 'official-alerts' },
  'EPA': { category: 'environment', trustClass: 'high', freshnessTargetMinutes: 180, evidenceMode: 'official-sensor' },
  'Patents': { category: 'technology', trustClass: 'high', freshnessTargetMinutes: 10080, evidenceMode: 'official-api' },
  'Bluesky': { category: 'social', trustClass: 'low', freshnessTargetMinutes: 60, evidenceMode: 'social' },
  'Reddit': { category: 'social', trustClass: 'low', freshnessTargetMinutes: 60, evidenceMode: 'social' },
  'Telegram': { category: 'social', trustClass: 'low', freshnessTargetMinutes: 30, evidenceMode: 'social' },
  'KiwiSDR': { category: 'sdr', trustClass: 'medium', freshnessTargetMinutes: 180, evidenceMode: 'sensor-network' },
  'Space': { category: 'space', trustClass: 'medium', freshnessTargetMinutes: 360, evidenceMode: 'space-track' },
  'YFinance': { category: 'markets', trustClass: 'medium', freshnessTargetMinutes: 20, evidenceMode: 'market-feed' },
  'CISA-KEV': { category: 'cyber', trustClass: 'high', freshnessTargetMinutes: 1440, evidenceMode: 'official-feed' },
  'Cloudflare-Radar': { category: 'internet', trustClass: 'high', freshnessTargetMinutes: 60, evidenceMode: 'provider-telemetry' }
};

function parseTimestamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function summarizeError(error) {
  if (!error) return null;
  return String(error).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function classifyState(src = {}, ageMinutes, freshnessTargetMinutes) {
  if (src.error) return 'failed';
  if (src.stale) return 'stale';
  if (ageMinutes != null && ageMinutes > freshnessTargetMinutes) return 'stale';
  return 'ok';
}

export function buildSourceHealth(sweep = {}) {
  const sweepTimestampMs = parseTimestamp(sweep.crucix?.timestamp) || Date.now();
  const entries = Object.entries(sweep.sources || {}).map(([name, src]) => {
    const catalog = SOURCE_CATALOG[name] || {};
    const freshnessTargetMinutes = catalog.freshnessTargetMinutes || DEFAULT_FRESHNESS_MINUTES;
    const sourceTimestamp = parseTimestamp(src?.timestamp) || parseTimestamp(sweep.crucix?.timestamp);
    const ageMinutes = sourceTimestamp == null ? null : +((sweepTimestampMs - sourceTimestamp) / 60000).toFixed(1);
    const state = classifyState(src, ageMinutes, freshnessTargetMinutes);
    return {
      n: name,
      name,
      category: catalog.category || 'other',
      trustClass: catalog.trustClass || 'unknown',
      evidenceMode: catalog.evidenceMode || 'unknown',
      freshnessTargetMinutes,
      timestamp: sourceTimestamp == null ? null : new Date(sourceTimestamp).toISOString(),
      ageMinutes,
      state,
      err: state === 'failed',
      stale: state === 'stale',
      error: summarizeError(src?.error),
    };
  });

  const summary = {
    total: entries.length,
    ok: entries.filter(entry => entry.state === 'ok').length,
    stale: entries.filter(entry => entry.state === 'stale').length,
    failed: entries.filter(entry => entry.state === 'failed').length,
    byTrustClass: Object.fromEntries(
      ['high', 'medium', 'low', 'unknown'].map(key => [key, entries.filter(entry => entry.trustClass === key).length])
    ),
    byCategory: Object.fromEntries(
      Array.from(new Set(entries.map(entry => entry.category))).sort().map(category => [category, entries.filter(entry => entry.category === category).length])
    )
  };

  return { entries, summary };
}
