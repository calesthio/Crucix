// Base LLM Provider — unit tests
// Uses Node.js built-in test runner (node:test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LLMProvider } from '../lib/llm/provider.mjs';

describe('LLMProvider', () => {
  it('should store config and set name to base', () => {
    const config = { apiKey: 'test', model: 'gpt-4' };
    const provider = new LLMProvider(config);
    assert.equal(provider.name, 'base');
    assert.deepEqual(provider.config, config);
  });

  it('should report isConfigured as false', () => {
    const provider = new LLMProvider({});
    assert.equal(provider.isConfigured, false);
  });

  it('should throw on complete() with descriptive message', async () => {
    const provider = new LLMProvider({});
    await assert.rejects(
      () => provider.complete('system', 'user'),
      (err) => {
        assert.match(err.message, /base: complete\(\) not implemented/);
        return true;
      }
    );
  });

  it('should include provider name in error when subclassed', async () => {
    class TestProvider extends LLMProvider {
      constructor() {
        super({});
        this.name = 'test-provider';
      }
    }
    const provider = new TestProvider();
    await assert.rejects(
      () => provider.complete('sys', 'user'),
      (err) => {
        assert.match(err.message, /test-provider/);
        return true;
      }
    );
  });

  it('should accept opts parameter in complete()', async () => {
    const provider = new LLMProvider({});
    await assert.rejects(
      () => provider.complete('system', 'user', { maxTokens: 100 }),
      /not implemented/
    );
  });

  it('should allow subclass to override isConfigured', () => {
    class ConfiguredProvider extends LLMProvider {
      get isConfigured() { return !!this.config.apiKey; }
    }
    const withKey = new ConfiguredProvider({ apiKey: 'sk-test' });
    assert.equal(withKey.isConfigured, true);

    const withoutKey = new ConfiguredProvider({});
    assert.equal(withoutKey.isConfigured, false);
  });

  it('should allow subclass to override complete()', async () => {
    class WorkingProvider extends LLMProvider {
      async complete(sys, user) {
        return { text: 'hello', usage: { inputTokens: 1, outputTokens: 1 }, model: 'test' };
      }
    }
    const provider = new WorkingProvider({});
    const result = await provider.complete('sys', 'msg');
    assert.equal(result.text, 'hello');
    assert.equal(result.model, 'test');
  });
});
