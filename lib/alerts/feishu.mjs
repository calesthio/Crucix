// Feishu Alerter — Multi-tier alerts with rich card messages
// Mirrors TelegramAlerter architecture: same eval logic, same tier system, same dedup
// USP: Enterprise-grade messaging with HMAC-SHA256 signature verification

import { createHash, createHmac } from 'crypto';

// ─── Alert Tiers (shared with Telegram/Discord) ─────────────────────────────

const TIER_CONFIG = {
  FLASH:    { emoji: '🔴', label: 'FLASH',    cooldownMs: 5 * 60 * 1000,  maxPerHour: 6, color: 'red' },
  PRIORITY: { emoji: '🟡', label: 'PRIORITY', cooldownMs: 30 * 60 * 1000, maxPerHour: 4, color: 'orange' },
  ROUTINE:  { emoji: '🔵', label: 'ROUTINE',  cooldownMs: 60 * 60 * 1000, maxPerHour: 2, color: 'blue' },
};

// ─── Feishu Card Templates ──────────────────────────────────────────────────

const CARD_TEMPLATES = {
  FLASH: {
    header: {
      title: { tag: 'plain_text', content: '🔴 CRUCIX FLASH ALERT' },
      template: 'red',
    },
  },
  PRIORITY: {
    header: {
      title: { tag: 'plain_text', content: '🟡 CRUCIX PRIORITY ALERT' },
      template: 'orange',
    },
  },
  ROUTINE: {
    header: {
      title: { tag: 'plain_text', content: '🔵 CRUCIX ROUTINE ALERT' },
      template: 'blue',
    },
  },
};

export class FeishuAlerter {
  constructor({ webhookUrl, secret }) {
    this.webhookUrl = webhookUrl;
    this.secret = secret;
    this._alertHistory = [];
    this._contentHashes = {};
    this._muteUntil = null;
    this._commandHandlers = {};
  }

  get isConfigured() {
    return !!this.webhookUrl;
  }

  // ─── Core Messaging ─────────────────────────────────────────────────────

  /**
   * Send a message to Feishu webhook.
   * @param {string} content - Text content (plain text or markdown)
   * @param {Object} card - Optional card object for rich messages
   * @returns {Promise<boolean>} success
   */
  async sendMessage(content, card = null) {
    if (!this.isConfigured) return false;

    try {
      const body = {};

      // Generate signature if secret is configured
      if (this.secret) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const stringToSign = `${timestamp}\n${this.secret}`;
        const signature = createHmac('sha256', stringToSign).update('').digest('base64');
        body.timestamp = timestamp;
        body.sign = signature;
      }

      if (card) {
        // Rich card message
        body.msg_type = 'interactive';
        body.card = card;
      } else {
        // Plain text message
        body.msg_type = 'text';
        body.content = { text: content };
      }

      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error(`[Feishu] Webhook failed (${res.status}): ${err.substring(0, 200)}`);
        return false;
      }

      const data = await res.json().catch(() => ({}));
      if (data.code !== 0 && data.StatusCode !== 0) {
        console.error(`[Feishu] API error:`, data);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[Feishu] Send error:', err.message);
      return false;
    }
  }

  // ─── Rich Card Building ─────────────────────────────────────────────────

  /**
   * Build a Feishu interactive card for an alert.
   * @param {Object} evaluation - LLM evaluation result
   * @param {Object} delta - Delta object with signals
   * @param {string} tier - FLASH/PRIORITY/ROUTINE
   * @returns {Object} Feishu card object
   */
  _buildAlertCard(evaluation, delta, tier) {
    const tc = TIER_CONFIG[tier] || TIER_CONFIG.ROUTINE;
    const template = CARD_TEMPLATES[tier] || CARD_TEMPLATES.ROUTINE;

    const elements = [];

    // Headline
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${evaluation.headline}**`,
      },
    });

    // Reason
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: evaluation.reason || '',
      },
    });

    // Divider
    elements.push({ tag: 'hr' });

    // Key metrics
    const metrics = [];
    if (delta.summary?.direction) {
      metrics.push(`**Direction:** ${delta.summary.direction.toUpperCase()}`);
    }
    if (evaluation.confidence) {
      metrics.push(`**Confidence:** ${evaluation.confidence}`);
    }
    if (evaluation.crossCorrelation) {
      metrics.push(`**Cross-Correlation:** ${evaluation.crossCorrelation}`);
    }
    if (evaluation.actionable && evaluation.actionable !== 'Monitor') {
      metrics.push(`**💡 Action:** ${evaluation.actionable}`);
    }

    if (metrics.length > 0) {
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: metrics.join('\n'),
        },
      });
    }

    // Signals
    if (evaluation.signals?.length) {
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**Signals:** ${evaluation.signals.join(' · ')}`,
        },
      });
    }

    // Footer
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: `Crucix Intelligence · ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`,
        },
      ],
    });

    return {
      ...template,
      elements,
    };
  }

  // ─── Multi-Tier Alert Evaluation ────────────────────────────────────────
  // Identical logic to TelegramAlerter — shared eval pipeline

  async evaluateAndAlert(llmProvider, delta, memory) {
    if (!this.isConfigured) return false;
    if (!delta?.summary?.totalChanges) return false;
    if (this._isMuted()) {
      console.log('[Feishu] Alerts muted until', new Date(this._muteUntil).toLocaleTimeString());
      return false;
    }

    const allSignals = [
      ...(delta.signals?.new || []),
      ...(delta.signals?.escalated || []),
    ];

    const newSignals = allSignals.filter(s => {
      const key = this._signalKey(s);
      if (typeof memory.isSignalSuppressed === 'function') {
        if (memory.isSignalSuppressed(key)) return false;
      } else {
        const alerted = memory.getAlertedSignals();
        if (alerted[key]) return false;
      }
      if (this._isSemanticDuplicate(s)) return false;
      return true;
    });

    if (newSignals.length === 0) return false;

    // LLM evaluation with rule-based fallback
    let evaluation = null;

    if (llmProvider?.isConfigured) {
      try {
        const { TelegramAlerter } = await import('./telegram.mjs');
        const tgInstance = new TelegramAlerter({ botToken: null, chatId: null });
        const systemPrompt = tgInstance._buildEvaluationPrompt();
        const userMessage = tgInstance._buildSignalContext(newSignals, delta);
        const result = await llmProvider.complete(systemPrompt, userMessage, { maxTokens: 800, timeout: 30000 });
        evaluation = parseJSON(result.text);
      } catch (err) {
        console.warn('[Feishu] LLM evaluation failed, falling back to rules:', err.message);
      }
    }

    if (!evaluation || typeof evaluation.shouldAlert !== 'boolean') {
      evaluation = this._ruleBasedEvaluation(newSignals, delta);
      if (evaluation) evaluation._source = 'rules';
    }

    if (!evaluation?.shouldAlert) {
      console.log('[Feishu] No alert —', evaluation?.reason || 'no qualifying signals');
      return false;
    }

    const tier = TIER_CONFIG[evaluation.tier] ? evaluation.tier : 'ROUTINE';
    if (!this._checkRateLimit(tier)) {
      console.log(`[Feishu] Rate limited for tier ${tier}`);
      return false;
    }

    // Build Feishu card
    const card = this._buildAlertCard(evaluation, delta, tier);
    const sent = await this.sendMessage(null, card);

    if (sent) {
      for (const s of newSignals) {
        const key = this._signalKey(s);
        memory.markAsAlerted(key, new Date().toISOString());
        this._recordContentHash(s);
      }
      this._recordAlert(tier);
      console.log(`[Feishu] ${tier} alert sent (${evaluation._source || 'llm'}): ${evaluation.headline}`);
    }

    return sent;
  }

  // ─── Rule-Based Fallback (same logic as Telegram) ───────────────────────

  _ruleBasedEvaluation(signals, delta) {
    const criticals = signals.filter(s => s.severity === 'critical');
    const highs = signals.filter(s => s.severity === 'high');
    const nukeSignal = signals.find(s => s.key === 'nuke_anomaly');
    const osintNew = signals.filter(s => s.key?.startsWith('tg_urgent'));
    const marketSignals = signals.filter(s => ['vix', 'hy_spread', 'wti', 'brent', 'natgas', 'gold', 'silver', '10y2y'].includes(s.key));
    const conflictSignals = signals.filter(s => ['conflict_events', 'conflict_fatalities', 'thermal_total'].includes(s.key));

    if (nukeSignal) {
      return { shouldAlert: true, tier: 'FLASH', confidence: 'HIGH', headline: 'Nuclear Anomaly Detected',
        reason: 'Safecast radiation monitors have flagged an anomaly.', actionable: 'Check dashboard immediately.',
        signals: ['nuke_anomaly'], crossCorrelation: 'radiation monitors' };
    }

    const hasCriticalMarket = criticals.some(s => marketSignals.includes(s));
    const hasCriticalConflict = criticals.some(s => conflictSignals.includes(s) || osintNew.includes(s));
    if (criticals.length >= 2 && hasCriticalMarket && hasCriticalConflict) {
      return { shouldAlert: true, tier: 'FLASH', confidence: 'HIGH',
        headline: `${criticals.length} Critical Cross-Domain Signals`,
        reason: `Critical signals across market and conflict domains.`,
        actionable: 'Review dashboard. Assess exposure.',
        signals: criticals.map(s => s.label || s.key).slice(0, 5), crossCorrelation: 'market + conflict' };
    }

    const escalatedHighs = [...criticals, ...highs].filter(s => s.direction === 'up');
    if (escalatedHighs.length >= 2) {
      return { shouldAlert: true, tier: 'PRIORITY', confidence: 'MEDIUM',
        headline: `${escalatedHighs.length} Escalating Signals`,
        reason: `Multiple indicators escalating: ${escalatedHighs.map(s => s.label || s.key).slice(0, 3).join(', ')}.`,
        actionable: 'Monitor for continuation.',
        signals: escalatedHighs.map(s => s.label || s.key).slice(0, 5), crossCorrelation: 'multi-indicator' };
    }

    if (osintNew.length >= 5) {
      return { shouldAlert: true, tier: 'PRIORITY', confidence: 'MEDIUM',
        headline: `OSINT Surge: ${osintNew.length} New Urgent Posts`,
        reason: `${osintNew.length} new urgent OSINT signals. Elevated conflict tempo.`,
        actionable: 'Review OSINT stream.',
        signals: osintNew.map(s => (s.text || '').substring(0, 40)).slice(0, 3), crossCorrelation: 'telegram OSINT' };
    }

    if (criticals.length >= 1 || highs.length >= 3) {
      const top = criticals[0] || highs[0];
      return { shouldAlert: true, tier: 'ROUTINE', confidence: 'LOW',
        headline: top.label || top.reason || 'Signal Change Detected',
        reason: `${criticals.length} critical, ${highs.length} high-severity signals.`,
        actionable: 'Monitor', signals: [...criticals, ...highs].map(s => s.label || s.key).slice(0, 4),
        crossCorrelation: 'single-domain' };
    }

    return { shouldAlert: false, reason: `${signals.length} signals below alert threshold.` };
  }

  // ─── Semantic Dedup (same as Telegram) ──────────────────────────────────

  _contentHash(signal) {
    let content = '';
    if (signal.text) {
      content = signal.text.toLowerCase().replace(/\d{1,2}:\d{2}/g, '').replace(/\d+\.\d+%?/g, 'NUM').replace(/\s+/g, ' ').trim().substring(0, 120);
    } else if (signal.label) {
      content = `${signal.label}:${signal.direction || 'none'}`;
    } else {
      content = signal.key || JSON.stringify(signal).substring(0, 80);
    }
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  _isSemanticDuplicate(signal) {
    const hash = this._contentHash(signal);
    const lastSeen = this._contentHashes[hash];
    if (!lastSeen) return false;
    return new Date(lastSeen).getTime() > (Date.now() - 4 * 60 * 60 * 1000);
  }

  _recordContentHash(signal) {
    const hash = this._contentHash(signal);
    this._contentHashes[hash] = new Date().toISOString();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [h, ts] of Object.entries(this._contentHashes)) {
      if (new Date(ts).getTime() < cutoff) delete this._contentHashes[h];
    }
  }

  _signalKey(signal) {
    if (signal.text) return `fs:${this._contentHash(signal)}`;
    return signal.key || signal.label || JSON.stringify(signal).substring(0, 60);
  }

  // ─── Rate Limiting ──────────────────────────────────────────────────────

  _checkRateLimit(tier) {
    const config = TIER_CONFIG[tier];
    if (!config) return true;
    const now = Date.now();
    const lastSame = this._alertHistory.filter(a => a.tier === tier).pop();
    if (lastSame && (now - lastSame.timestamp) < config.cooldownMs) return false;
    const recentCount = this._alertHistory.filter(a => a.tier === tier && a.timestamp > now - 3600000).length;
    return recentCount < config.maxPerHour;
  }

  _recordAlert(tier) {
    this._alertHistory.push({ tier, timestamp: Date.now() });
    if (this._alertHistory.length > 50) this._alertHistory = this._alertHistory.slice(-50);
  }

  _isMuted() {
    if (!this._muteUntil) return false;
    if (Date.now() > this._muteUntil) { this._muteUntil = null; return false; }
    return true;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  try { return JSON.parse(cleaned); } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { } }
    return null;
  }
}
