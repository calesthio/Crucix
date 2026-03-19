// Anthropic Claude Provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../lib/llm/anthropic.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('AnthropicProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    assert.equal(provider.name, 'anthropic');
    assert.equal(provider.model, 'claude-sonnet-4-6');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-opus-4-5' });
    assert.equal(provider.model, 'claude-opus-4-5');
  });

  it('should report not configured without apiKey', () => {
    const provider = new AnthropicProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw Anthropic API 401 on error response', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
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

  it('should parse response: content[0].text and usage tokens', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    const mockResponse = {
      content: [{ text: 'Hello from Claude' }],
      usage: { input_tokens: 12, output_tokens: 7 },
      model: 'claude-sonnet-4-6',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
    );
    try {
      const result = await provider.complete('You are helpful.', 'Say hello');
      assert.equal(result.text, 'Hello from Claude');
      assert.equal(result.usage.inputTokens, 12);
      assert.equal(result.usage.outputTokens, 7);
      assert.equal(result.model, 'claude-sonnet-4-6');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request: URL, headers, and body', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-real-key', model: 'claude-sonnet-4-6' });
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
      // Uses x-api-key, NOT Authorization
      assert.equal(headers['x-api-key'], 'sk-ant-real-key');
      assert.ok(!headers['Authorization'], 'Should not have Authorization header');
      assert.equal(headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.system, 'system prompt');
      assert.ok(Array.isArray(body.messages), 'messages should be an array');
      assert.equal(body.messages[0].role, 'user');
      assert.equal(body.messages[0].content, 'user message');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should handle empty content array gracefully', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
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

describe('createLLMProvider — anthropic', () => {
  it('should create AnthropicProvider for provider=anthropic', () => {
    const provider = createLLMProvider({ provider: 'anthropic', apiKey: 'sk-ant-test', model: null });
    assert.ok(provider instanceof AnthropicProvider);
    assert.equal(provider.name, 'anthropic');
    assert.equal(provider.isConfigured, true);
  });

  it('should be case-insensitive', () => {
    const provider = createLLMProvider({ provider: 'Anthropic', apiKey: 'sk-ant-test', model: null });
    assert.ok(provider instanceof AnthropicProvider);
  });
});
