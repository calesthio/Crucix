// Anthropic provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../lib/llm/anthropic.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('AnthropicProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    assert.equal(provider.name, 'anthropic');
    assert.equal(provider.model, 'claude-sonnet-4-6');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', model: 'claude-opus-4' });
    assert.equal(provider.model, 'claude-opus-4');
  });

  it('should report not configured without API key', () => {
    const provider = new AnthropicProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw on API error', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') })
    );
    try {
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /Anthropic API 401/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should parse successful response', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    const mockResponse = {
      content: [{ text: 'Hello world' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'claude-sonnet-4-6',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
    );
    try {
      const result = await provider.complete('system', 'user');
      assert.equal(result.text, 'Hello world');
      assert.equal(result.usage.inputTokens, 10);
      assert.equal(result.usage.outputTokens, 5);
      assert.equal(result.model, 'claude-sonnet-4-6');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request format', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test-key', model: 'claude-sonnet-4-6' });
    let capturedUrl, capturedOpts;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          content: [{ text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          model: 'claude-sonnet-4-6',
        }),
      });
    });
    try {
      await provider.complete('system prompt', 'user message', { maxTokens: 2048 });
      assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
      assert.equal(capturedOpts.method, 'POST');
      const headers = capturedOpts.headers;
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers['x-api-key'], 'sk-test-key');
      assert.equal(headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.model, 'claude-sonnet-4-6');
      assert.equal(body.max_tokens, 2048);
      assert.equal(body.system, 'system prompt');
      assert.equal(body.messages[0].role, 'user');
      assert.equal(body.messages[0].content, 'user message');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should handle empty response gracefully', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ content: [], usage: {} }),
      })
    );
    try {
      const result = await provider.complete('sys', 'user');
      assert.equal(result.text, '');
      assert.equal(result.usage.inputTokens, 0);
      assert.equal(result.usage.outputTokens, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Factory Tests ───

describe('createLLMProvider', () => {
  it('should create Anthropic provider', () => {
    const provider = createLLMProvider({ provider: 'anthropic', apiKey: 'sk-test' });
    assert.ok(provider instanceof AnthropicProvider);
    assert.equal(provider.isConfigured, true);
  });
});
