// LLM factory (index.mjs) — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { AnthropicProvider } from '../lib/llm/anthropic.mjs';
import { OpenAIProvider } from '../lib/llm/openai.mjs';
import { GeminiProvider } from '../lib/llm/gemini.mjs';
import { GrokProvider } from '../lib/llm/grok.mjs';
import { OpenRouterProvider } from '../lib/llm/openrouter.mjs';
import { MiniMaxProvider } from '../lib/llm/minimax.mjs';
import { MistralProvider } from '../lib/llm/mistral.mjs';
import { OllamaProvider } from '../lib/llm/ollama.mjs';

// ─── Factory Tests ───

describe('createLLMProvider factory', () => {
  it('should return null when no provider specified', () => {
    assert.equal(createLLMProvider(null), null);
    assert.equal(createLLMProvider(undefined), null);
    assert.equal(createLLMProvider({}), null);
    assert.equal(createLLMProvider({ provider: null }), null);
    assert.equal(createLLMProvider({ provider: '' }), null);
  });

  it('should create Anthropic provider', () => {
    const p = createLLMProvider({ provider: 'anthropic', apiKey: 'sk-test' });
    assert.ok(p instanceof AnthropicProvider);
    assert.equal(p.name, 'anthropic');
  });

  it('should create OpenAI provider', () => {
    const p = createLLMProvider({ provider: 'openai', apiKey: 'sk-test' });
    assert.ok(p instanceof OpenAIProvider);
    assert.equal(p.name, 'openai');
  });

  it('should create Gemini provider', () => {
    const p = createLLMProvider({ provider: 'gemini', apiKey: 'test-key' });
    assert.ok(p instanceof GeminiProvider);
    assert.equal(p.name, 'gemini');
  });

  it('should create Grok provider', () => {
    const p = createLLMProvider({ provider: 'grok', apiKey: 'sk-test' });
    assert.ok(p instanceof GrokProvider);
    assert.equal(p.name, 'grok');
  });

  it('should create OpenRouter provider', () => {
    const p = createLLMProvider({ provider: 'openrouter', apiKey: 'sk-test' });
    assert.ok(p instanceof OpenRouterProvider);
    assert.equal(p.name, 'openrouter');
  });

  it('should create MiniMax provider', () => {
    const p = createLLMProvider({ provider: 'minimax', apiKey: 'sk-test' });
    assert.ok(p instanceof MiniMaxProvider);
    assert.equal(p.name, 'minimax');
  });

  it('should create Mistral provider', () => {
    const p = createLLMProvider({ provider: 'mistral', apiKey: 'sk-test' });
    assert.ok(p instanceof MistralProvider);
    assert.equal(p.name, 'mistral');
  });

  it('should create Ollama provider', () => {
    const p = createLLMProvider({ provider: 'ollama' });
    assert.ok(p instanceof OllamaProvider);
    assert.equal(p.name, 'ollama');
  });

  it('should be case-insensitive', () => {
    const p = createLLMProvider({ provider: 'ANTHROPIC', apiKey: 'sk-test' });
    assert.ok(p instanceof AnthropicProvider);
  });

  it('should return null for unknown provider', () => {
    const p = createLLMProvider({ provider: 'nonexistent', apiKey: 'sk-test' });
    assert.equal(p, null);
  });

  it('should pass custom model through', () => {
    const p = createLLMProvider({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' });
    assert.equal(p.model, 'gpt-4o');
  });
});
