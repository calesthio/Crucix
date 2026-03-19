// Google Gemini Provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../lib/llm/gemini.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('GeminiProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-test' });
    assert.equal(provider.name, 'gemini');
    assert.equal(provider.model, 'gemini-3.1-pro');
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-test', model: 'gemini-2.0-flash' });
    assert.equal(provider.model, 'gemini-2.0-flash');
  });

  it('should report not configured without apiKey', () => {
    const provider = new GeminiProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw Gemini API {status} on error response', async () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-test' });
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

  it('should parse response: candidates[0].content.parts[0].text and usageMetadata tokens', async () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-test' });
    const mockResponse = {
      candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
    );
    try {
      const result = await provider.complete('You are helpful.', 'Say hello');
      assert.equal(result.text, 'Hello from Gemini');
      assert.equal(result.usage.inputTokens, 15);
      assert.equal(result.usage.outputTokens, 8);
      assert.equal(result.model, 'gemini-3.1-pro');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should build URL with model name and apiKey as query param (no Authorization header)', async () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-real-key', model: 'gemini-3.1-pro' });
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
      await provider.complete('system prompt', 'user message', { maxTokens: 1024 });
      assert.ok(capturedUrl.includes('gemini-3.1-pro'), 'URL should contain model name');
      assert.ok(capturedUrl.includes('key=AIza-real-key'), 'URL should contain apiKey as query param');
      const headers = capturedOpts.headers;
      assert.ok(!headers['Authorization'], 'Should not have Authorization header');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct body: systemInstruction, contents, generationConfig', async () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-real-key', model: 'gemini-3.1-pro' });
    let capturedOpts;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn((url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: {},
        }),
      });
    });
    try {
      await provider.complete('my system', 'my user message', { maxTokens: 512 });
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.systemInstruction.parts[0].text, 'my system');
      assert.equal(body.contents[0].parts[0].text, 'my user message');
      assert.equal(body.generationConfig.maxOutputTokens, 512);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should handle empty candidates array gracefully', async () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-test' });
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

describe('createLLMProvider — gemini', () => {
  it('should create GeminiProvider for provider=gemini', () => {
    const provider = createLLMProvider({ provider: 'gemini', apiKey: 'AIza-test', model: null });
    assert.ok(provider instanceof GeminiProvider);
    assert.equal(provider.name, 'gemini');
    assert.equal(provider.isConfigured, true);
  });

  it('should be case-insensitive', () => {
    const provider = createLLMProvider({ provider: 'Gemini', apiKey: 'AIza-test', model: null });
    assert.ok(provider instanceof GeminiProvider);
  });
});
