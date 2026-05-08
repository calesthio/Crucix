// Grok Provider - raw fetch, no SDK

import { LLMProvider, createProbeError } from './provider.mjs';

export class GrokProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'grok';
    this.apiKey = config.apiKey;
    this.model = config.model || 'grok-4-latest';
  }

  get isConfigured() {
    return !!this.apiKey;
  }

  async probe(opts = {}) {
    const startedAt = Date.now();
    try {
      const res = await fetch(`https://api.x.ai/v1/models/${encodeURIComponent(this.model)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(opts.timeout || 8000),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Grok API ${res.status}: ${err.substring(0, 200)}`);
      }
      const data = await res.json();
      return {
        ok: true,
        probeType: 'model-metadata',
        classification: 'ready',
        model: data?.id || this.model,
        text: `Grok model metadata resolved for ${data?.id || this.model}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const wrapped = createProbeError(error, this.name);
      wrapped.probe = { ...(wrapped.probe || {}), probeType: 'model-metadata' };
      throw wrapped;
    }
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        max_tokens: opts.maxTokens || 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        model: this.model,
        stream: false,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Grok API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
