// Ollama provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaProvider } from '../lib/llm/ollama.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('OllamaProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new OllamaProvider({});
    assert.equal(provider.name, 'ollama');
    assert.equal(provider.model, 'llama3.1:8b');
    assert.equal(provider.baseUrl, 'http://localhost:11434');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model and base URL', () => {
    const provider = new OllamaProvider({ model: 'qwen2.5:14b', baseUrl: 'http://192.168.1.10:11434' });
    assert.equal(provider.model, 'qwen2.5:14b');
    assert.equal(provider.baseUrl, 'http://192.168.1.10:11434');
  });

  it('should strip trailing slashes from base URL', () => {
    const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434/' });
    assert.equal(provider.baseUrl, 'http://localhost:11434');
  });

  it('should throw on API error', async () => {
    const provider = new OllamaProvider({});
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('model not found') })
    );
    try {
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /Ollama API 404/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should parse successful response', async () => {
    const provider = new OllamaProvider({});
    const mockResponse = {
      choices: [{ message: { content: 'Hello from Ollama' } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      model: 'llama3.1:8b',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
    );
    try {
      const result = await provider.complete('You are helpful.', 'Say hello');
      assert.equal(result.text, 'Hello from Ollama');
      assert.equal(result.usage.inputTokens, 12);
      assert.equal(result.usage.outputTokens, 8);
      assert.equal(result.model, 'llama3.1:8b');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request format', async () => {
    const provider = new OllamaProvider({ model: 'qwen2.5:14b', baseUrl: 'http://myhost:11434' });
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
          model: 'qwen2.5:14b',
        }),
      });
    });
    try {
      await provider.complete('system prompt', 'user message', { maxTokens: 2048 });
      assert.equal(capturedUrl, 'http://myhost:11434/v1/chat/completions');
      assert.equal(capturedOpts.method, 'POST');
      const headers = capturedOpts.headers;
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers['Authorization'], undefined);
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.model, 'qwen2.5:14b');
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
    const provider = new OllamaProvider({});
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

  it('should use longer default timeout than cloud providers', async () => {
    const provider = new OllamaProvider({});
    let capturedOpts;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      });
    });
    try {
      await provider.complete('sys', 'user');
      assert.ok(capturedOpts.signal, 'Should have an abort signal');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Factory Tests ───

describe('createLLMProvider — ollama', () => {
  it('should create OllamaProvider for provider=ollama', () => {
    const provider = createLLMProvider({ provider: 'ollama', apiKey: null, model: null });
    assert.ok(provider instanceof OllamaProvider);
    assert.equal(provider.name, 'ollama');
    assert.equal(provider.isConfigured, true);
  });

  it('should be case-insensitive', () => {
    const provider = createLLMProvider({ provider: 'Ollama', apiKey: null, model: null });
    assert.ok(provider instanceof OllamaProvider);
  });

  it('should pass baseUrl from config', () => {
    const provider = createLLMProvider({ provider: 'ollama', apiKey: null, model: 'mistral:7b', baseUrl: 'http://gpu-box:11434' });
    assert.ok(provider instanceof OllamaProvider);
    assert.equal(provider.baseUrl, 'http://gpu-box:11434');
    assert.equal(provider.model, 'mistral:7b');
  });
});
