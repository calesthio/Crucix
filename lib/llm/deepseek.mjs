// DeepSeek Provider — raw fetch, no SDK
// API compatible with OpenAI format

import { LLMProvider } from './provider.mjs';

export class DeepSeekProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'deepseek';
    this.apiKey = config.apiKey;
    this.model = config.model || 'deepseek-chat';
  }

  get isConfigured() {
    return !!this.apiKey;
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
        stream: false,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${err.substring(0, 200)}`);
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
