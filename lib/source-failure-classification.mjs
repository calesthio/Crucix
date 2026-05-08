function text(value) {
  return String(value || '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function containsAny(haystack, needles = []) {
  return needles.some(needle => haystack.includes(needle));
}

export function classifySourceFailure(name, src = {}) {
  const status = lower(src.status);
  const rawStatus = lower(src.rawStatus);
  const source = text(src.source);
  const error = text(src.error || src.liveError || src.rwError || src.outbreakError);
  const note = text(src.rwNote || src.message || src.hint);
  const combined = lower([status, rawStatus, error, note, source].filter(Boolean).join(' | '));
  const hasFailureSignal = Boolean(
    error || note || ['error', 'no_key', 'no_credentials', 'limited', 'parse_error'].includes(status) || rawStatus
  );

  if (!hasFailureSignal) {
    return {
      class: 'none',
      severity: 'info',
      operatorLabel: 'No failure classification needed',
      reason: null,
    };
  }

  if (containsAny(combined, ['no fred api key', 'no eia api key', 'no acled credentials', 'no credentials', 'no_key', 'no key configured', 'requires oauth', 'set adsb_api_key', 'set reliefweb_appname', 'set firms_map_key', 'set acled_email', 'set acled_password', 'register at https://acleddata.com/user/register'])) {
    return {
      class: 'setup-debt',
      severity: 'warning',
      operatorLabel: 'Setup debt',
      reason: error || note || `Missing credentials or app setup for ${name}`,
    };
  }

  if (containsAny(combined, ['request_not_processed', 'threshold for total number of requests', 'http 429', 'blocked due to bot activity', 'cooldown active', 'cooldown-active'])) {
    return {
      class: 'external-limit',
      severity: 'warning',
      operatorLabel: 'External limit',
      reason: error || note || `Rate limit, quota, or provider policy issue affecting ${name}`,
    };
  }

  if (containsAny(combined, ['fetch failed', 'timeout', 'timed out', 'temporarily unavailable', 'returned no data', 'http 5', 'network'])) {
    return {
      class: 'live-outage',
      severity: 'critical',
      operatorLabel: 'Live outage',
      reason: error || note || `Live upstream or network failure affecting ${name}`,
    };
  }

  if (containsAny(combined, ['parse', 'invalid json', 'shape mismatch', 'no-json-match'])) {
    return {
      class: 'parse-failure',
      severity: 'warning',
      operatorLabel: 'Parse failure',
      reason: error || note || `Malformed upstream payload for ${name}`,
    };
  }

  if (status === 'limited') {
    return {
      class: 'setup-debt',
      severity: 'info',
      operatorLabel: 'Limited by missing integration',
      reason: note || error || `${name} is running in limited mode without full integration`,
    };
  }

  if (status === 'error') {
    return {
      class: 'live-outage',
      severity: 'critical',
      operatorLabel: 'Live outage',
      reason: error || note || `${name} reported an unspecified live error`,
    };
  }

  return {
    class: 'other-failure',
    severity: 'warning',
    operatorLabel: 'Other failure',
    reason: error || note || `${name} reported an unclassified failure state`,
  };
}
