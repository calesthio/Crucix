// TelegramAlerter — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramAlerter } from '../lib/alerts/telegram.mjs';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

// ─── Helpers ───

function makeAlerter(overrides = {}) {
  return new TelegramAlerter({ botToken: 'test-bot-token', chatId: '12345', ...overrides });
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

describe('TelegramAlerter', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  // ─── Configuration ───

  describe('isConfigured', () => {
    it('should be true with both botToken and chatId', () => {
      const alerter = makeAlerter();
      assert.equal(alerter.isConfigured, true);
    });

    it('should be false without botToken', () => {
      const alerter = makeAlerter({ botToken: null });
      assert.equal(alerter.isConfigured, false);
    });

    it('should be false without chatId', () => {
      const alerter = makeAlerter({ chatId: null });
      assert.equal(alerter.isConfigured, false);
    });
  });

  // ─── sendMessage ───

  describe('sendMessage', () => {
    it('should send a message and return ok', async () => {
      const alerter = makeAlerter();
      const fn = mockFetch({ ok: true, result: { message_id: 42 } });

      const result = await alerter.sendMessage('Hello test');
      assert.equal(result.ok, true);
      assert.equal(result.messageId, 42);
      assert.equal(fn.mock.callCount(), 1);

      const [url, opts] = fn.mock.calls[0].arguments;
      assert.ok(url.includes('/bottest-bot-token/sendMessage'));
      const body = JSON.parse(opts.body);
      assert.equal(body.chat_id, '12345');
      assert.equal(body.text, 'Hello test');
      assert.equal(body.parse_mode, 'Markdown');
    });

    it('should return ok:false when not configured', async () => {
      const alerter = makeAlerter({ botToken: null });
      const result = await alerter.sendMessage('Hello');
      assert.equal(result.ok, false);
    });

    it('should handle API errors gracefully', async () => {
      const alerter = makeAlerter();
      mockFetch('Bad Request', { status: 400 });

      const result = await alerter.sendMessage('Hello');
      assert.equal(result.ok, false);
    });

    it('should handle network errors gracefully', async () => {
      const alerter = makeAlerter();
      mockFetchError('Network timeout');

      const result = await alerter.sendMessage('Hello');
      assert.equal(result.ok, false);
    });

    it('should use custom chatId from opts', async () => {
      const alerter = makeAlerter();
      const fn = mockFetch({ ok: true, result: { message_id: 1 } });

      await alerter.sendMessage('Hello', { chatId: '99999' });
      const body = JSON.parse(fn.mock.calls[0].arguments[1].body);
      assert.equal(body.chat_id, '99999');
    });

    it('should pass replyToMessageId on first chunk', async () => {
      const alerter = makeAlerter();
      const fn = mockFetch({ ok: true, result: { message_id: 1 } });

      await alerter.sendMessage('Hello', { replyToMessageId: 77 });
      const body = JSON.parse(fn.mock.calls[0].arguments[1].body);
      assert.equal(body.reply_to_message_id, 77);
    });
  });

  // ─── sendAlert (backward compat) ───

  describe('sendAlert', () => {
    it('should return true on success', async () => {
      const alerter = makeAlerter();
      mockFetch({ ok: true, result: { message_id: 1 } });
      const result = await alerter.sendAlert('Alert text');
      assert.equal(result, true);
    });

    it('should return false on failure', async () => {
      const alerter = makeAlerter();
      mockFetch('Error', { status: 500 });
      const result = await alerter.sendAlert('Alert text');
      assert.equal(result, false);
    });
  });

  // ─── _chunkText ───

  describe('_chunkText', () => {
    it('should return single chunk for short text', () => {
      const alerter = makeAlerter();
      const chunks = alerter._chunkText('Hello', 100);
      assert.deepEqual(chunks, ['Hello']);
    });

    it('should return empty array for empty text', () => {
      const alerter = makeAlerter();
      assert.deepEqual(alerter._chunkText('', 100), []);
      assert.deepEqual(alerter._chunkText(null, 100), []);
    });

    it('should split at newline boundaries', () => {
      const alerter = makeAlerter();
      const text = 'line1\nline2\nline3\nline4';
      const chunks = alerter._chunkText(text, 12);
      assert.ok(chunks.length >= 2);
      // Each chunk should be within limit
      for (const c of chunks) {
        assert.ok(c.length <= 12);
      }
    });

    it('should handle text without newlines', () => {
      const alerter = makeAlerter();
      const text = 'a'.repeat(20);
      const chunks = alerter._chunkText(text, 10);
      assert.equal(chunks.length, 2);
      assert.equal(chunks[0].length, 10);
      assert.equal(chunks[1].length, 10);
    });
  });

  // ─── Semantic Dedup ───

  describe('semantic dedup', () => {
    it('should detect duplicate signals within 4h window', () => {
      const alerter = makeAlerter();
      const signal = { text: 'VIX spiked to 25.5' };

      assert.equal(alerter._isSemanticDuplicate(signal), false);
      alerter._recordContentHash(signal);
      assert.equal(alerter._isSemanticDuplicate(signal), true);
    });

    it('should not consider signals older than 4h as duplicates', () => {
      const alerter = makeAlerter();
      const signal = { label: 'VIX', direction: 'up' };
      const hash = alerter._contentHash(signal);

      // Set hash timestamp to 5 hours ago
      alerter._contentHashes[hash] = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      assert.equal(alerter._isSemanticDuplicate(signal), false);
    });

    it('should normalize numbers in content hashing', () => {
      const alerter = makeAlerter();
      const s1 = { text: 'VIX spiked to 25.5%' };
      const s2 = { text: 'VIX spiked to 30.2%' };
      // Both should hash the same since numbers are normalized
      assert.equal(alerter._contentHash(s1), alerter._contentHash(s2));
    });

    it('should generate signal key from text hash', () => {
      const alerter = makeAlerter();
      const signal = { text: 'Some OSINT post' };
      const key = alerter._signalKey(signal);
      assert.ok(key.startsWith('tg:'));
    });

    it('should generate signal key from key/label for metric signals', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._signalKey({ key: 'vix' }), 'vix');
      assert.equal(alerter._signalKey({ label: 'Gold Price' }), 'Gold Price');
    });
  });

  // ─── Rate Limiting ───

  describe('rate limiting', () => {
    it('should allow first alert of any tier', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._checkRateLimit('FLASH'), true);
      assert.equal(alerter._checkRateLimit('PRIORITY'), true);
      assert.equal(alerter._checkRateLimit('ROUTINE'), true);
    });

    it('should enforce cooldown period', () => {
      const alerter = makeAlerter();
      alerter._recordAlert('FLASH');
      // FLASH cooldown is 5 min, so immediately after should be blocked
      assert.equal(alerter._checkRateLimit('FLASH'), false);
    });

    it('should enforce hourly cap', () => {
      const alerter = makeAlerter();
      // FLASH maxPerHour is 6
      for (let i = 0; i < 6; i++) {
        alerter._alertHistory.push({ tier: 'FLASH', timestamp: Date.now() - (i + 1) * 60 * 1000 * 6 });
      }
      assert.equal(alerter._checkRateLimit('FLASH'), false);
    });

    it('should return true for unknown tier', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._checkRateLimit('UNKNOWN'), true);
    });

    it('should trim alert history to 50 entries', () => {
      const alerter = makeAlerter();
      for (let i = 0; i < 55; i++) {
        alerter._recordAlert('ROUTINE');
      }
      assert.equal(alerter._alertHistory.length, 50);
    });
  });

  // ─── Mute ───

  describe('mute/unmute', () => {
    it('should report not muted by default', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._isMuted(), false);
    });

    it('should report muted when muteUntil is in the future', () => {
      const alerter = makeAlerter();
      alerter._muteUntil = Date.now() + 60000;
      assert.equal(alerter._isMuted(), true);
    });

    it('should auto-unmute when muteUntil passes', () => {
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

    it('should return PRIORITY for multiple escalating high signals', () => {
      const alerter = makeAlerter();
      const signals = [
        { key: 'gold', severity: 'high', direction: 'up', label: 'Gold' },
        { key: 'silver', severity: 'high', direction: 'up', label: 'Silver' },
      ];
      const delta = { summary: { direction: 'escalating', totalChanges: 2, criticalChanges: 0 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'PRIORITY');
    });

    it('should return PRIORITY for OSINT surge', () => {
      const alerter = makeAlerter();
      const signals = Array.from({ length: 5 }, (_, i) => ({
        key: `tg_urgent_${i}`, severity: 'medium', text: `Urgent post ${i}`
      }));
      const delta = { summary: { direction: 'escalating', totalChanges: 5, criticalChanges: 0 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'PRIORITY');
    });

    it('should return ROUTINE for single critical signal', () => {
      const alerter = makeAlerter();
      const signals = [{ key: 'wti', severity: 'critical', label: 'WTI Spike' }];
      const delta = { summary: { direction: 'escalating', totalChanges: 1, criticalChanges: 1 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'ROUTINE');
    });

    it('should return ROUTINE for 3+ high signals', () => {
      const alerter = makeAlerter();
      const signals = [
        { key: 'a', severity: 'high', label: 'A' },
        { key: 'b', severity: 'high', label: 'B' },
        { key: 'c', severity: 'high', label: 'C' },
      ];
      const delta = { summary: { direction: 'mixed', totalChanges: 3, criticalChanges: 0 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, true);
      assert.equal(result.tier, 'ROUTINE');
    });

    it('should return no alert for low severity signals', () => {
      const alerter = makeAlerter();
      const signals = [
        { key: 'a', severity: 'low' },
        { key: 'b', severity: 'medium' },
      ];
      const delta = { summary: { direction: 'stable', totalChanges: 2, criticalChanges: 0 } };
      const result = alerter._ruleBasedEvaluation(signals, delta);
      assert.equal(result.shouldAlert, false);
    });
  });

  // ─── evaluateAndAlert ───

  describe('evaluateAndAlert', () => {
    it('should return false when not configured', async () => {
      const alerter = makeAlerter({ botToken: null });
      const result = await alerter.evaluateAndAlert(null, {}, mockMemory());
      assert.equal(result, false);
    });

    it('should return false when delta has no changes', async () => {
      const alerter = makeAlerter();
      const result = await alerter.evaluateAndAlert(null, { summary: { totalChanges: 0 } }, mockMemory());
      assert.equal(result, false);
    });

    it('should return false when delta is null', async () => {
      const alerter = makeAlerter();
      const result = await alerter.evaluateAndAlert(null, null, mockMemory());
      assert.equal(result, false);
    });

    it('should return false when muted', async () => {
      const alerter = makeAlerter();
      alerter._muteUntil = Date.now() + 60000;
      const delta = { summary: { totalChanges: 5 }, signals: { new: [{ key: 'nuke_anomaly', severity: 'critical' }] } };
      const result = await alerter.evaluateAndAlert(null, delta, mockMemory());
      assert.equal(result, false);
    });

    it('should return false when all signals already alerted', async () => {
      const alerter = makeAlerter();
      const delta = {
        summary: { totalChanges: 1, direction: 'up', criticalChanges: 1 },
        signals: { new: [{ key: 'vix', severity: 'critical' }], escalated: [] },
      };
      const memory = mockMemory({ vix: '2024-01-01' });
      const result = await alerter.evaluateAndAlert(null, delta, memory);
      assert.equal(result, false);
    });

    it('should use rule-based evaluation when LLM is not configured', async () => {
      const alerter = makeAlerter();
      mockFetch({ ok: true, result: { message_id: 1 } });

      const delta = {
        summary: { totalChanges: 1, direction: 'escalating', criticalChanges: 1 },
        signals: { new: [{ key: 'nuke_anomaly', severity: 'critical' }], escalated: [] },
      };

      const result = await alerter.evaluateAndAlert(null, delta, mockMemory());
      assert.equal(result, true);
    });

    it('should use LLM evaluation when provider is configured', async () => {
      const alerter = makeAlerter();
      mockFetch({ ok: true, result: { message_id: 1 } });

      const llmResponse = JSON.stringify({
        shouldAlert: true,
        tier: 'PRIORITY',
        headline: 'LLM detected signal',
        reason: 'Test reason',
        actionable: 'Monitor',
        signals: ['test'],
        confidence: 'MEDIUM',
        crossCorrelation: 'test',
      });
      const provider = mockLLMProvider(llmResponse);

      const delta = {
        summary: { totalChanges: 1, direction: 'escalating', criticalChanges: 0 },
        signals: { new: [{ key: 'test_signal', severity: 'medium', label: 'Test' }], escalated: [] },
      };

      const result = await alerter.evaluateAndAlert(provider, delta, mockMemory());
      assert.equal(result, true);
    });

    it('should fall back to rules when LLM throws', async () => {
      const alerter = makeAlerter();
      mockFetch({ ok: true, result: { message_id: 1 } });

      const provider = mockLLMProvider('', { shouldThrow: true });

      const delta = {
        summary: { totalChanges: 1, direction: 'escalating', criticalChanges: 1 },
        signals: { new: [{ key: 'nuke_anomaly', severity: 'critical' }], escalated: [] },
      };

      const result = await alerter.evaluateAndAlert(provider, delta, mockMemory());
      assert.equal(result, true);
    });

    it('should mark signals as alerted after successful send', async () => {
      const alerter = makeAlerter();
      mockFetch({ ok: true, result: { message_id: 1 } });

      const delta = {
        summary: { totalChanges: 1, direction: 'escalating', criticalChanges: 1 },
        signals: { new: [{ key: 'nuke_anomaly', severity: 'critical' }], escalated: [] },
      };
      const memory = mockMemory();

      await alerter.evaluateAndAlert(null, delta, memory);
      assert.ok(Object.keys(memory._alerted).length > 0);
    });

    it('should support isSignalSuppressed memory interface', async () => {
      const alerter = makeAlerter();
      const delta = {
        summary: { totalChanges: 1, direction: 'up', criticalChanges: 1 },
        signals: { new: [{ key: 'vix', severity: 'critical' }], escalated: [] },
      };
      const memory = {
        isSignalSuppressed: (key) => true, // suppress everything
        markAsAlerted: () => {},
      };
      const result = await alerter.evaluateAndAlert(null, delta, memory);
      assert.equal(result, false);
    });
  });

  // ─── Bot Command Handling ───

  describe('onCommand', () => {
    it('should register a command handler', () => {
      const alerter = makeAlerter();
      alerter.onCommand('/status', async () => 'ok');
      assert.ok(alerter._commandHandlers['/status']);
    });
  });

  describe('_normalizeCommand', () => {
    it('should return command as-is without @mention', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._normalizeCommand('/status'), '/status');
    });

    it('should strip bot mention when matching', () => {
      const alerter = makeAlerter();
      alerter._botUsername = 'crucix_bot';
      assert.equal(alerter._normalizeCommand('/status@crucix_bot'), '/status');
    });

    it('should return null for different bot mention', () => {
      const alerter = makeAlerter();
      alerter._botUsername = 'crucix_bot';
      assert.equal(alerter._normalizeCommand('/status@other_bot'), null);
    });

    it('should return null for non-command text', () => {
      const alerter = makeAlerter();
      assert.equal(alerter._normalizeCommand('hello'), null);
    });
  });

  // ─── Message Formatting ───

  describe('_formatTieredAlert', () => {
    it('should format a FLASH alert', () => {
      const alerter = makeAlerter();
      const evaluation = {
        headline: 'Nuclear Alert',
        reason: 'Radiation detected.',
        confidence: 'HIGH',
        crossCorrelation: 'radiation + satellite',
        actionable: 'Check dashboard',
        signals: ['nuke_anomaly'],
      };
      const delta = { summary: { direction: 'escalating' } };
      const msg = alerter._formatTieredAlert(evaluation, delta, 'FLASH');
      assert.ok(msg.includes('CRUCIX FLASH'));
      assert.ok(msg.includes('Nuclear Alert'));
      assert.ok(msg.includes('HIGH'));
      assert.ok(msg.includes('ESCALATING'));
      assert.ok(msg.includes('nuke\\_anomaly'));
    });

    it('should format a ROUTINE alert without action line', () => {
      const alerter = makeAlerter();
      const evaluation = {
        headline: 'Minor Change',
        reason: 'Small shift.',
        confidence: 'LOW',
        actionable: 'Monitor',
        signals: [],
      };
      const delta = { summary: { direction: 'stable' } };
      const msg = alerter._formatTieredAlert(evaluation, delta, 'ROUTINE');
      assert.ok(msg.includes('CRUCIX ROUTINE'));
      assert.ok(!msg.includes('Action:'));
    });
  });

  // ─── Polling ───

  describe('startPolling / stopPolling', () => {
    it('should not start polling when not configured', () => {
      const alerter = makeAlerter({ botToken: null });
      alerter.startPolling(60000);
      assert.equal(alerter._pollingInterval, null);
    });

    it('should stop polling cleanly', () => {
      const alerter = makeAlerter();
      // Manually set a fake interval
      alerter._pollingInterval = setInterval(() => {}, 999999);
      alerter.stopPolling();
      assert.equal(alerter._pollingInterval, null);
    });
  });
});
