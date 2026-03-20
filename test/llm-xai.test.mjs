// xAI Grok provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { XAIProvider } from '../lib/llm/xai.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('XAIProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new XAIProvider({ apiKey: 'xai-test' });
    assert.equal(provider.name, 'xai');
    assert.equal(provider.model, 'grok-3');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new XAIProvider({ apiKey: 'xai-test', model: 'grok-3-mini' });
    assert.equal(provider.model, 'grok-3-mini');
  });

  it('should report not configured without API key', () => {
    const provider = new XAIProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw on API error', async () => {
    const provider = new XAIProvider({ apiKey: 'xai-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') })
    );
    try {
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /xAI API 401/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should parse successful response', async () => {
    const provider = new XAIProvider({ apiKey: 'xai-test' });
    const mockResponse = {
      choices: [{ message: { content: 'Hello from Grok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'grok-3',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
    );
    try {
      const result = await provider.complete('You are helpful.', 'Say hello');
      assert.equal(result.text, 'Hello from Grok');
      assert.equal(result.usage.inputTokens, 10);
      assert.equal(result.usage.outputTokens, 5);
      assert.equal(result.model, 'grok-3');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request format', async () => {
    const provider = new XAIProvider({ apiKey: 'xai-key-123', model: 'grok-3' });
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
          model: 'grok-3',
        }),
      });
    });
    try {
      await provider.complete('system prompt', 'user message', { maxTokens: 2048 });
      assert.equal(capturedUrl, 'https://api.x.ai/v1/chat/completions');
      assert.equal(capturedOpts.method, 'POST');
      const headers = capturedOpts.headers;
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers['Authorization'], 'Bearer xai-key-123');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.model, 'grok-3');
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
    const provider = new XAIProvider({ apiKey: 'xai-test' });
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

describe('createLLMProvider — xai', () => {
  it('should create XAIProvider for provider=xai', () => {
    const provider = createLLMProvider({ provider: 'xai', apiKey: 'xai-test', model: null });
    assert.ok(provider instanceof XAIProvider);
    assert.equal(provider.name, 'xai');
    assert.equal(provider.isConfigured, true);
  });

  it('should create XAIProvider for provider=grok alias', () => {
    const provider = createLLMProvider({ provider: 'grok', apiKey: 'xai-test', model: null });
    assert.ok(provider instanceof XAIProvider);
    assert.equal(provider.name, 'xai');
  });

  it('should be case-insensitive', () => {
    const provider = createLLMProvider({ provider: 'XAI', apiKey: 'xai-test', model: null });
    assert.ok(provider instanceof XAIProvider);
  });
});
