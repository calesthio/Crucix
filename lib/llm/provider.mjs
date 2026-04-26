// Base LLM Provider — all providers implement this interface

function classifyProbeFailure(error, providerName = 'unknown') {
  const message = String(error?.message || error || 'probe-failed').trim();
  const lower = message.toLowerCase();
  const statusMatch = message.match(/\b(\d{3})\b/);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  let classification = 'unknown';
  if (error?.name === 'TimeoutError' || lower.includes('timed out') || lower.includes('timeout') || lower.includes('abort')) {
    classification = 'timeout';
  } else if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('ehostunreach') ||
    lower.includes('network') ||
    lower.includes('socket')
  ) {
    classification = 'network';
  } else if (status === 401 || status === 403 || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid api key') || lower.includes('auth failed')) {
    classification = 'auth';
  } else if (status === 404 || lower.includes('model not found') || lower.includes('no such model') || lower.includes('unknown model') || lower.includes('not_found')) {
    classification = 'missing-model';
  } else if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    classification = 'rate-limited';
  } else if (status && status >= 500) {
    classification = 'provider';
  } else if (status && status >= 400) {
    classification = 'request';
  }

  return {
    provider: providerName,
    classification,
    status,
    message,
    retryable: ['network', 'timeout', 'rate-limited', 'provider'].includes(classification),
  };
}

function createProbeError(error, providerName = 'unknown') {
  const probe = classifyProbeFailure(error, providerName);
  const wrapped = error instanceof Error ? error : new Error(probe.message);
  wrapped.probe = { ...(wrapped.probe || {}), ...probe };
  return wrapped;
}

export class LLMProvider {
  constructor(config) {
    this.config = config;
    this.name = 'base';
  }

  /**
   * Complete a prompt with system + user messages
   * @returns {{ text: string, usage: { inputTokens: number, outputTokens: number }, model: string }}
   */
  async complete(systemPrompt, userMessage, opts = {}) {
    throw new Error(`${this.name}: complete() not implemented`);
  }

  async probe(opts = {}) {
    const startedAt = Date.now();
    let result;
    try {
      result = await this.complete(
        'You are a readiness probe. Reply with a single short token: READY.',
        'Return READY.',
        {
          maxTokens: opts.maxTokens || 8,
          timeout: opts.timeout || 8000,
        },
      );
    } catch (error) {
      throw createProbeError(error, this.name);
    }
    const text = String(result?.text || '').trim();
    if (!text) throw createProbeError(new Error(`${this.name}: empty probe response`), this.name);
    return {
      ok: true,
      probeType: 'synthetic-completion',
      classification: 'ready',
      model: result?.model || this.model || null,
      text,
      latencyMs: Date.now() - startedAt,
    };
  }

  get isConfigured() { return false; }
}

export { classifyProbeFailure, createProbeError };
