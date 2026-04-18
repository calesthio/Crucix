// Grok provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GrokProvider } from '../lib/llm/grok.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('GrokProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new GrokProvider({ apiKey: 'sk-test' });
    assert.equal(provider.name, 'grok');
    assert.equal(provider.model, 'grok-4-latest');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new GrokProvider({ apiKey: 'sk-test', model: 'grok-2' });
    assert.equal(provider.model, 'grok-2');
  });

  it('should report not configured without API key', () => {
    const provider = new GrokProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw on API error', async () => {
    const provider = new GrokProvider({ apiKey: 'sk-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') })
    );
    try {
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /Grok API 401/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should parse successful response', async () => {
    const provider = new GrokProvider({ apiKey: 'sk-test' });
    const mockResponse = {
      choices: [{ message: { content: 'Hello world' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'grok-3'
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
      assert.equal(result.model, 'grok-3');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request format', async () => {
    const provider = new GrokProvider({ apiKey: 'sk-test-key', model: 'grok-4-latest' });
    let capturedUrl, capturedOpts;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'grok-4-latest',
        }),
      });
    });
    try {
      await provider.complete('system prompt', 'user message', { maxTokens: 2048 });
      assert.equal(capturedUrl, 'https://api.x.ai/v1/chat/completions');
      assert.equal(capturedOpts.method, 'POST');
      const headers = capturedOpts.headers;
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers.Authorization, 'Bearer sk-test-key');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.model, 'grok-4-latest');
      assert.equal(body.max_tokens, 2048);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[0].content, 'system prompt');
      assert.equal(body.messages[1].role, 'user');
      assert.equal(body.messages[1].content, 'user message');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should handle empty response gracefully', async () => {
    const provider = new GrokProvider({ apiKey: 'sk-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ choices: [], usage: {} }),
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
  it('should create Grok provider', () => {
    const provider = createLLMProvider({ provider: 'grok', apiKey: 'sk-test' });
    assert.ok(provider instanceof GrokProvider);
    assert.equal(provider.isConfigured, true);
  });
});
