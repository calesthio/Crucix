// Google Gemini Provider — raw fetch, no SDK

import { LLMProvider } from './provider.mjs';

export class GeminiProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'gemini';
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-3.1-pro';
  }

  get isConfigured() { return !!this.apiKey; }

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
          // Gemini 2.5 models use thinking tokens from a separate budget;
          // set thinkingConfig to keep reasoning concise
          thinkingConfig: { thinkingBudget: 1024 },
        },
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    // Gemini 2.5+ models may return multiple parts (thinking + response)
    // Filter out thinking parts and concatenate the rest
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter(p => !p.thought)  // Skip thinking/reasoning parts
      .map(p => p.text || '')
      .join('\n')
      .trim() || '';

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
