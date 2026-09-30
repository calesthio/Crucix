export function sourceHealth(source, failure) {
  const detail = failure || source?.error || firstError(source) || source?.message || null;
  let status = 'healthy';
  if (!source || failure) status = 'failed';
  else if (['no_key', 'no_credentials', 'disabled'].includes(source.status)
    || /no .*key|no_credentials|missing .*key/i.test(String(source.error || ''))) status = 'unconfigured';
  else if ((source.error || ['error', 'failed'].includes(source.status)) && !source.stale) status = 'failed';
  else if (source.stale || ['limited', 'partial', 'degraded', 'no_data'].includes(source.status) || hasErrors(source)) status = 'degraded';
  return { status, err: status !== 'healthy', stale: Boolean(source?.stale), detail };
}

function hasErrors(value) {
  return Boolean(firstError(value));
}

function firstError(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'errors' && Array.isArray(item) && item.length) return JSON.stringify(item[0]);
    if (/error$/i.test(key) && item) return String(item);
    const nested = firstError(item);
    if (nested) return nested;
  }
  return null;
}

export function summarizeSourceHealth(data) {
  const sources = data.sources || {};
  const failures = new Map((data.errors || []).map(item => [item.name, item.error]));
  const names = new Set([...Object.keys(sources), ...failures.keys(), ...Object.keys(data.timing || {})]);
  const health = [...names].map(name => ({ n: name, ...sourceHealth(sources[name], failures.get(name)) }));
  const counts = { sourcesQueried: health.length, sourcesOk: 0, sourcesDegraded: 0, sourcesUnconfigured: 0, sourcesFailed: 0 };
  const fields = { healthy: 'sourcesOk', degraded: 'sourcesDegraded', unconfigured: 'sourcesUnconfigured', failed: 'sourcesFailed' };
  for (const source of health) counts[fields[source.status]]++;
  return { health, counts };
}
