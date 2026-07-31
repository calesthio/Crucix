// MiniMax Provider — raw fetch, no SDK
// Uses MiniMax's OpenAI-compatible Chat Completions API

import { LLMProvider } from './provider.mjs';

// Default text model and the full set of supported text model IDs.
// `modelIds` is the authoritative list of currently supported models; the
// default is the first entry. An explicit `LLM_MODEL` override always wins.
const MINIMAX_DEFAULT_MODEL = 'MiniMax-M3';
const MINIMAX_MODEL_IDS = ['MiniMax-M3', 'MiniMax-M2.7'];

export class MiniMaxProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'minimax';
    this.apiKey = config.apiKey;
    this.model = config.model || MINIMAX_DEFAULT_MODEL;
    this.modelIds = MINIMAX_MODEL_IDS;
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
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
      throw new Error(`MiniMax API ${res.status}: ${err.substring(0, 200)}`);
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
