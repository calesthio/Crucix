// Anthropic Claude Provider — raw fetch, no SDK

import { LLMProvider } from './provider.mjs';
import { LLMError } from '../errors.mjs';

export class AnthropicProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'anthropic';
    this.apiKey = config.apiKey;
    this.model = config.model || 'claude-sonnet-4-6';
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens || 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new LLMError(`Anthropic API ${res.status}: ${err.substring(0, 200)}`, { source: 'anthropic' });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
