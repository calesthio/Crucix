// Base LLM Provider — all providers implement this interface

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
    const result = await this.complete(
      'You are a readiness probe. Reply with a single short token: READY.',
      'Return READY.',
      {
        maxTokens: opts.maxTokens || 8,
        timeout: opts.timeout || 8000,
      },
    );
    const text = String(result?.text || '').trim();
    if (!text) throw new Error(`${this.name}: empty probe response`);
    return {
      ok: true,
      model: result?.model || this.model || null,
      text,
      latencyMs: Date.now() - startedAt,
    };
  }

  get isConfigured() { return false; }
}
