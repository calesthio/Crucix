// crucix.config.mjs — unit tests
// Uses Node.js built-in test runner (node:test)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withEnv } from './helpers.mjs';

// Config is a static default export evaluated at import time.
// We import it once and test the shape/defaults.
import config from '../crucix.config.mjs';

describe('crucix.config', () => {

  describe('shape and defaults', () => {
    it('should export an object with top-level keys', () => {
      assert.equal(typeof config, 'object');
      assert.ok('port' in config);
      assert.ok('refreshIntervalMinutes' in config);
      assert.ok('llm' in config);
      assert.ok('telegram' in config);
      assert.ok('discord' in config);
      assert.ok('delta' in config);
    });

    it('should have numeric port defaulting to 3117', () => {
      assert.equal(typeof config.port, 'number');
      // Unless PORT env is set, default is 3117
      if (!process.env.PORT) {
        assert.equal(config.port, 3117);
      }
    });

    it('should have numeric refreshIntervalMinutes defaulting to 15', () => {
      assert.equal(typeof config.refreshIntervalMinutes, 'number');
      if (!process.env.REFRESH_INTERVAL_MINUTES) {
        assert.equal(config.refreshIntervalMinutes, 15);
      }
    });
  });

  describe('llm config', () => {
    it('should have provider, apiKey, model, baseUrl keys', () => {
      const { llm } = config;
      assert.ok('provider' in llm);
      assert.ok('apiKey' in llm);
      assert.ok('model' in llm);
      assert.ok('baseUrl' in llm);
    });

    it('should default llm values to null when env vars not set', () => {
      // These default to null unless env vars are set
      const { llm } = config;
      if (!process.env.LLM_PROVIDER) assert.equal(llm.provider, null);
      if (!process.env.LLM_API_KEY) assert.equal(llm.apiKey, null);
      if (!process.env.LLM_MODEL) assert.equal(llm.model, null);
      if (!process.env.OLLAMA_BASE_URL) assert.equal(llm.baseUrl, null);
    });
  });

  describe('telegram config', () => {
    it('should have botToken, chatId, botPollingInterval, channels keys', () => {
      const { telegram } = config;
      assert.ok('botToken' in telegram);
      assert.ok('chatId' in telegram);
      assert.ok('botPollingInterval' in telegram);
      assert.ok('channels' in telegram);
    });

    it('should default botPollingInterval to 5000', () => {
      if (!process.env.TELEGRAM_POLL_INTERVAL) {
        assert.equal(config.telegram.botPollingInterval, 5000);
      }
    });
  });

  describe('discord config', () => {
    it('should have botToken, channelId, guildId, webhookUrl keys', () => {
      const { discord } = config;
      assert.ok('botToken' in discord);
      assert.ok('channelId' in discord);
      assert.ok('guildId' in discord);
      assert.ok('webhookUrl' in discord);
    });
  });

  describe('delta config', () => {
    it('should have thresholds with numeric and count sub-objects', () => {
      const { delta } = config;
      assert.ok('thresholds' in delta);
      assert.ok('numeric' in delta.thresholds);
      assert.ok('count' in delta.thresholds);
      assert.equal(typeof delta.thresholds.numeric, 'object');
      assert.equal(typeof delta.thresholds.count, 'object');
    });
  });
});
