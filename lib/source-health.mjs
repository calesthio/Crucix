import { getFreshnessPolicy, getSourcePolicy } from './freshness-policy.mjs';

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
  if (src.degraded) return 'degraded';
  if (src.error) return 'failed';
  if (src.stale) return 'stale';
  if (ageMinutes != null && ageMinutes > freshnessTargetMinutes) return 'stale';
  return 'ok';
}

export function buildSourceHealth(sweep = {}) {
  const sweepTimestampMs = parseTimestamp(sweep.crucix?.timestamp) || Date.now();
  const policy = getFreshnessPolicy();
  const entries = Object.entries(sweep.sources || {}).map(([name, src]) => {
    const sourcePolicy = getSourcePolicy(name);
    const freshnessTargetMinutes = sourcePolicy.freshnessTargetMinutes || policy.defaultFreshnessMinutes;
    const sourceTimestamp = parseTimestamp(src?.timestamp) || parseTimestamp(sweep.crucix?.timestamp);
    const ageMinutes = sourceTimestamp == null ? null : +((sweepTimestampMs - sourceTimestamp) / 60000).toFixed(1);
    const state = classifyState(src, ageMinutes, freshnessTargetMinutes);
    return {
      n: name,
      name,
      category: sourcePolicy.category || 'other',
      trustClass: sourcePolicy.trustClass || 'unknown',
      evidenceMode: sourcePolicy.evidenceMode || 'unknown',
      freshnessTargetMinutes,
      timestamp: sourceTimestamp == null ? null : new Date(sourceTimestamp).toISOString(),
      ageMinutes,
      state,
      err: state === 'failed',
      degraded: state === 'degraded',
      stale: state === 'stale',
      error: summarizeError(src?.error),
    };
  });

  const summary = {
    total: entries.length,
    ok: entries.filter(entry => entry.state === 'ok').length,
    degraded: entries.filter(entry => entry.state === 'degraded').length,
    stale: entries.filter(entry => entry.state === 'stale').length,
    failed: entries.filter(entry => entry.state === 'failed').length,
    byTrustClass: Object.fromEntries(
      ['high', 'medium', 'low', 'unknown'].map(key => [key, entries.filter(entry => entry.trustClass === key).length])
    ),
    byCategory: Object.fromEntries(
      Array.from(new Set(entries.map(entry => entry.category))).sort().map(category => [category, entries.filter(entry => entry.category === category).length])
    ),
    policy: {
      defaultFreshnessMinutes: policy.defaultFreshnessMinutes,
      sourceCount: Object.keys(policy.sources || {}).length,
    },
  };

  return { entries, summary, policy };
}
