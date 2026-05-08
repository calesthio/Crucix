const X_ACQUISITION_TIERS = ['manual-url', 'manual-text', 'public-fetch', 'browser-assisted', 'formal-api'];

function trimString(value, max = 4000) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

export function getSocialLeadAcquisitionCapabilities(env = process.env) {
  return {
    publicFetch: String(env.SOCIAL_LEADS_X_PUBLIC_FETCH_ENABLED || '').trim().toLowerCase() === 'true',
    browserAssisted: String(env.SOCIAL_LEADS_X_BROWSER_ASSISTED_ENABLED || '').trim().toLowerCase() === 'true',
    formalApi: false,
  };
}

export function listAcquisitionTiers() {
  return [...X_ACQUISITION_TIERS];
}

export function planSocialLeadAcquisition(input = {}, capabilities = getSocialLeadAcquisitionCapabilities()) {
  const requestedTier = trimString(input.acquisitionTier || (input.postUrl ? 'manual-url' : 'manual-text'), 100) || 'manual-text';
  const hasPostUrl = Boolean(trimString(input.postUrl || input.url || '', 4000));
  const hasText = Boolean(trimString(input.rawText || input.text || '', 20000));
  const hasThreadContext = Array.isArray(input.quotedThreadText || input.threadContext) && (input.quotedThreadText || input.threadContext).some(value => trimString(value, 4000));

  let resolvedTier = requestedTier;
  let retrievalStatus = 'provided-by-operator';
  let degradation = null;
  let nextAction = null;

  const supported = new Set(X_ACQUISITION_TIERS);
  if (!supported.has(requestedTier)) {
    resolvedTier = hasText || hasThreadContext ? (hasPostUrl ? 'manual-url' : 'manual-text') : 'manual-url';
    degradation = {
      from: requestedTier,
      to: resolvedTier,
      reason: 'unsupported-acquisition-tier',
    };
    retrievalStatus = 'degraded-to-supported-tier';
  }

  if (requestedTier === 'public-fetch' && !capabilities.publicFetch) {
    resolvedTier = hasText || hasThreadContext ? (hasPostUrl ? 'manual-url' : 'manual-text') : 'manual-url';
    degradation = {
      from: requestedTier,
      to: resolvedTier,
      reason: 'public-fetch-not-enabled',
    };
    retrievalStatus = hasText || hasThreadContext ? 'degraded-to-operator-evidence' : 'manual-evidence-required';
    nextAction = hasText || hasThreadContext ? null : 'Provide pasted post text or use browser-assisted retrieval for this URL.';
  }

  if (requestedTier === 'browser-assisted' && !capabilities.browserAssisted) {
    resolvedTier = hasText || hasThreadContext ? (hasPostUrl ? 'manual-url' : 'manual-text') : 'manual-url';
    degradation = {
      from: requestedTier,
      to: resolvedTier,
      reason: 'browser-assisted-not-enabled',
    };
    retrievalStatus = hasText || hasThreadContext ? 'degraded-to-operator-evidence' : 'manual-evidence-required';
    nextAction = hasText || hasThreadContext ? null : 'Browser-assisted retrieval is not enabled. Provide pasted post text or enable the browser-assisted path for this URL.';
  }

  if (requestedTier === 'formal-api') {
    resolvedTier = hasText || hasThreadContext ? (hasPostUrl ? 'manual-url' : 'manual-text') : 'manual-url';
    degradation = {
      from: requestedTier,
      to: resolvedTier,
      reason: 'formal-api-not-implemented',
    };
    retrievalStatus = hasText || hasThreadContext ? 'degraded-to-operator-evidence' : 'manual-evidence-required';
    nextAction = hasText || hasThreadContext ? null : 'Formal X API retrieval is not implemented yet. Provide pasted post text or keep this as a URL-only lead pending later retrieval.';
  }

  if ((requestedTier === 'public-fetch' || requestedTier === 'browser-assisted' || requestedTier === 'formal-api') && !hasPostUrl) {
    resolvedTier = hasText || hasThreadContext ? 'manual-text' : resolvedTier;
    degradation = {
      from: requestedTier,
      to: resolvedTier,
      reason: 'url-required-for-requested-tier',
    };
    retrievalStatus = hasText || hasThreadContext ? 'degraded-to-operator-evidence' : 'manual-evidence-required';
    nextAction = hasText || hasThreadContext ? null : 'Provide a specific X URL for non-manual acquisition tiers.';
  }

  const evidenceSupplied = hasText || hasThreadContext;
  const allowUrlOnlyPlaceholder = hasPostUrl && !evidenceSupplied;
  const needsManualEvidence = !evidenceSupplied;

  return {
    requestedTier,
    resolvedTier,
    retrievalStatus,
    degradation,
    nextAction,
    evidenceSupplied,
    allowUrlOnlyPlaceholder,
    needsManualEvidence,
    capabilities: {
      publicFetch: Boolean(capabilities.publicFetch),
      browserAssisted: Boolean(capabilities.browserAssisted),
      formalApi: Boolean(capabilities.formalApi),
    },
  };
}
