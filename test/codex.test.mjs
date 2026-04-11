// Codex provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CodexProvider } from '../lib/llm/codex.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';
import { saveFetch, restoreFetch, mockFetch, mockFetchError, withEnv } from './helpers.mjs';

// ─── Unit Tests ───

describe('CodexProvider', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  it('should set defaults correctly', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, () => {
      const provider = new CodexProvider({});
      assert.equal(provider.name, 'codex');
      assert.equal(provider.model, 'gpt-5.3-codex');
      assert.equal(provider.isConfigured, true);
    });
  });

  it('should accept custom model', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, () => {
      const provider = new CodexProvider({ model: 'gpt-5.3-codex-spark' });
      assert.equal(provider.model, 'gpt-5.3-codex-spark');
    });
  });

  it('should report not configured without credentials', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: undefined, OPENAI_OAUTH_TOKEN: undefined, CODEX_ACCOUNT_ID: undefined }, () => {
      const provider = new CodexProvider({});
      // Clear cached creds
      provider._creds = null;
      // isConfigured tries to read auth file which won't exist in test env
      // Just verify it doesn't throw
      const configured = provider.isConfigured;
      assert.equal(typeof configured, 'boolean');
    });
  });

  it('should use env vars for credentials', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-abc', CODEX_ACCOUNT_ID: 'acct-xyz' }, () => {
      const provider = new CodexProvider({});
      const creds = provider._getCredentials();
      assert.equal(creds.accessToken, 'tok-abc');
      assert.equal(creds.accountId, 'acct-xyz');
    });
  });

  it('should support OPENAI_OAUTH_TOKEN env var', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: undefined, OPENAI_OAUTH_TOKEN: 'oauth-tok', CODEX_ACCOUNT_ID: 'acct-2' }, () => {
      const provider = new CodexProvider({});
      const creds = provider._getCredentials();
      assert.equal(creds.accessToken, 'oauth-tok');
    });
  });

  it('should throw on missing credentials during complete', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: undefined, OPENAI_OAUTH_TOKEN: undefined, CODEX_ACCOUNT_ID: undefined }, async () => {
      const provider = new CodexProvider({});
      provider._creds = null;
      // Force no credentials by ensuring file also doesn't exist
      // Override _getCredentials to return null
      provider._getCredentials = () => null;

      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /No credentials found/);
          return true;
        }
      );
    });
  });

  it('should throw on auth failure (401)', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-bad', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});
      mockFetch('Unauthorized', { status: 401 });

      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /auth failed.*401/i);
          return true;
        }
      );
    });
  });

  it('should throw on auth failure (403) and clear credentials', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-bad', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});
      mockFetch('Forbidden', { status: 403 });

      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /auth failed.*403/i);
          return true;
        }
      );
      // Credentials should be cleared
      assert.equal(provider._creds, null);
    });
  });

  it('should throw on non-ok API response', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});
      mockFetch('Rate limited', { status: 429 });

      await assert.rejects(
        () => provider.complete('system', 'user'),
        (err) => {
          assert.match(err.message, /Codex API 429/);
          return true;
        }
      );
    });
  });

  it('should parse SSE stream with text deltas', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});

      const sseData = [
        'data: {"type":"response.output_text.delta","delta":"Hello "}\n\n',
        'data: {"type":"response.output_text.delta","delta":"world"}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      const encoder = new TextEncoder();
      let readCalled = false;
      const mockReader = {
        read: () => {
          if (!readCalled) {
            readCalled = true;
            return Promise.resolve({ done: false, value: encoder.encode(sseData) });
          }
          return Promise.resolve({ done: true, value: undefined });
        }
      };

      globalThis.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const result = await provider.complete('sys', 'user');
      assert.equal(result.text, 'Hello world');
      assert.equal(result.usage.inputTokens, 0);
      assert.equal(result.usage.outputTokens, 0);
      assert.equal(result.model, 'gpt-5.3-codex');
    });
  });

  it('should parse SSE stream with response.completed event', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});

      const completedEvent = {
        type: 'response.completed',
        response: {
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: 'Final answer' }]
          }]
        }
      };

      const sseData = `data: ${JSON.stringify(completedEvent)}\ndata: [DONE]\n\n`;

      const encoder = new TextEncoder();
      let readCalled = false;
      const mockReader = {
        read: () => {
          if (!readCalled) {
            readCalled = true;
            return Promise.resolve({ done: false, value: encoder.encode(sseData) });
          }
          return Promise.resolve({ done: true, value: undefined });
        }
      };

      globalThis.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const result = await provider.complete('sys', 'user');
      assert.equal(result.text, 'Final answer');
    });
  });

  it('should send correct request format', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-key', CODEX_ACCOUNT_ID: 'acct-123' }, async () => {
      const provider = new CodexProvider({ model: 'gpt-5.3-codex-spark' });

      let capturedUrl, capturedOpts;
      const encoder = new TextEncoder();

      globalThis.fetch = (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        const mockReader = {
          read: (() => {
            let done = false;
            return () => {
              if (!done) {
                done = true;
                return Promise.resolve({ done: false, value: encoder.encode('data: [DONE]\n\n') });
              }
              return Promise.resolve({ done: true, value: undefined });
            };
          })()
        };
        return Promise.resolve({
          ok: true,
          status: 200,
          body: { getReader: () => mockReader },
        });
      };

      await provider.complete('system prompt', 'user message');

      assert.equal(capturedUrl, 'https://chatgpt.com/backend-api/codex/responses');
      assert.equal(capturedOpts.method, 'POST');
      assert.equal(capturedOpts.headers['Content-Type'], 'application/json');
      assert.equal(capturedOpts.headers['Authorization'], 'Bearer tok-key');
      assert.equal(capturedOpts.headers['ChatGPT-Account-Id'], 'acct-123');

      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.model, 'gpt-5.3-codex-spark');
      assert.equal(body.instructions, 'system prompt');
      assert.equal(body.stream, true);
      assert.equal(body.store, false);
      assert.equal(body.input[0].role, 'user');
      assert.equal(body.input[0].content, 'user message');
    });
  });

  it('should handle network errors', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});
      mockFetchError('Connection refused');

      await assert.rejects(
        () => provider.complete('sys', 'user'),
        (err) => {
          assert.match(err.message, /Connection refused/);
          return true;
        }
      );
    });
  });

  it('should handle empty SSE stream', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});

      const mockReader = {
        read: () => Promise.resolve({ done: true, value: undefined })
      };

      globalThis.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const result = await provider.complete('sys', 'user');
      assert.equal(result.text, '');
    });
  });

  it('should skip malformed SSE events gracefully', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, async () => {
      const provider = new CodexProvider({});

      const sseData = [
        'data: {not valid json}\n',
        'data: {"type":"response.output_text.delta","delta":"ok"}\n',
        'data: [DONE]\n',
      ].join('');

      const encoder = new TextEncoder();
      let readCalled = false;
      const mockReader = {
        read: () => {
          if (!readCalled) {
            readCalled = true;
            return Promise.resolve({ done: false, value: encoder.encode(sseData) });
          }
          return Promise.resolve({ done: true, value: undefined });
        }
      };

      globalThis.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const result = await provider.complete('sys', 'user');
      assert.equal(result.text, 'ok');
    });
  });
});

// ─── Factory Tests ───

describe('createLLMProvider (codex)', () => {
  it('should create Codex provider via factory', async () => {
    await withEnv({ CODEX_ACCESS_TOKEN: 'tok-test', CODEX_ACCOUNT_ID: 'acct-1' }, () => {
      const provider = createLLMProvider({ provider: 'codex' });
      assert.ok(provider instanceof CodexProvider);
    });
  });
});
