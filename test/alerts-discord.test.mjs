// DiscordAlerter — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordAlerter } from '../lib/alerts/discord.mjs';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

// ─── Helpers ───

function makeAlerter(overrides = {}) {
  return new DiscordAlerter({
    botToken: 'discord-bot-token',
    channelId: '111222333',
    guildId: '444555666',
    webhookUrl: null,
    ...overrides,
  });
}

function makeWebhookAlerter() {
  return new DiscordAlerter({
    botToken: null,
    channelId: null,
    guildId: null,
    webhookUrl: 'https://discord.com/api/webhooks/123/abc',
  });
}

function mockMemory(alertedKeys = {}) {
  return {
    _alerted: { ...alertedKeys },
    getAlertedSignals() { return this._alerted; },
    markAsAlerted(key, ts) { this._alerted[key] = ts; },
  };
}

function mockLLMProvider(responseText, { configured = true, shouldThrow = false } = {}) {
  return {
    get isConfigured() { return configured; },
    async complete() {
      if (shouldThrow) throw new Error('LLM failed');
      return { text: responseText, usage: { inputTokens: 10, outputTokens: 5 }, model: 'test' };
    },
  };
}

// ─── Tests ───

describe('DiscordAlerter', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  // ─── Configuration ───

  describe('isConfigured', () => {
    it('should be true with botToken and channelId', () => {
      const alerter = makeAlerter();
      assert.equal(alerter.isConfigured, true);
    });

    it('should be true with only webhookUrl', () => {
      const alerter = makeWebhookAlerter();
      assert.equal(alerter.isConfigured, true);
    });

    it('should be false with nothing', () => {
      const alerter = new DiscordAlerter({});
      assert.equal(alerter.isConfigured, false);
    });
  });

  // ─── Webhook Sending ───

  describe('sendMessage (webhook fallback)', () => {
    it('should send via webhook when bot is not ready', async () => {
      const alerter = makeWebhookAlerter();
      const fn = mockFetch('', { status: 204 });

      const result = await alerter.sendMessage('Test message');
      assert.equal(result, true);
      assert.equal(fn.mock.callCount(), 1);

      const [url, opts] = fn.mock.calls[0].arguments;
      assert.equal(url, 'https://discord.com/api/webhooks/123/abc');
      const body = JSON.parse(opts.body);
      assert.equal(body.content, 'Test message');
    });

    it('should send embeds via webhook', async () => {
      const alerter = makeWebhookAlerter();
      const fn = mockFetch('', { status: 204 });

      const embed = { title: 'Test', description: 'Hello', color: 0xFF0000 };
      await alerter.sendMessage(null, [embed]);

      const body = JSON.parse(fn.mock.calls[0].arguments[1].body);
      assert.equal(body.embeds[0].title, 'Test');
      assert.equal(body.embeds[0].color, 0xFF0000);
    });

    it('should handle webhook failure', async () => {
      const alerter = makeWebhookAlerter();
      mockFetch('Bad Request', { status: 400 });

      const result = await alerter.sendMessage('Hello');
      assert.equal(result, false);
    });

    it('should handle network error in webhook', async () => {
      const alerter = makeWebhookAlerter();
      mockFetchError('Network error');

      const result = await alerter.sendMessage('Hello');
      assert.equal(result, false);
    });

    it('should return false when not configured', async () => {
      const alerter = new DiscordAlerter({});
      const result = await alerter.sendMessage('Hello');
      assert.equal(result, false);
    });

    it('should warn when bot not ready and no webhook', async () => {
      const alerter = makeAlerter(); // has botToken but bot not started
      const result = await alerter.sendMessage('Hello');
      assert.equal(result, false);
    });
  });

  // ─── sendAlert (backward compat) ───

  describe('sendAlert', () => {
    it('should delegate to sendMessage', async () => {
      const alerter = makeWebhookAlerter();
      mockFetch('', { status: 204 });
      const result = await alerter.sendAlert('Test');
      assert.equal(result, true);
    });
  });

  // ─── Embed Builder ───

  describe('_embed', () => {
    it('should create raw embed object when EmbedBuilder is not loaded', () => {
      const alerter = makeAlerter();
      const embed = alerter._embed('Title', 'Description', 0xFF0000);
      assert.equal(embed.title, 'Title');
      assert.equal(embed.description, 'Description');
      assert.equal(embed.color, 0xFF0000);
      assert.ok(embed.timestamp);
    });
  });

  // ─── Semantic Dedup ───

  describe('semantic dedup', () => {
    it('should detect duplicates within 4h', () => {
      const alerter = makeAlerter();
      const signal = { text: 'VIX spiked to 25' };

      assert.equal(alerter._isSemanticDuplicate(signal), false);
      alerter._recordContentHash(signal);
      assert.equal(alerter._isSemanticDuplicate(signal), true);
    });

    it('should not flag old signals as duplicate', () => {
      const alerter = makeAlerter();
      const signal = { label: 'Gold', direction: 'up' };
      const hash = alerter._contentHash(signal);
      alerter._contentHashes[hash] = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      assert.equal(alerter._isSemanticDuplicate(signal), false);
    });

    it('should normalize text for content hashing', () => {
      const alerter = makeAlerter();
      const s1 = { text: 'Gold at 2340.50' };
      const s2 = { text: 'Gold at 2380.90' };
      assert.equal(alerter._contentHash(s1), alerter._contentHash(s2));
    });

    it('should generate signal key with dc: prefix for text signals', () => {
      const alerter = makeAlerter();
      const key = alerter._signalKey({ text: 'test signal' });
      assert.ok(key.startsWith('dc:'));
    });

    it('should use key/label for metric signal keys', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._signalKey({ key: 'vix' }), 'vix');
      assert.equal(alerter._signalKey({ label: 'Gold' }), 'Gold');
    });

    it('should prune hashes older than 24h', () => {
      const alerter = makeAlerter();
      const oldHash = 'abcdef1234567890';
      alerter._contentHashes[oldHash] = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

      // Recording a new hash triggers pruning
      alerter._recordContentHash({ text: 'new signal' });
      assert.equal(alerter._contentHashes[oldHash], undefined);
    });
  });

  // ─── Rate Limiting ───

  describe('rate limiting', () => {
    it('should allow first alert', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._checkRateLimit('FLASH'), true);
    });

    it('should block during cooldown', () => {
      const alerter = makeAlerter();
      alerter._recordAlert('FLASH');
      assert.equal(alerter._checkRateLimit('FLASH'), false);
    });

    it('should block at hourly cap', () => {
      const alerter = makeAlerter();
      for (let i = 0; i < 6; i++) {
        alerter._alertHistory.push({ tier: 'FLASH', timestamp: Date.now() - (i + 1) * 60 * 1000 * 6 });
      }
      assert.equal(alerter._checkRateLimit('FLASH'), false);
    });

    it('should allow unknown tier', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._checkRateLimit('UNKNOWN'), true);
    });

    it('should cap alert history at 50', () => {
      const alerter = makeAlerter();
      for (let i = 0; i < 55; i++) alerter._recordAlert('ROUTINE');
      assert.equal(alerter._alertHistory.length, 50);
    });
  });

  // ─── Mute ───

  describe('mute/unmute', () => {
    it('should be unmuted by default', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._isMuted(), false);
    });

    it('should report muted when future timestamp set', () => {
      const alerter = makeAlerter();
      alerter._muteUntil = Date.now() + 60000;
      assert.equal(alerter._isMuted(), true);
    });

    it('should auto-unmute when timestamp passes', () => {
      const alerter = makeAlerter();
      alerter._muteUntil = Date.now() - 1000;
      assert.equal(alerter._isMuted(), false);
      assert.equal(alerter._muteUntil, null);
    });
  });

  // ─── Rule-Based Evaluation ───

  describe('_ruleBasedEvaluation', () => {
    it('should return FLASH for nuclear anomaly', () => {
      const alerter = makeAlerter();
      const signals = [{ key: 'nuke_anomaly', severity: 'critical' }];
      const delta = { summary: { direction: 'escalating', totalChanges: 1, criticalChanges: 1 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'FLASH');
    });

    it('should return FLASH for cross-domain critical signals', () => {
      const alerter = makeAlerter();
      const signals = [
        { key: 'vix', severity: 'critical', label: 'VIX' },
        { key: 'conflict_events', severity: 'critical', label: 'Conflict' },
      ];
      const delta = { summary: { direction: 'escalating', totalChanges: 2, criticalChanges: 2 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'FLASH');
    });

    it('should return PRIORITY for escalating high signals', () => {
      const alerter = makeAlerter();
      const signals = [
        { key: 'gold', severity: 'high', direction: 'up', label: 'Gold' },
        { key: 'silver', severity: 'high', direction: 'up', label: 'Silver' },
      ];
      const delta = { summary: { direction: 'up', totalChanges: 2, criticalChanges: 0 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'PRIORITY');
    });

    it('should return PRIORITY for OSINT surge (5+ tg_urgent)', () => {
      const alerter = makeAlerter();
      const signals = Array.from({ length: 5 }, (_, i) => ({
        key: `tg_urgent_${i}`, severity: 'medium', text: `Post ${i}`,
      }));
      const delta = { summary: { direction: 'escalating', totalChanges: 5, criticalChanges: 0 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'PRIORITY');
    });

    it('should return ROUTINE for single critical', () => {
      const alerter = makeAlerter();
      const signals = [{ key: 'wti', severity: 'critical', label: 'WTI' }];
      const delta = { summary: { direction: 'up', totalChanges: 1, criticalChanges: 1 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'ROUTINE');
    });

    it('should return no alert for weak signals', () => {
      const alerter = makeAlerter();
      const signals = [{ key: 'a', severity: 'low' }, { key: 'b', severity: 'medium' }];
      const delta = { summary: { direction: 'stable', totalChanges: 2, criticalChanges: 0 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, false);
    });
  });

  // ─── evaluateAndAlert ───

  describe('evaluateAndAlert', () => {
    it('should return false when not configured', async () => {
      const alerter = new DiscordAlerter({});
      const result = await alerter.evaluateAndAlert(null, {}, mockMemory());
      assert.equal(result, false);
    });

    it('should return false when delta has no changes', async () => {
      const alerter = makeAlerter();
      const result = await alerter.evaluateAndAlert(null, { summary: { totalChanges: 0 } }, mockMemory());
      assert.equal(result, false);
    });

    it('should return false when muted', async () => {
      const alerter = makeAlerter();
      alerter._muteUntil = Date.now() + 60000;
      const delta = { summary: { totalChanges: 1 }, signals: { new: [{ key: 'test' }] } };
      const result = await alerter.evaluateAndAlert(null, delta, mockMemory());
      assert.equal(result, false);
    });

    it('should return false when all signals already alerted', async () => {
      const alerter = makeAlerter();
      const delta = {
        summary: { totalChanges: 1, direction: 'up', criticalChanges: 1 },
        signals: { new: [{ key: 'vix', severity: 'critical' }], escalated: [] },
      };
      const result = await alerter.evaluateAndAlert(null, delta, mockMemory({ vix: '2024-01-01' }));
      assert.equal(result, false);
    });

    it('should use rule-based evaluation when no LLM configured', async () => {
      const alerter = makeWebhookAlerter();
      mockFetch('', { status: 204 });

      const delta = {
        summary: { totalChanges: 1, direction: 'escalating', criticalChanges: 1 },
        signals: { new: [{ key: 'nuke_anomaly', severity: 'critical' }], escalated: [] },
      };

      const result = await alerter.evaluateAndAlert(null, delta, mockMemory());
      assert.equal(result, true);
    });

    it('should mark signals as alerted on success', async () => {
      const alerter = makeWebhookAlerter();
      mockFetch('', { status: 204 });

      const delta = {
        summary: { totalChanges: 1, direction: 'escalating', criticalChanges: 1 },
        signals: { new: [{ key: 'nuke_anomaly', severity: 'critical' }], escalated: [] },
      };
      const memory = mockMemory();

      await alerter.evaluateAndAlert(null, delta, memory);
      assert.ok(Object.keys(memory._alerted).length > 0);
    });

    it('should fall back to rules when LLM fails', async () => {
      const alerter = makeWebhookAlerter();
      mockFetch('', { status: 204 });

      const provider = mockLLMProvider('', { shouldThrow: true });
      const delta = {
        summary: { totalChanges: 1, direction: 'escalating', criticalChanges: 1 },
        signals: { new: [{ key: 'nuke_anomaly', severity: 'critical' }], escalated: [] },
      };

      const result = await alerter.evaluateAndAlert(provider, delta, mockMemory());
      assert.equal(result, true);
    });

    it('should support isSignalSuppressed memory interface', async () => {
      const alerter = makeAlerter();
      const delta = {
        summary: { totalChanges: 1, direction: 'up', criticalChanges: 1 },
        signals: { new: [{ key: 'vix', severity: 'critical' }], escalated: [] },
      };
      const memory = {
        isSignalSuppressed: () => true,
        markAsAlerted: () => {},
      };
      const result = await alerter.evaluateAndAlert(null, delta, memory);
      assert.equal(result, false);
    });
  });

  // ─── Alert Embed ───

  describe('_buildAlertEmbed', () => {
    it('should create embed with correct fields', () => {
      const alerter = makeAlerter();
      const evaluation = {
        headline: 'Test Alert',
        reason: 'Test reason.',
        confidence: 'HIGH',
        crossCorrelation: 'market + conflict',
        actionable: 'Check dashboard',
        signals: ['vix', 'gold'],
      };
      const delta = { summary: { direction: 'escalating' } };
      const embed = alerter._buildAlertEmbed(evaluation, delta, 'FLASH');

      assert.ok(embed.title.includes('FLASH'));
      assert.ok(embed.description.includes('Test Alert'));
      assert.equal(embed.color, 0xFF0000);
      assert.ok(embed.fields.length >= 2);

      const dirField = embed.fields.find(f => f.name === 'Direction');
      assert.equal(dirField.value, 'ESCALATING');
    });

    it('should omit Action field when actionable is Monitor', () => {
      const alerter = makeAlerter();
      const evaluation = {
        headline: 'Minor',
        reason: 'Small shift.',
        confidence: 'LOW',
        actionable: 'Monitor',
        signals: [],
      };
      const delta = { summary: { direction: 'stable' } };
      const embed = alerter._buildAlertEmbed(evaluation, delta, 'ROUTINE');
      const actionField = embed.fields.find(f => f.name === '💡 Action');
      assert.equal(actionField, undefined);
    });
  });

  // ─── onCommand ───

  describe('onCommand', () => {
    it('should register handler', () => {
      const alerter = makeAlerter();
      alerter.onCommand('status', async () => 'ok');
      assert.ok(alerter._commandHandlers['status']);
    });

    it('should lowercase command name', () => {
      const alerter = makeAlerter();
      alerter.onCommand('STATUS', async () => 'ok');
      assert.ok(alerter._commandHandlers['status']);
    });
  });

  // ─── Lifecycle ───

  describe('stop', () => {
    it('should handle stop when client is null', async () => {
      const alerter = makeAlerter();
      // Should not throw
      await alerter.stop();
      assert.equal(alerter._client, null);
    });
  });
});
