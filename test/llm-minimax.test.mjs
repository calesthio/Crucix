// MiniMax provider — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MiniMaxProvider } from '../lib/llm/minimax.mjs';
import { createLLMProvider } from '../lib/llm/index.mjs';

// ─── Unit Tests ───

describe('MiniMaxProvider', () => {
  it('should set defaults correctly', () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test' });
    assert.equal(provider.name, 'minimax');
    assert.equal(provider.model, 'MiniMax-M3.1-Flash');
    assert.deepEqual(provider.modelIds, ['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    assert.equal(provider.isConfigured, true);
  });

  it('should accept custom model', () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test', model: 'MiniMax-M2.7' });
    assert.equal(provider.model, 'MiniMax-M2.7');
    // Explicit model does not change the ordinary model set.
    assert.deepEqual(provider.modelIds, ['MiniMax-M3.1-Flash', 'MiniMax-M3']);
  });

  it('should expose both current model ids', () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test' });
    assert.ok(provider.modelIds.includes('MiniMax-M3.1-Flash'));
    assert.ok(provider.modelIds.includes('MiniMax-M3'));
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

  it('should parse successful response without mixing reasoning into text', async () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test' });
    const mockResponse = {
      choices: [{ message: { content: 'Hello from MiniMax', reasoning_content: 'Thinking separately', tool_calls: [{ id: 'call-1' }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'MiniMax-M3.1-Flash',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
    );
    try {
      const result = await provider.complete('You are helpful.', 'Say hello');
      assert.equal(result.text, 'Hello from MiniMax');
      assert.equal(result.reasoningContent, 'Thinking separately');
      assert.deepEqual(result.toolCalls, [{ id: 'call-1' }]);
      assert.equal(result.usage.inputTokens, 10);
      assert.equal(result.usage.outputTokens, 5);
      assert.equal(result.model, 'MiniMax-M3.1-Flash');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should send correct request format', async () => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test-key', model: 'MiniMax-M3' });
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
          model: 'MiniMax-M3',
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
      assert.equal(body.model, 'MiniMax-M3');
      assert.equal(body.max_tokens, 2048);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[0].content, 'system prompt');
      assert.equal(body.messages[1].role, 'user');
      assert.equal(body.messages[1].content, 'user message');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should serialize tools, thinking effort, history, and images at the HTTP boundary', async (t) => {
    const provider = new MiniMaxProvider({ apiKey: 'sk-test', model: 'MiniMax-M3.1-Flash' });
    const history = [
      { role: 'assistant', content: 'Earlier answer', reasoning_content: 'Earlier thinking' },
      { role: 'tool', tool_call_id: 'call-1', content: 'Tool result' },
    ];
    const tools = [{
      type: 'function',
      function: { name: 'lookup', parameters: { type: 'object' } },
    }];
    const transport = t.mock.method(globalThis, 'fetch', async (url, opts) => {
      assert.equal(url, 'https://api.minimax.io/v1/chat/completions');
      const body = JSON.parse(opts.body);
      assert.equal(body.model, 'MiniMax-M3.1-Flash');
      assert.equal(body.reasoning_effort, 'high');
      assert.deepEqual(body.tools, tools);
      assert.equal(body.tool_choice, 'auto');
      assert.deepEqual(body.messages.slice(1, 3), history);
      assert.deepEqual(body.messages[3].content, [
        { type: 'text', text: 'inspect this' },
        { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } },
      ]);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    });
    const result = await provider.complete('system prompt', 'inspect this', {
      history,
      images: ['https://example.test/image.png', { base64: 'YWJj', mimeType: 'image/png' }],
      tools,
      toolChoice: 'auto',
      reasoningEffort: 'high',
    });
    assert.equal(result.text, 'ok');
    assert.equal(transport.mock.callCount(), 1);
  });

  for (const model of [null, 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5-highspeed', 'custom-model']) {
    it(`should preserve factory model selection and image content at HTTP boundary: ${model || 'default'}`, async (t) => {
      const provider = createLLMProvider({ provider: 'minimax', apiKey: 'sk-test', model });
      const content = [
        { type: 'text', text: 'Describe this image' },
        { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } },
      ];
      const expectedModel = model || 'MiniMax-M3.1-Flash';
      const transport = t.mock.method(globalThis, 'fetch', async (url, opts) => {
        assert.equal(url, 'https://api.minimax.io/v1/chat/completions');
        // No thinking disable/none, service tier, tools, or history is injected
        // into this stateless completion adapter's request.
        assert.deepEqual(JSON.parse(opts.body), {
          model: expectedModel,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content },
          ],
        });
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
      });
      const result = await provider.complete('system prompt', content);
      assert.equal(result.model, expectedModel);
      assert.equal(transport.mock.callCount(), 1);
      assert.deepEqual(provider.modelIds, ['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    });
  }

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
