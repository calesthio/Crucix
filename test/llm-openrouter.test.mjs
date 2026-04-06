import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterProvider } from '../lib/llm/openrouter.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

test('OpenRouterProvider Unit Tests', async (t) => {
  await t.test('initializes correctly', () => {
    const provider = new OpenRouterProvider({ apiKey: 'test-key', model: 'openrouter/auto' });
    assert.equal(provider.name, 'openrouter');
    assert.equal(provider.apiKey, 'test-key');
    assert.equal(provider.model, 'openrouter/auto');
    assert.equal(provider.isConfigured, true);
  });

  await t.test('isConfigured is false without apiKey', () => {
    const provider = new OpenRouterProvider({ apiKey: null });
    assert.equal(provider.isConfigured, false);
  });

  await t.test('createLLMProvider factory returns OpenRouterProvider', () => {
    const provider = createLLMProvider({ provider: 'openrouter', apiKey: 'test-key', model: 'test-model' });
    assert.ok(provider instanceof OpenRouterProvider);
    assert.equal(provider.apiKey, 'test-key');
    assert.equal(provider.model, 'test-model');
  });

  await t.test('complete() returns expected result', async () => {
    const provider = new OpenRouterProvider({ apiKey: 'test-key', model: 'test-model' });
    
    // Mock the global fetch
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.headers['Authorization'], 'Bearer test-key');
      assert.equal(options.headers['X-Title'], 'Crucix');
      assert.equal(options.headers['HTTP-Referer'], 'https://github.com/calesthio/Crucix');

      const body = JSON.parse(options.body);
      assert.equal(body.model, 'test-model');
      assert.deepEqual(body.messages, [
        { role: 'system', content: 'You are a test.' },
        { role: 'user', content: 'Hello' }
      ]);

      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Test response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: 'test-model'
        })
      };
    };

    try {
      const result = await provider.complete('You are a test.', 'Hello');
      assert.equal(result.text, 'Test response');
      assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
      assert.equal(result.model, 'test-model');
    } finally {
      // Restore original fetch
      global.fetch = originalFetch;
    }
  });

  await t.test('complete() throws error on API failure', async () => {
    const provider = new OpenRouterProvider({ apiKey: 'test-key', model: 'test-model' });
    
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized access'
      };
    };

    try {
      await assert.rejects(
        provider.complete('system', 'user'),
        {
          name: 'Error',
          message: 'OpenRouter API 401: Unauthorized access'
        }
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
