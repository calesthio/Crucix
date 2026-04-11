// Gemini provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../lib/llm/gemini.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('GeminiProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    assert.equal(provider.name, 'gemini');
    assert.equal(provider.model, 'gemini-3.1-pro');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.5-flash' });
    assert.equal(provider.model, 'gemini-2.5-flash');
  });

  it('should report not configured without API key', () => {
    const provider = new GeminiProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw on API error', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('Forbidden') })
    );
    try {
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /Gemini API 403/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should parse successful response', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const mockResponse = {
      candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
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
      assert.equal(result.model, 'gemini-3.1-pro');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request format', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-api-key', model: 'gemini-3.1-pro' });
    let capturedUrl, capturedOpts;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
      });
    });
    try {
      await provider.complete('system prompt', 'user message', { maxTokens: 2048 });
      assert.equal(capturedUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent?key=test-api-key');
      assert.equal(capturedOpts.method, 'POST');
      const headers = capturedOpts.headers;
      assert.equal(headers['Content-Type'], 'application/json');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.systemInstruction.parts[0].text, 'system prompt');
      assert.equal(body.contents[0].parts[0].text, 'user message');
      assert.equal(body.generationConfig.maxOutputTokens, 2048);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should handle empty response gracefully', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ candidates: [], usageMetadata: {} }),
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
  it('should create Gemini provider', () => {
    const provider = createLLMProvider({ provider: 'gemini', apiKey: 'test-key' });
    assert.ok(provider instanceof GeminiProvider);
    assert.equal(provider.isConfigured, true);
  });
});
