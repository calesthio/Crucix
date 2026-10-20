// MiniMax Provider — raw fetch, no SDK
// Uses MiniMax's OpenAI-compatible Chat Completions API

import { LLMProvider } from './provider.mjs';

// Current ordinary text models, with the default first. An explicit
// config.model / LLM_MODEL override still accepts legacy and custom IDs.
export const MINIMAX_MODEL_IDS = ['MiniMax-M3.1-Flash', 'MiniMax-M3'];
export const MINIMAX_DEFAULT_MODEL = MINIMAX_MODEL_IDS[0];

function imageContent(image) {
  if (typeof image === 'string') {
    return { type: 'image_url', image_url: { url: image } };
  }
  if (image?.type === 'image_url') return image;
  if (image?.url) return { type: 'image_url', image_url: { url: image.url } };
  if (image?.base64) {
    const mediaType = image.mimeType || image.mediaType || 'image/jpeg';
    return {
      type: 'image_url',
      image_url: { url: `data:${mediaType};base64,${image.base64}` },
    };
  }
  return image;
}

function userContent(userMessage, images) {
  if (!Array.isArray(images) || images.length === 0) return userMessage;
  return [{ type: 'text', text: userMessage }, ...images.map(imageContent)];
}

export class MiniMaxProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'minimax';
    this.apiKey = config.apiKey;
    this.model = config.model || MINIMAX_DEFAULT_MODEL;
    this.modelIds = [...MINIMAX_MODEL_IDS];
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    const body = {
      model: this.model,
      max_tokens: opts.maxTokens || 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        ...(Array.isArray(opts.history) ? opts.history : []),
        { role: 'user', content: userContent(userMessage, opts.images) },
      ],
    };
    if (opts.tools !== undefined) body.tools = opts.tools;
    if (opts.toolChoice !== undefined) body.tool_choice = opts.toolChoice;
    if (opts.reasoningEffort !== undefined) body.reasoning_effort = opts.reasoningEffort;
    if (opts.stream !== undefined) body.stream = opts.stream;

    const res = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout || 60000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`MiniMax API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message || {};
    return {
      text: message.content || '',
      reasoningContent: message.reasoning_content || '',
      toolCalls: message.tool_calls || [],
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
