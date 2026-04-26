// Ollama Provider — raw fetch, no SDK
// Uses Ollama's OpenAI-compatible Chat Completions API
// No API key required — fully local inference

import { LLMProvider, createProbeError } from './provider.mjs';

export class OllamaProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'ollama';
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = config.model || 'llama3.1:8b';
  }

  get isConfigured() { return !!this.model; }

  async probe(opts = {}) {
    const startedAt = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(opts.timeout || 8000),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Ollama API ${res.status}: ${err.substring(0, 200)}`);
      }
      const data = await res.json();
      const models = Array.isArray(data?.models) ? data.models : [];
      const matched = models.find(item => item?.name === this.model || item?.model === this.model || String(item?.name || '').startsWith(`${this.model}:`));
      if (!matched) {
        throw new Error(`Ollama model not found: ${this.model}`);
      }
      return {
        ok: true,
        probeType: 'ollama-tags',
        classification: 'ready',
        model: matched.name || matched.model || this.model,
        text: `Model present in local Ollama catalog: ${matched.name || matched.model || this.model}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const wrapped = createProbeError(error, this.name);
      wrapped.probe = { ...(wrapped.probe || {}), probeType: 'ollama-tags' };
      throw wrapped;
    }
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens || 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 120000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Ollama API ${res.status}: ${err.substring(0, 200)}`);
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
