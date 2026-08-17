// Ollama Provider — raw fetch, no SDK
// Uses Ollama's OpenAI-compatible Chat Completions API
// No API key required — fully local inference

import { LLMProvider } from './provider.mjs';

export class OllamaProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'ollama';
    this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = config.model || 'llama3.1:8b';
    // Optional reasoning-effort passthrough: set to 'none' to run hybrid
    // models (e.g. qwen3) as pure instruct models without thinking overhead.
    this.reasoningEffort = config.reasoningEffort || null;
  }

  get isConfigured() { return !!this.model; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 4096,
        ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeout || 120000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Ollama API ${res.status}: ${err.substring(0, 2000)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0] || {};
    const text = choice.message?.content || '';
    const finishReason = choice.finish_reason || null;

    // Reasoning models (e.g. qwen3.8) can spend the entire token budget on
    // internal reasoning and return empty content with finish_reason=length.
    // Surface that as an explicit error instead of a silent empty success.
    if (!text && finishReason === 'length') {
      throw new Error(
        `Ollama ${this.model}: no content generated (finish_reason=length) — the token budget was consumed by reasoning. Increase maxTokens.`,
      );
    }

    return {
      text,
      finishReason,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
