// OpenAI provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../lib/llm/openai.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('OpenAIProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    assert.equal(provider.name, 'openai');
    assert.equal(provider.model, 'gpt-5.4');
    assert.equal(provider.isConfigured, true);
    assert.equal(provider.baseUrl, null);
  });

  it('should accept custom model', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4o' });
    assert.equal(provider.model, 'gpt-4o');
  });

  it('should report not configured without apiKey or baseUrl', () => {
    const provider = new OpenAIProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should report configured with only apiKey', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    assert.equal(provider.isConfigured, true);
  });

  it('should report configured with only baseUrl (local LLM, no key needed)', () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:1234/v1/chat/completions' });
    assert.equal(provider.isConfigured, true);
  });

  it('should use default OpenAI URL when no baseUrl set', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    let capturedUrl;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'gpt-5.4',
        }),
      });
    });
    try {
      await provider.complete('sys', 'user');
      assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should use custom baseUrl when set', async () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:1234/v1/chat/completions', model: 'local-model' });
    let capturedUrl;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'local-model',
        }),
      });
    });
    try {
      await provider.complete('sys', 'user');
      assert.equal(capturedUrl, 'http://localhost:1234/v1/chat/completions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should include Authorization header when apiKey is set', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' });
    let capturedHeaders;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedHeaders = opts.headers;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'gpt-5.4',
        }),
      });
    });
    try {
      await provider.complete('sys', 'user');
      assert.equal(capturedHeaders['Authorization'], 'Bearer sk-test-key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should omit Authorization header when no apiKey (local LLM)', async () => {
    const provider = new OpenAIProvider({ baseUrl: 'http://localhost:1234/v1/chat/completions' });
    let capturedHeaders;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedHeaders = opts.headers;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'local-model',
        }),
      });
    });
    try {
      await provider.complete('sys', 'user');
      assert.equal(capturedHeaders['Authorization'], undefined);
      assert.equal(capturedHeaders['Content-Type'], 'application/json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should throw on API error', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') })
    );
    try {
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /OpenAI API 401/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should handle empty response gracefully', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
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

describe('createLLMProvider — openai', () => {
  it('should create OpenAIProvider for provider=openai', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: 'sk-test', model: null, baseUrl: null });
    assert.ok(provider instanceof OpenAIProvider);
    assert.equal(provider.name, 'openai');
    assert.equal(provider.isConfigured, true);
  });

  it('should be case-insensitive', () => {
    const provider = createLLMProvider({ provider: 'OpenAI', apiKey: 'sk-test', model: null, baseUrl: null });
    assert.ok(provider instanceof OpenAIProvider);
  });

  it('should pass baseUrl to OpenAIProvider', () => {
    const url = 'http://localhost:1234/v1/chat/completions';
    const provider = createLLMProvider({ provider: 'openai', apiKey: null, model: null, baseUrl: url });
    assert.ok(provider instanceof OpenAIProvider);
    assert.equal(provider.baseUrl, url);
    assert.equal(provider.isConfigured, true);
  });

  it('should accept openai-compatible as an alias', () => {
    const url = 'http://localhost:1234/v1/chat/completions';
    const provider = createLLMProvider({ provider: 'openai-compatible', apiKey: null, model: null, baseUrl: url });
    assert.ok(provider instanceof OpenAIProvider);
    assert.equal(provider.baseUrl, url);
    assert.equal(provider.isConfigured, true);
  });

  it('should return null for empty provider', () => {
    const provider = createLLMProvider({ provider: null, apiKey: 'sk-test', model: null, baseUrl: null });
    assert.equal(provider, null);
  });
});
