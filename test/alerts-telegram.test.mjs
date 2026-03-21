// TelegramAlerter — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramAlerter } from '../lib/alerts/telegram.mjs';

// ─── isConfigured ─────────────────────────────────────────────────────────────

describe('TelegramAlerter.isConfigured', () => {
  it('returns true when botToken and chatId are provided', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '123' });
    assert.equal(alerter.isConfigured, true);
  });

  it('returns false when botToken is missing', () => {
    const alerter = new TelegramAlerter({ botToken: '', chatId: '123' });
    assert.equal(alerter.isConfigured, false);
  });

  it('returns false when chatId is missing', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '' });
    assert.equal(alerter.isConfigured, false);
  });
});

// ─── sendMessage ──────────────────────────────────────────────────────────────

describe('TelegramAlerter.sendMessage', () => {
  it('returns early with {ok:false} when not configured', async () => {
    const alerter = new TelegramAlerter({ botToken: '', chatId: '' });
    const result = await alerter.sendMessage('hello');
    assert.deepEqual(result, { ok: false });
  });

  it('POSTs to the correct Telegram URL with the message text', async () => {
    const alerter = new TelegramAlerter({ botToken: 'mytoken', chatId: '42' });
    let capturedUrl, capturedOpts;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return {
        ok: true,
        json: async () => ({ result: { message_id: 1 } }),
        text: async () => '',
      };
    };
    try {
      const result = await alerter.sendMessage('test message');
      assert.ok(capturedUrl.includes('/bot mytoken/sendMessage'.replace(' ', '')), `URL was: ${capturedUrl}`);
      assert.equal(capturedOpts.method, 'POST');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.chat_id, '42');
      assert.equal(body.text, 'test message');
      assert.equal(result.ok, true);
      assert.equal(result.messageId, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch throwing (network error) gracefully', async () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network down'); };
    try {
      const result = await alerter.sendMessage('hello');
      assert.deepEqual(result, { ok: false });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── _chunkText ───────────────────────────────────────────────────────────────

describe('TelegramAlerter._chunkText', () => {
  it('returns single-element array for text shorter than maxLen', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const result = alerter._chunkText('short text', 4096);
    assert.deepEqual(result, ['short text']);
  });

  it('splits long text into chunks at newline boundaries', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    // Build a string that is > 20 chars with a newline that should be used as split point
    const line1 = 'a'.repeat(15);
    const line2 = 'b'.repeat(15);
    const text = line1 + '\n' + line2;
    const chunks = alerter._chunkText(text, 20);
    assert.ok(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);
    // Reassembled text should equal original
    assert.equal(chunks.join(''), text);
  });

  it('returns empty array for null input', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    assert.deepEqual(alerter._chunkText(null), []);
  });

  it('returns empty array for empty string input', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    assert.deepEqual(alerter._chunkText(''), []);
  });
});

// ─── _ruleBasedEvaluation ─────────────────────────────────────────────────────

describe('TelegramAlerter._ruleBasedEvaluation', () => {
  const makeDelta = () => ({ summary: { direction: 'up', totalChanges: 5, criticalChanges: 1 } });

  it('nuclear anomaly signal → FLASH tier', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signals = [{ key: 'nuke_anomaly', severity: 'critical', description: 'test' }];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'FLASH');
  });

  it('2+ cross-domain critical signals → FLASH', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    // One market critical, one conflict critical
    const signals = [
      { key: 'vix',             severity: 'critical', direction: 'up', label: 'VIX' },
      { key: 'conflict_events', severity: 'critical', direction: 'up', label: 'Conflict Events' },
    ];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'FLASH');
  });

  it('2+ escalating high signals (direction=up) → PRIORITY', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signals = [
      { key: 'wti',      severity: 'high', direction: 'up', label: 'WTI' },
      { key: 'hy_spread', severity: 'high', direction: 'up', label: 'HY Spread' },
    ];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'PRIORITY');
  });

  it('5+ urgent OSINT posts → PRIORITY', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signals = Array.from({ length: 5 }, (_, i) => ({
      key: `tg_urgent_${i}`, severity: 'low', text: `post ${i}`,
    }));
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'PRIORITY');
  });

  it('single critical signal → ROUTINE', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signals = [{ key: 'vix', severity: 'critical', direction: 'down', label: 'VIX' }];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, true);
    assert.equal(result.tier, 'ROUTINE');
  });

  it('no qualifying signals → shouldAlert=false', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signals = [{ key: 'misc', severity: 'low', direction: 'up', label: 'Misc' }];
    const result = alerter._ruleBasedEvaluation(signals, makeDelta());
    assert.equal(result.shouldAlert, false);
  });
});

// ─── _checkRateLimit ──────────────────────────────────────────────────────────

describe('TelegramAlerter._checkRateLimit', () => {
  it('allows first alert for a tier (no history)', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    assert.equal(alerter._checkRateLimit('FLASH'), true);
  });

  it('blocks alert within cooldown period', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    // Record an alert just now
    alerter._alertHistory.push({ tier: 'FLASH', timestamp: Date.now() });
    // FLASH cooldown is 5 minutes — should be blocked immediately after
    assert.equal(alerter._checkRateLimit('FLASH'), false);
  });

  it('allows alert after cooldown period has elapsed', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    // Record an alert from 10 minutes ago (FLASH cooldown = 5 min)
    alerter._alertHistory.push({ tier: 'FLASH', timestamp: Date.now() - 10 * 60 * 1000 });
    assert.equal(alerter._checkRateLimit('FLASH'), true);
  });
});

// ─── _isMuted ─────────────────────────────────────────────────────────────────

describe('TelegramAlerter._isMuted', () => {
  it('returns false initially (no mute set)', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    assert.equal(alerter._isMuted(), false);
  });

  it('returns true when muted until future timestamp', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    alerter._muteUntil = Date.now() + 60 * 60 * 1000; // 1 hour from now
    assert.equal(alerter._isMuted(), true);
  });

  it('returns false and clears mute when mute timestamp has passed', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    alerter._muteUntil = Date.now() - 1000; // 1 second in the past
    assert.equal(alerter._isMuted(), false);
    assert.equal(alerter._muteUntil, null);
  });
});

// ─── _signalKey ───────────────────────────────────────────────────────────────

describe('TelegramAlerter._signalKey', () => {
  it('produces a string from a signal object with a key field', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signal = { key: 'vix', severity: 'critical', description: 'VIX spike' };
    const result = alerter._signalKey(signal);
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('produces a string from a signal object with a text field (uses content hash prefix)', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signal = { text: 'Breaking: explosion in Kyiv', severity: 'high' };
    const result = alerter._signalKey(signal);
    assert.equal(typeof result, 'string');
    assert.ok(result.startsWith('tg:'));
  });

  it('same signal produces same key (deterministic)', () => {
    const alerter = new TelegramAlerter({ botToken: 'tok', chatId: '1' });
    const signal = { key: 'wti', severity: 'high', label: 'WTI Oil' };
    assert.equal(alerter._signalKey(signal), alerter._signalKey(signal));
  });
});
