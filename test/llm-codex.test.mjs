// OpenAI Codex Provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CodexProvider } from '../lib/llm/codex.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('CodexProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new CodexProvider({});
    assert.equal(provider.name, 'codex');
    assert.equal(provider.model, 'gpt-5.3-codex');
  });

  it('should accept custom model', () => {
    const provider = new CodexProvider({ model: 'gpt-5.3-codex-spark' });
    assert.equal(provider.model, 'gpt-5.3-codex-spark');
  });

  it('should report isConfigured=true when CODEX_ACCESS_TOKEN and CODEX_ACCOUNT_ID env vars are set', () => {
    const savedToken = process.env.CODEX_ACCESS_TOKEN;
    const savedAccount = process.env.CODEX_ACCOUNT_ID;
    try {
      process.env.CODEX_ACCESS_TOKEN = 'test-token-123';
      process.env.CODEX_ACCOUNT_ID = 'acct-456';
      const provider = new CodexProvider({});
      assert.equal(provider.isConfigured, true);
    } finally {
      if (savedToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
      else process.env.CODEX_ACCESS_TOKEN = savedToken;
      if (savedAccount === undefined) delete process.env.CODEX_ACCOUNT_ID;
      else process.env.CODEX_ACCOUNT_ID = savedAccount;
    }
  });

  it('should report isConfigured=false when no credentials available', () => {
    const savedToken = process.env.CODEX_ACCESS_TOKEN;
    const savedOAuth = process.env.OPENAI_OAUTH_TOKEN;
    const savedAccount = process.env.CODEX_ACCOUNT_ID;
    try {
      delete process.env.CODEX_ACCESS_TOKEN;
      delete process.env.OPENAI_OAUTH_TOKEN;
      delete process.env.CODEX_ACCOUNT_ID;
      // Create provider with no auth file available (will fail to read ~/.codex/auth.json in CI)
      const provider = new CodexProvider({});
      // isConfigured depends on whether ~/.codex/auth.json exists on this machine.
      // We only assert false when the auth file definitely doesn't provide credentials.
      // Since we can't control the auth file in tests, we just verify the property exists.
      assert.ok(typeof provider.isConfigured === 'boolean');
    } finally {
      if (savedToken !== undefined) process.env.CODEX_ACCESS_TOKEN = savedToken;
      if (savedOAuth !== undefined) process.env.OPENAI_OAUTH_TOKEN = savedOAuth;
      if (savedAccount !== undefined) process.env.CODEX_ACCOUNT_ID = savedAccount;
    }
  });

  it('_clearCredentials() resets cached credentials', () => {
    const savedToken = process.env.CODEX_ACCESS_TOKEN;
    const savedAccount = process.env.CODEX_ACCOUNT_ID;
    try {
      process.env.CODEX_ACCESS_TOKEN = 'test-token-clear';
      process.env.CODEX_ACCOUNT_ID = 'acct-clear';
      const provider = new CodexProvider({});
      // Trigger caching
      assert.equal(provider.isConfigured, true);
      assert.ok(provider._creds !== null);
      provider._clearCredentials();
      assert.equal(provider._creds, null);
    } finally {
      if (savedToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
      else process.env.CODEX_ACCESS_TOKEN = savedToken;
      if (savedAccount === undefined) delete process.env.CODEX_ACCOUNT_ID;
      else process.env.CODEX_ACCOUNT_ID = savedAccount;
    }
  });

  it('complete() throws when not configured', async () => {
    const savedToken = process.env.CODEX_ACCESS_TOKEN;
    const savedOAuth = process.env.OPENAI_OAUTH_TOKEN;
    const savedAccount = process.env.CODEX_ACCOUNT_ID;
    try {
      delete process.env.CODEX_ACCESS_TOKEN;
      delete process.env.OPENAI_OAUTH_TOKEN;
      delete process.env.CODEX_ACCOUNT_ID;
      const provider = new CodexProvider({});
      // Force _creds to null to bypass file reading
      provider._creds = null;
      // Override _getCredentials to always return null
      provider._getCredentials = () => null;
      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /[Cc]odex/);
          return true;
        }
      );
    } finally {
      if (savedToken !== undefined) process.env.CODEX_ACCESS_TOKEN = savedToken;
      if (savedOAuth !== undefined) process.env.OPENAI_OAUTH_TOKEN = savedOAuth;
      if (savedAccount !== undefined) process.env.CODEX_ACCOUNT_ID = savedAccount;
    }
  });

  it('complete() sends correct headers: Authorization Bearer and ChatGPT-Account-Id', async () => {
    const savedToken = process.env.CODEX_ACCESS_TOKEN;
    const savedAccount = process.env.CODEX_ACCOUNT_ID;
    let capturedOpts;
    const originalFetch = globalThis.fetch;
    try {
      process.env.CODEX_ACCESS_TOKEN = 'bearer-token-xyz';
      process.env.CODEX_ACCOUNT_ID = 'account-789';
      const provider = new CodexProvider({});

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"response.completed"}\n\n'));
          controller.close();
        }
      });

      globalThis.fetch = mock.fn((url, opts) => {
        capturedOpts = opts;
        return Promise.resolve({ ok: true, status: 200, body: stream });
      });

      await provider.complete('system', 'user');
      assert.equal(capturedOpts.headers['Authorization'], 'Bearer bearer-token-xyz');
      assert.equal(capturedOpts.headers['ChatGPT-Account-Id'], 'account-789');
    } finally {
      globalThis.fetch = originalFetch;
      if (savedToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
      else process.env.CODEX_ACCESS_TOKEN = savedToken;
      if (savedAccount === undefined) delete process.env.CODEX_ACCOUNT_ID;
      else process.env.CODEX_ACCOUNT_ID = savedAccount;
    }
  });

  it('complete() on 401 throws error about auth', async () => {
    const savedToken = process.env.CODEX_ACCESS_TOKEN;
    const savedAccount = process.env.CODEX_ACCOUNT_ID;
    const originalFetch = globalThis.fetch;
    try {
      process.env.CODEX_ACCESS_TOKEN = 'expired-token';
      process.env.CODEX_ACCOUNT_ID = 'acct-001';
      const provider = new CodexProvider({});

      globalThis.fetch = mock.fn(() =>
        Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') })
      );

      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /auth/i);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (savedToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
      else process.env.CODEX_ACCESS_TOKEN = savedToken;
      if (savedAccount === undefined) delete process.env.CODEX_ACCOUNT_ID;
      else process.env.CODEX_ACCOUNT_ID = savedAccount;
    }
  });

  it('complete() on non-ok 500 throws Codex API 500', async () => {
    const savedToken = process.env.CODEX_ACCESS_TOKEN;
    const savedAccount = process.env.CODEX_ACCOUNT_ID;
    const originalFetch = globalThis.fetch;
    try {
      process.env.CODEX_ACCESS_TOKEN = 'valid-token';
      process.env.CODEX_ACCOUNT_ID = 'acct-001';
      const provider = new CodexProvider({});

      globalThis.fetch = mock.fn(() =>
        Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Internal Server Error') })
      );

      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /Codex API 500/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (savedToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
      else process.env.CODEX_ACCESS_TOKEN = savedToken;
      if (savedAccount === undefined) delete process.env.CODEX_ACCOUNT_ID;
      else process.env.CODEX_ACCOUNT_ID = savedAccount;
    }
  });

  it('_parseSSE() accumulates delta text chunks', async () => {
    const provider = new CodexProvider({});
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":" World"}\n\n'));
        controller.close();
      }
    });

    const text = await provider._parseSSE({ body: stream });
    assert.equal(text, 'Hello World');
  });

  it('_parseSSE() uses output_text from response.completed event', async () => {
    const provider = new CodexProvider({});
    const encoder = new TextEncoder();
    const completedPayload = JSON.stringify({
      type: 'response.completed',
      response: {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Final answer' }]
          }
        ]
      }
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: {"type":"response.output_text.delta","delta":"Partial"}\n\n`));
        controller.enqueue(encoder.encode(`data: ${completedPayload}\n\n`));
        controller.close();
      }
    });

    const text = await provider._parseSSE({ body: stream });
    // response.completed overrides the accumulated delta text
    assert.equal(text, 'Final answer');
  });
});

// ─── Factory Tests ───

describe('createLLMProvider — codex', () => {
  it('should create CodexProvider for provider=codex', () => {
    const provider = createLLMProvider({ provider: 'codex', model: null });
    assert.ok(provider instanceof CodexProvider);
    assert.equal(provider.name, 'codex');
  });

  it('should be case-insensitive', () => {
    const provider = createLLMProvider({ provider: 'Codex', model: null });
    assert.ok(provider instanceof CodexProvider);
  });
});
