const KNOWN_PRICING = {
  ollama: { type: 'local', inputPer1kUsd: 0, outputPer1kUsd: 0 },
};

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function summarizeUsage(usage = {}) {
  const inputTokens = Math.max(0, toNumber(usage?.inputTokens));
  const outputTokens = Math.max(0, toNumber(usage?.outputTokens));
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function estimateCostUsd({ provider = null, usage = {} } = {}) {
  const pricing = KNOWN_PRICING[String(provider || '').toLowerCase()] || null;
  const normalized = summarizeUsage(usage);
  if (!pricing) {
    return {
      available: false,
      estimatedCostUsd: null,
      costBasis: 'pricing-unavailable',
      ...normalized,
    };
  }
  const estimatedCostUsd = Number((((normalized.inputTokens / 1000) * pricing.inputPer1kUsd) + ((normalized.outputTokens / 1000) * pricing.outputPer1kUsd)).toFixed(6));
  return {
    available: true,
    estimatedCostUsd,
    costBasis: pricing.type === 'local' ? 'local-provider' : 'estimated-known-rate',
    ...normalized,
  };
}

export function buildLlmCallTelemetry({ provider = null, model = null, usage = {}, latencyMs = null, timeoutMs = null, completion = null, surface = null } = {}) {
  const cost = estimateCostUsd({ provider, usage });
  return {
    surface: surface || null,
    provider: provider || null,
    model: model || null,
    latencyMs: Number.isFinite(Number(latencyMs)) ? Math.max(0, Number(latencyMs)) : null,
    timeoutMs: Number.isFinite(Number(timeoutMs)) ? Math.max(0, Number(timeoutMs)) : null,
    completion: completion || null,
    usage: {
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      totalTokens: cost.totalTokens,
    },
    cost: {
      available: cost.available,
      estimatedUsd: cost.estimatedCostUsd,
      basis: cost.costBasis,
    },
  };
}

export function combineLlmTelemetry(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const completions = {};
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalLatencyMs = 0;
  let measuredLatencyCount = 0;
  let estimatedUsd = 0;
  let costAvailableCount = 0;

  for (const item of list) {
    const completion = item.completion || 'unknown';
    completions[completion] = (completions[completion] || 0) + 1;
    usage.inputTokens += toNumber(item.usage?.inputTokens);
    usage.outputTokens += toNumber(item.usage?.outputTokens);
    usage.totalTokens += toNumber(item.usage?.totalTokens);
    if (Number.isFinite(Number(item.latencyMs))) {
      totalLatencyMs += Number(item.latencyMs);
      measuredLatencyCount += 1;
    }
    if (item.cost?.available && Number.isFinite(Number(item.cost?.estimatedUsd))) {
      estimatedUsd += Number(item.cost.estimatedUsd);
      costAvailableCount += 1;
    }
  }

  return {
    callCount: list.length,
    measuredLatencyCount,
    totalLatencyMs,
    avgLatencyMs: measuredLatencyCount ? Math.round(totalLatencyMs / measuredLatencyCount) : null,
    maxLatencyMs: list.reduce((max, item) => Number.isFinite(Number(item?.latencyMs)) ? Math.max(max, Number(item.latencyMs)) : max, 0) || null,
    usage,
    cost: {
      available: costAvailableCount > 0,
      estimatedUsd: costAvailableCount > 0 ? Number(estimatedUsd.toFixed(6)) : null,
      measuredCallCount: costAvailableCount,
    },
    completions,
  };
}
