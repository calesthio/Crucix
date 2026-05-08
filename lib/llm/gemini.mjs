// Google Gemini Provider — raw fetch, no SDK

import { LLMProvider, createProbeError } from './provider.mjs';

export class GeminiProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'gemini';
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-3.1-pro';
  }

  get isConfigured() { return !!this.apiKey; }

  async probe(opts = {}) {
    const startedAt = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(opts.timeout || 8000),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Gemini API ${res.status}: ${err.substring(0, 200)}`);
      }
      const data = await res.json();
      return {
        ok: true,
        probeType: 'model-metadata',
        classification: 'ready',
        model: data?.name?.replace(/^models\//, '') || this.model,
        text: `Gemini model metadata resolved for ${data?.name || this.model}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const wrapped = createProbeError(error, this.name);
      wrapped.probe = { ...(wrapped.probe || {}), probeType: 'model-metadata' };
      throw wrapped;
    }
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          maxOutputTokens: opts.maxTokens || 4096,
        },
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
      model: this.model,
    };
  }
}
