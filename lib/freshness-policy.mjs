import config from '../crucix.config.mjs';

export const DEFAULT_FRESHNESS_MINUTES = 60;

export const DEFAULT_SOURCE_POLICY = {
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
  'Cloudflare-Radar': { category: 'internet', trustClass: 'high', freshnessTargetMinutes: 60, evidenceMode: 'provider-telemetry' },
};

export const DEFAULT_AREA_POLICY = {
  air: { freshnessWarnMinutes: 30, freshnessStaleMultiplier: 4 },
  markets: { freshnessWarnMinutes: 20, freshnessStaleMultiplier: 4 },
  telegram: { freshnessWarnMinutes: 30, freshnessStaleMultiplier: 4 },
  news: { freshnessWarnMinutes: 120, freshnessStaleMultiplier: 4 },
};

function normalizePositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getFreshnessPolicy() {
  const configured = config.freshnessPolicy || {};
  const defaultMinutes = normalizePositiveNumber(configured.defaultFreshnessMinutes, DEFAULT_FRESHNESS_MINUTES);
  const sources = Object.fromEntries(
    Object.entries(DEFAULT_SOURCE_POLICY).map(([name, policy]) => {
      const override = configured.sources?.[name] || {};
      return [name, {
        ...policy,
        ...override,
        freshnessTargetMinutes: normalizePositiveNumber(override.freshnessTargetMinutes, policy.freshnessTargetMinutes),
      }];
    })
  );
  const areas = Object.fromEntries(
    Object.entries(DEFAULT_AREA_POLICY).map(([area, policy]) => {
      const override = configured.areas?.[area] || {};
      return [area, {
        ...policy,
        ...override,
        freshnessWarnMinutes: normalizePositiveNumber(override.freshnessWarnMinutes, policy.freshnessWarnMinutes),
        freshnessStaleMultiplier: normalizePositiveNumber(override.freshnessStaleMultiplier, policy.freshnessStaleMultiplier),
      }];
    })
  );
  return {
    defaultFreshnessMinutes: defaultMinutes,
    sources,
    areas,
  };
}

export function getSourcePolicy(name = '') {
  const policy = getFreshnessPolicy();
  return policy.sources[name] || {
    category: 'other',
    trustClass: 'unknown',
    freshnessTargetMinutes: policy.defaultFreshnessMinutes,
    evidenceMode: 'unknown',
  };
}

export function getAreaPolicy(area = '') {
  const policy = getFreshnessPolicy();
  return policy.areas[area] || { freshnessWarnMinutes: policy.defaultFreshnessMinutes, freshnessStaleMultiplier: 4 };
}
