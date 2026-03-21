// DiscordAlerter — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordAlerter } from '../lib/alerts/discord.mjs';

// ─── isConfigured ─────────────────────────────────────────────────────────────

describe('DiscordAlerter.isConfigured', () => {
  it('returns true with botToken + channelId', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch1', guildId: null, webhookUrl: null });
    assert.equal(alerter.isConfigured, true);
  });

  it('returns true with webhookUrl only (no botToken)', () => {
    const alerter = new DiscordAlerter({ botToken: null, channelId: null, guildId: null, webhookUrl: 'https://discord.com/api/webhooks/123/abc' });
    assert.equal(alerter.isConfigured, true);
  });

  it('returns false with neither botToken/channelId nor webhookUrl', () => {
    const alerter = new DiscordAlerter({ botToken: null, channelId: null, guildId: null, webhookUrl: null });
    assert.equal(alerter.isConfigured, false);
  });

  it('returns false with botToken but no channelId and no webhookUrl', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: null, guildId: null, webhookUrl: null });
    assert.equal(alerter.isConfigured, false);
  });
});

// ─── _sendWebhook ─────────────────────────────────────────────────────────────

describe('DiscordAlerter._sendWebhook', () => {
  it('POSTs correct JSON payload to the webhookUrl', async () => {
    const alerter = new DiscordAlerter({ botToken: null, channelId: null, guildId: null, webhookUrl: 'https://discord.com/api/webhooks/999/xyz' });
    let capturedUrl, capturedOpts;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return { ok: true, text: async () => '' };
    };
    try {
      const result = await alerter._sendWebhook('https://discord.com/api/webhooks/999/xyz', 'hello world', []);
      assert.equal(capturedUrl, 'https://discord.com/api/webhooks/999/xyz');
      assert.equal(capturedOpts.method, 'POST');
      assert.equal(capturedOpts.headers['Content-Type'], 'application/json');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.content, 'hello world');
      assert.equal(result, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns false when fetch throws (network error)', async () => {
    const alerter = new DiscordAlerter({ botToken: null, channelId: null, guildId: null, webhookUrl: 'https://x' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await alerter._sendWebhook('https://x', 'msg', []);
      assert.equal(result, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns false when HTTP response is not ok', async () => {
    const alerter = new DiscordAlerter({ botToken: null, channelId: null, guildId: null, webhookUrl: 'https://x' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => 'Bad Request' });
    try {
      const result = await alerter._sendWebhook('https://x', 'msg', []);
      assert.equal(result, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── _ruleBasedEvaluation ─────────────────────────────────────────────────────

describe('DiscordAlerter._ruleBasedEvaluation', () => {
  const makeDelta = () => ({ summary: { direction: 'up', totalChanges: 5, criticalChanges: 1 } });

  it('nuclear anomaly signal → FLASH', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    const signals = [{ key: 'nuke_anomaly', severity: 'critical', description: 'test' }];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'FLASH');
  });

  it('2+ cross-domain critical signals → FLASH', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    const signals = [
      { key: 'vix',             severity: 'critical', direction: 'up', label: 'VIX' },
      { key: 'conflict_events', severity: 'critical', direction: 'up', label: 'Conflict Events' },
    ];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'FLASH');
  });

  it('2+ escalating high signals (direction=up) → PRIORITY', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    const signals = [
      { key: 'wti',      severity: 'high', direction: 'up', label: 'WTI' },
      { key: 'hy_spread', severity: 'high', direction: 'up', label: 'HY Spread' },
    ];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'PRIORITY');
  });

  it('5+ urgent OSINT posts → PRIORITY', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    const signals = Array.from({ length: 5 }, (_, i) => ({
      key: `tg_urgent_${i}`, severity: 'low', text: `osint post ${i}`,
    }));
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'PRIORITY');
  });

  it('single critical signal (no cross-domain) → ROUTINE', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    const signals = [{ key: 'vix', severity: 'critical', direction: 'down', label: 'VIX' }];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'ROUTINE');
  });

  it('signals below threshold → shouldAlert=false', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    const signals = [{ key: 'misc', severity: 'low', direction: 'up', label: 'Misc' }];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, false);
  });
});

// ─── _checkRateLimit ──────────────────────────────────────────────────────────

describe('DiscordAlerter._checkRateLimit', () => {
  it('allows first alert (empty history)', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    assert.equal(alerter._checkRateLimit('FLASH'), true);
  });

  it('blocks alert within cooldown period', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    alerter._alertHistory.push({ tier: 'FLASH', timestamp: Date.now() });
    assert.equal(alerter._checkRateLimit('FLASH'), false);
  });

  it('allows alert after cooldown has elapsed', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    // FLASH cooldown = 5 min; record an alert 10 minutes ago
    alerter._alertHistory.push({ tier: 'FLASH', timestamp: Date.now() - 10 * 60 * 1000 });
    assert.equal(alerter._checkRateLimit('FLASH'), true);
  });
});

// ─── _isMuted ─────────────────────────────────────────────────────────────────

describe('DiscordAlerter._isMuted', () => {
  it('returns false initially', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    assert.equal(alerter._isMuted(), false);
  });

  it('returns true when muted until future time', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    alerter._muteUntil = Date.now() + 60 * 60 * 1000;
    assert.equal(alerter._isMuted(), true);
  });

  it('returns false and clears mute when timestamp has expired', () => {
    const alerter = new DiscordAlerter({ botToken: 'tok', channelId: 'ch', guildId: null, webhookUrl: null });
    alerter._muteUntil = Date.now() - 1000;
    assert.equal(alerter._isMuted(), false);
    assert.equal(alerter._muteUntil, null);
  });
});

// ─── _embed ───────────────────────────────────────────────────────────────────

describe('DiscordAlerter._embed', () => {
  it('returns object with title field when no discord.js EmbedBuilder loaded', () => {
    // _EmbedBuilder is not set by default (discord.js not imported in test env)
    const alerter = new DiscordAlerter({ botToken: null, channelId: null, guildId: null, webhookUrl: 'https://x' });
    const embed = alerter._embed('Test Title', 'Test description', 0xFF0000);
    assert.equal(embed.title, 'Test Title');
    assert.equal(embed.description, 'Test description');
    assert.equal(embed.color, 0xFF0000);
    assert.ok(embed.timestamp, 'embed should have a timestamp');
  });
});
