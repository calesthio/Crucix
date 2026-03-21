// crucix.config — unit tests
// The config module is imported once and cached; tests verify default values
// (i.e. values that apply when the relevant env vars are not set).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import config from '../crucix.config.mjs';

describe('crucix config — top-level structure', () => {
  it('has all required top-level keys', () => {
    assert.ok('port' in config);
    assert.ok('refreshIntervalMinutes' in config);
    assert.ok('llm' in config);
    assert.ok('telegram' in config);
    assert.ok('discord' in config);
    assert.ok('delta' in config);
  });
});

describe('crucix config — defaults', () => {
  it('port defaults to 3117 when PORT env var is not set', () => {
    // Only verify the default when PORT was not overridden before import
    if (!process.env.PORT) {
      assert.equal(config.port, 3117);
    } else {
      assert.equal(typeof config.port, 'number');
    }
  });

  it('refreshIntervalMinutes defaults to 15', () => {
    if (!process.env.REFRESH_INTERVAL_MINUTES) {
      assert.equal(config.refreshIntervalMinutes, 15);
    } else {
      assert.equal(typeof config.refreshIntervalMinutes, 'number');
    }
  });

  it('llm.provider defaults to null', () => {
    if (!process.env.LLM_PROVIDER) {
      assert.equal(config.llm.provider, null);
    }
  });

  it('llm.baseUrl defaults to null', () => {
    if (!process.env.LLM_BASE_URL) {
      assert.equal(config.llm.baseUrl, null);
    }
  });

  it('telegram.botPollingInterval defaults to 5000', () => {
    if (!process.env.TELEGRAM_POLL_INTERVAL) {
      assert.equal(config.telegram.botPollingInterval, 5000);
    } else {
      assert.equal(typeof config.telegram.botPollingInterval, 'number');
    }
  });
});

describe('crucix config — discord object shape', () => {
  it('has botToken key', () => {
    assert.ok('botToken' in config.discord);
  });

  it('has channelId key', () => {
    assert.ok('channelId' in config.discord);
  });

  it('has guildId key', () => {
    assert.ok('guildId' in config.discord);
  });

  it('has webhookUrl key', () => {
    assert.ok('webhookUrl' in config.discord);
  });
});
