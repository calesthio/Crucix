// MiniMax provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MiniMaxProvider } from '../lib/llm/minimax.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('MiniMaxProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test' });
    assert.equal(provider.name, 'minimax');
    assert.equal(provider.model, 'MiniMax-M2.5');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test', model: 'MiniMax-M2.5-highspeed' });
    assert.equal(provider.model, 'MiniMax-M2.5-highspeed');
  });

  it('should report not configured without API key', () => {
    const provider = new MiniMaxProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw on API error', async () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') })
    );
    try {
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /MiniMax API 401/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should parse successful response', async () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test' });
    const mockResponse = {
      choices: [{ message: { content: 'Hello from MiniMax' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'MiniMax-M2.5',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
    );
    try {
      const result = await provider.complete('You are helpful.', 'Say hello');
      assert.equal(result.text, 'Hello from MiniMax');
      assert.equal(result.usage.inputTokens, 10);
      assert.equal(result.usage.outputTokens, 5);
      assert.equal(result.model, 'MiniMax-M2.5');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request format', async () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test-key', model: 'MiniMax-M2.5' });
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
          model: 'MiniMax-M2.5',
        }),
      });
    });
    try {
      await provider.complete('system prompt', 'user message', { maxTokens: 2048 });
      assert.equal(capturedUrl, 'https://api.minimax.io/v1/chat/completions');
      assert.equal(capturedOpts.method, 'POST');
      const headers = capturedOpts.headers;
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers['Authorization'], 'Bearer sk-test-key');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.model, 'MiniMax-M2.5');
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
    const provider = new MiniMaxProvider({ apiKey: 'sk-test' });
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

describe('createLLMProvider — minimax', () => {
  it('should create MiniMaxProvider for provider=minimax', () => {
    const provider = createLLMProvider({ provider: 'minimax', apiKey: 'sk-test', model: null });
    assert.ok(provider instanceof MiniMaxProvider);
    assert.equal(provider.name, 'minimax');
    assert.equal(provider.isConfigured, true);
  });

  it('should be case-insensitive', () => {
    const provider = createLLMProvider({ provider: 'MiniMax', apiKey: 'sk-test', model: null });
    assert.ok(provider instanceof MiniMaxProvider);
  });

  it('should return null for empty provider', () => {
    const provider = createLLMProvider({ provider: null, apiKey: 'sk-test', model: null });
    assert.equal(provider, null);
  });
});
