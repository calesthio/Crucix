// Cursor Provider — uses cursor-api-proxy SDK (proxy auto-starts on first use)

import { LLMProvider } from './provider.mjs';
import { createCursorProxyClient } from 'cursor-api-proxy';

export class CursorProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'cursor';
    this.baseUrl = config.baseUrl ?? process.env.LLM_CURSOR_BASE_URL ?? undefined;
    this.apiKey = config.apiKey ?? process.env.LLM_API_KEY ?? undefined;
    this.model = config.model ?? process.env.LLM_MODEL ?? 'auto';
    this._client = null;
  }

  get isConfigured() {
    return true;
  }

  _getClient() {
    if (!this._client) {
      this._client = createCursorProxyClient({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        startProxy: !this.baseUrl,
      });
    }
    return this._client;
  }

  async complete(systemPrompt, userMessage, opts = {}) {
    const client = this._getClient();
    try {
      const data = await client.chatCompletionsCreate({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      if (data.error?.message) {
        throw new Error(data.error.message);
      }

      const text = data.choices?.[0]?.message?.content ?? '';
      const usage = data.usage ?? {};
      return {
        text,
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
        },
        model: data.model ?? this.model,
      };
    } catch (err) {
      throw new Error(`Cursor proxy: ${err.message}`);
    }
  }
}
