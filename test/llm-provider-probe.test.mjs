import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMProvider } from '../lib/llm/provider.mjs';
import { OllamaProvider } from '../lib/llm/ollama.mjs';

test('base provider probe classifies auth failures from synthetic completion', async () => {
  class FakeProvider extends LLMProvider {
    constructor() {
      super({});
      this.name = 'fake';
      this.model = 'fake-model';
    }
    get isConfigured() { return true; }
    async complete() {
      throw new Error('OpenAI API 401: unauthorized');
    }
  }

  const provider = new FakeProvider();
  await assert.rejects(
    provider.probe({ timeout: 10 }),
    error => error?.probe?.classification === 'auth' && error?.probe?.status === 401,
  );
});

test('ollama probe uses cheap tags endpoint and classifies missing model', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { models: [{ name: 'llama3.1:8b' }] };
    },
  });

  try {
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'missing-model' });
    await assert.rejects(
      provider.probe({ timeout: 10 }),
      error => error?.probe?.classification === 'missing-model' && error?.probe?.probeType === 'ollama-tags',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama probe succeeds from tags endpoint without synthetic completion', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { models: [{ name: 'qwen:latest' }] };
    },
  });

  try {
    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen' });
    const result = await provider.probe({ timeout: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.probeType, 'ollama-tags');
    assert.equal(result.classification, 'ready');
    assert.match(result.text, /Model present/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
