// OpenRouter Provider — raw fetch, no SDK

import { LLMProvider, createProbeError } from './provider.mjs';

export class OpenRouterProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'openrouter';
    this.apiKey = config.apiKey;
    this.model = config.model || 'openrouter/auto';
  }

  get isConfigured() { return !!this.apiKey; }

  async probe(opts = {}) {
    const startedAt = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/calesthio/Crucix',
          'X-Title': 'Crucix',
        },
        signal: AbortSignal.timeout(opts.timeout || 8000),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`OpenRouter API ${res.status}: ${err.substring(0, 200)}`);
      }
      const data = await res.json();
      const models = Array.isArray(data?.data) ? data.data : [];
      const matched = models.find(item => item?.id === this.model);
      if (!matched && this.model !== 'openrouter/auto') {
        throw new Error(`OpenRouter model not found: ${this.model}`);
      }
      return {
        ok: true,
        probeType: 'model-catalog',
        classification: 'ready',
        model: matched?.id || this.model,
        text: `OpenRouter catalog reachable for ${matched?.id || this.model}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const wrapped = createProbeError(error, this.name);
      wrapped.probe = { ...(wrapped.probe || {}), probeType: 'model-catalog' };
      throw wrapped;
    }
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/calesthio/Crucix',
        'X-Title': 'Crucix',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens || 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenRouter API ${res.status}: ${err.substring(0, 200)}`);
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
