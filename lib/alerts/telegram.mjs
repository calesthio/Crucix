// Telegram Alerter v2 — Multi-tier alerts, semantic dedup, two-way bot commands
// USP feature: Crucix becomes a conversational intelligence agent via Telegram

import { createHash } from 'crypto';

const TELEGRAM_API = 'https://api.telegram.org';

// ─── Alert Tiers ────────────────────────────────────────────────────────────
// FLASH:    Immediate action required — market-moving, time-critical (e.g. war escalation, flash crash)
// PRIORITY: Important signal cluster — act within hours (e.g. rate surprise, major OSINT shift)
// ROUTINE:  Noteworthy change — FYI, no urgency (e.g. trend continuation, moderate delta)

const TIER_CONFIG = {
  FLASH:    { emoji: '🔴', label: 'FLASH',    cooldownMs: 5 * 60 * 1000,  maxPerHour: 6 },
  PRIORITY: { emoji: '🟡', label: 'PRIORITY', cooldownMs: 30 * 60 * 1000, maxPerHour: 4 },
  ROUTINE:  { emoji: '🔵', label: 'ROUTINE',  cooldownMs: 60 * 60 * 1000, maxPerHour: 2 },
};

// ─── Bot Commands ───────────────────────────────────────────────────────────
const COMMANDS = {
  '/status':    'Get current system health, last sweep time, source status',
  '/sweep':     'Trigger a manual sweep cycle',
  '/brief':     'Get a compact text summary of the latest intelligence',
  '/portfolio': 'Show current positions and P&L (if Alpaca connected)',
  '/alerts':    'Show recent alert history',
  '/mute':      'Mute alerts for 1h (or /mute 2h, /mute 4h)',
  '/unmute':    'Resume alerts',
  '/help':      'Show available commands',
};

export class TelegramAlerter {
  constructor({ botToken, chatId }) {
    this.botToken = botToken;
    this.chatId = chatId;
    this._alertHistory = [];     // Recent alerts for rate limiting
    this._contentHashes = {};    // Semantic dedup: hash → timestamp
    this._muteUntil = null;      // Mute timestamp
    this._lastUpdateId = 0;      // For polling bot commands
    this._commandHandlers = {};  // Registered command callbacks
    this._pollingInterval = null;
    this._botUsername = null;
  }

  get isConfigured() {
    return !!(this.botToken && this.chatId);
  }

  // ─── Core Messaging ─────────────────────────────────────────────────────

  /**
   * Send a message via Telegram Bot API.
   * @param {string} message - markdown-formatted message
   * @param {object} opts - optional: { parseMode, disablePreview, replyToMessageId }
   * @returns {Promise<{ok: boolean, messageId?: number}>}
   */
  async sendMessage(message, opts = {}) {
    if (!this.isConfigured) return { ok: false };

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: opts.chatId ?? this.chatId,
          text: message,
          parse_mode: opts.parseMode || 'Markdown',
          disable_web_page_preview: opts.disablePreview !== false,
          ...(opts.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error(`[Telegram] Send failed (${res.status}): ${err.substring(0, 200)}`);
        return { ok: false };
      }

      const data = await res.json();
      return { ok: true, messageId: data.result?.message_id };
    } catch (err) {
      console.error('[Telegram] Send error:', err.message);
      return { ok: false };
    }
  }

  // Backward-compatible alias
  async sendAlert(message) {
    const result = await this.sendMessage(message);
    return result.ok;
  }

  // ─── Multi-Tier Alert Evaluation ────────────────────────────────────────

  /**
   * Evaluate delta signals with LLM and send tiered alert if warranted.
   * Uses semantic dedup, rate limiting, and a much richer evaluation prompt.
   */
  async evaluateAndAlert(llmProvider, delta, memory) {
    if (!this.isConfigured) return false;
    if (!delta?.summary?.totalChanges) return false;
    if (this._isMuted()) {
      console.log('[Telegram] Alerts muted until', new Date(this._muteUntil).toLocaleTimeString());
      return false;
    }

    // 1. Gather new signals — filter already-alerted AND semantically duplicate
    const allSignals = [
      ...(delta.signals?.new || []),
      ...(delta.signals?.escalated || []),
    ];

    const newSignals = allSignals.filter(s => {
      const key = this._signalKey(s);
      // Check decay-based suppression (if memory supports it)
      if (typeof memory.isSignalSuppressed === 'function') {
        if (memory.isSignalSuppressed(key)) return false;
      } else {
        // Legacy: check flat alerted map
        const alerted = memory.getAlertedSignals();
        if (alerted[key]) return false;
      }
      // Check semantic/content hash dedup
      if (this._isSemanticDuplicate(s)) return false;
      return true;
    });

    if (newSignals.length === 0) return false;

    // 2. Try LLM evaluation first, fall back to rule-based if unavailable
    let evaluation = null;

    if (llmProvider?.isConfigured) {
      try {
        const systemPrompt = this._buildEvaluationPrompt();
        const userMessage = this._buildSignalContext(newSignals, delta);
        const result = await llmProvider.complete(systemPrompt, userMessage, {
          maxTokens: 800,
          timeout: 30000,
        });
        evaluation = parseJSON(result.text);
      } catch (err) {
        console.warn('[Telegram] LLM evaluation failed, falling back to rules:', err.message);
        // Fall through to rule-based evaluation
      }
    }

    // Rule-based fallback: fires when LLM is unavailable or returns garbage
    if (!evaluation || typeof evaluation.shouldAlert !== 'boolean') {
      evaluation = this._ruleBasedEvaluation(newSignals, delta);
      if (evaluation) evaluation._source = 'rules';
    }

    if (!evaluation?.shouldAlert) {
      console.log('[Telegram] No alert —', evaluation?.reason || 'no qualifying signals');
      return false;
    }

    // 3. Validate tier and check rate limits
    const tier = TIER_CONFIG[evaluation.tier] ? evaluation.tier : 'ROUTINE';
    if (!this._checkRateLimit(tier)) {
      console.log(`[Telegram] Rate limited for tier ${tier}`);
      return false;
    }

    // 4. Format and send tiered alert
    const message = this._formatTieredAlert(evaluation, delta, tier);
    const sent = await this.sendAlert(message);

    if (sent) {
      // Mark signals as alerted with content hashing
      for (const s of newSignals) {
        const key = this._signalKey(s);
        memory.markAsAlerted(key, new Date().toISOString());
        this._recordContentHash(s);
      }
      this._recordAlert(tier);
      console.log(`[Telegram] ${tier} alert sent (${evaluation._source || 'llm'}): ${evaluation.headline}`);
    }

    return sent;
  }

  // ─── Rule-Based Alert Fallback ────────────────────────────────────────

  /**
   * Deterministic alert evaluation when LLM is unavailable.
   * Uses signal counts, severity, and cross-domain correlation.
   */
  _ruleBasedEvaluation(signals, delta) {
    const criticals = signals.filter(s => s.severity === 'critical');
    const highs = signals.filter(s => s.severity === 'high');
    const nukeSignal = signals.find(s => s.key === 'nuke_anomaly');
    const osintNew = signals.filter(s => s.key?.startsWith('tg_urgent'));
    const marketSignals = signals.filter(s => ['vix', 'hy_spread', 'wti', 'brent', '10y2y'].includes(s.key));
    const conflictSignals = signals.filter(s => ['conflict_events', 'conflict_fatalities', 'thermal_total'].includes(s.key));

    // FLASH: nuclear anomaly, or ≥3 critical signals across domains
    if (nukeSignal) {
      return {
        shouldAlert: true, tier: 'FLASH', confidence: 'HIGH',
        headline: 'Nuclear Anomaly Detected',
        reason: 'Safecast radiation monitors have flagged an anomaly. This requires immediate attention.',
        actionable: 'Check dashboard for affected sites. Monitor confirmation from secondary sources.',
        signals: ['nuke_anomaly'],
        crossCorrelation: 'radiation monitors',
      };
    }

    // FLASH: ≥2 critical signals AND they span multiple domains
    const hasCriticalMarket = criticals.some(s => marketSignals.includes(s));
    const hasCriticalConflict = criticals.some(s => conflictSignals.includes(s) || osintNew.includes(s));
    if (criticals.length >= 2 && hasCriticalMarket && hasCriticalConflict) {
      return {
        shouldAlert: true, tier: 'FLASH', confidence: 'HIGH',
        headline: `${criticals.length} Critical Cross-Domain Signals`,
        reason: `${criticals.length} critical signals detected across market and conflict domains. Multi-domain correlation suggests systemic event.`,
        actionable: 'Review dashboard immediately. Assess portfolio exposure.',
        signals: criticals.map(s => s.label || s.key).slice(0, 5),
        crossCorrelation: 'market + conflict',
      };
    }

    // PRIORITY: ≥2 high/critical signals in same direction
    const escalatedHighs = [...criticals, ...highs].filter(s => s.direction === 'up');
    if (escalatedHighs.length >= 2) {
      return {
        shouldAlert: true, tier: 'PRIORITY', confidence: 'MEDIUM',
        headline: `${escalatedHighs.length} Escalating Signals`,
        reason: `Multiple indicators escalating simultaneously: ${escalatedHighs.map(s => s.label || s.key).slice(0, 3).join(', ')}.`,
        actionable: 'Monitor for continuation. Check if trend persists in next sweep.',
        signals: escalatedHighs.map(s => s.label || s.key).slice(0, 5),
        crossCorrelation: 'multi-indicator',
      };
    }

    // PRIORITY: ≥5 new OSINT posts (surge in conflict reporting)
    if (osintNew.length >= 5) {
      return {
        shouldAlert: true, tier: 'PRIORITY', confidence: 'MEDIUM',
        headline: `OSINT Surge: ${osintNew.length} New Urgent Posts`,
        reason: `${osintNew.length} new urgent OSINT signals detected. Elevated conflict reporting tempo.`,
        actionable: 'Review OSINT stream for pattern. Cross-check with satellite and ACLED data.',
        signals: osintNew.map(s => (s.text || '').substring(0, 40)).slice(0, 3),
        crossCorrelation: 'telegram OSINT',
      };
    }

    // ROUTINE: any critical signal OR ≥3 high signals
    if (criticals.length >= 1 || highs.length >= 3) {
      const topSignal = criticals[0] || highs[0];
      return {
        shouldAlert: true, tier: 'ROUTINE', confidence: 'LOW',
        headline: topSignal.label || topSignal.reason || 'Signal Change Detected',
        reason: `${criticals.length} critical, ${highs.length} high-severity signals. ${delta.summary.direction} bias.`,
        actionable: 'Monitor',
        signals: [...criticals, ...highs].map(s => s.label || s.key).slice(0, 4),
        crossCorrelation: 'single-domain',
      };
    }

    // No alert
    return {
      shouldAlert: false,
      reason: `${signals.length} signals, but none meet alert threshold (${criticals.length} critical, ${highs.length} high).`,
    };
  }

  // ─── Two-Way Bot Commands ───────────────────────────────────────────────

  /**
   * Register command handlers that the bot can respond to.
   * @param {string} command - e.g. '/status'
   * @param {Function} handler - async (args, messageId) => responseText
   */
  onCommand(command, handler) {
    this._commandHandlers[command.toLowerCase()] = handler;
  }

  /**
   * Start polling for incoming messages/commands.
   * Call this once during server startup.
   * @param {number} intervalMs - polling interval (default 5000ms)
   */
  startPolling(intervalMs = 5000) {
    if (!this.isConfigured) return;
    if (this._pollingInterval) return; // Already polling

    console.log('[Telegram] Bot command polling started');
    this._initializeBotCommands().catch((err) => {
      console.error('[Telegram] Command initialization failed:', err.message);
    });
    this._pollingInterval = setInterval(() => this._pollUpdates(), intervalMs);
    // Initial poll
    this._pollUpdates();
  }

  /**
   * Stop polling for incoming messages.
   */
  stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
      console.log('[Telegram] Bot command polling stopped');
    }
  }

  async _pollUpdates() {
    try {
      const params = new URLSearchParams({
        offset: String(this._lastUpdateId + 1),
        timeout: '0',
        limit: '10',
        allowed_updates: JSON.stringify(['message']),
      });

      const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/getUpdates?${params}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return;

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.result)) return;

      for (const update of data.result) {
        this._lastUpdateId = Math.max(this._lastUpdateId, update.update_id);
        const msg = update.message;
        if (!msg?.text) continue;

        const chatType = msg.chat?.type;
        const chatId = String(msg.chat?.id);
        // Commands can come from private chats or the configured chat/group.
        if (chatType !== 'private' && chatId !== String(this.chatId)) continue;

        await this._handleMessage(msg);
      }
    } catch (err) {
      // Silent — polling failures are non-fatal
      if (!err.message?.includes('aborted')) {
        console.error('[Telegram] Poll error:', err.message);
      }
    }
  }

  async _handleMessage(msg) {
    const text = msg.text.trim();
    const parts = text.split(/\s+/);
    const rawCommand = parts[0].toLowerCase();
    const command = this._normalizeCommand(rawCommand);
    if (!command) return;
    const args = parts.slice(1).join(' ');
    const replyChatId = msg.chat?.id;

    // Built-in commands
    if (command === '/help') {
      const helpText = Object.entries(COMMANDS)
        .map(([cmd, desc]) => `${cmd} — ${desc}`)
        .join('\n');
      await this.sendMessage(
        `🤖 *CRUCIX BOT COMMANDS*\n\n${helpText}\n\n_Tip: Commands are case-insensitive_`,
        { chatId: replyChatId, replyToMessageId: msg.message_id }
      );
      return;
    }

    if (command === '/mute') {
      const hours = parseFloat(args) || 1;
      this._muteUntil = Date.now() + hours * 60 * 60 * 1000;
      await this.sendMessage(
        `🔇 Alerts muted for ${hours}h — until ${new Date(this._muteUntil).toLocaleTimeString()} UTC\nUse /unmute to resume.`,
        { chatId: replyChatId, replyToMessageId: msg.message_id }
      );
      return;
    }

    if (command === '/unmute') {
      this._muteUntil = null;
      await this.sendMessage(
        `🔔 Alerts resumed. You'll receive the next signal evaluation.`,
        { chatId: replyChatId, replyToMessageId: msg.message_id }
      );
      return;
    }

    if (command === '/alerts') {
      const recent = this._alertHistory.slice(-10);
      if (recent.length === 0) {
        await this.sendMessage('No recent alerts.', { chatId: replyChatId, replyToMessageId: msg.message_id });
        return;
      }
      const lines = recent.map(a =>
        `${TIER_CONFIG[a.tier]?.emoji || '⚪'} ${a.tier} — ${new Date(a.timestamp).toLocaleTimeString()}`
      );
      await this.sendMessage(
        `📋 *Recent Alerts (last ${recent.length})*\n\n${lines.join('\n')}`,
        { chatId: replyChatId, replyToMessageId: msg.message_id }
      );
      return;
    }

    // Delegate to registered handlers
    const handler = this._commandHandlers[command];
    if (handler) {
      try {
        const response = await handler(args, msg.message_id);
        if (response) {
          await this.sendMessage(response, { chatId: replyChatId, replyToMessageId: msg.message_id });
        }
      } catch (err) {
        console.error(`[Telegram] Command ${command} error:`, err.message);
        await this.sendMessage(
          `❌ Command failed: ${err.message}`,
          { chatId: replyChatId, replyToMessageId: msg.message_id }
        );
      }
    }
    // Unknown commands are silently ignored to avoid spamming
  }

  async _initializeBotCommands() {
    await this._loadBotIdentity();

    const botCommands = Object.entries(COMMANDS).map(([command, description]) => ({
      command: command.replace('/', ''),
      description: description.substring(0, 256),
    }));

    // Register globally, then force explicit private/group scopes.
    await this._setMyCommands(botCommands);
    await this._setMyCommands(botCommands, { type: 'all_private_chats' });
    await this._setMyCommands(botCommands, { type: 'all_group_chats' });
  }

  async _loadBotIdentity() {
    const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`getMe failed (${res.status}): ${err.substring(0, 200)}`);
    }
    const data = await res.json();
    if (!data.ok || !data.result?.username) {
      throw new Error('getMe returned invalid bot profile');
    }
    this._botUsername = String(data.result.username).toLowerCase();
  }

  async _setMyCommands(commands, scope = null) {
    const body = { commands };
    if (scope) body.scope = scope;

    const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`setMyCommands failed (${res.status}): ${err.substring(0, 200)}`);
    }
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`setMyCommands rejected: ${JSON.stringify(data).substring(0, 200)}`);
    }
  }

  _normalizeCommand(rawCommand) {
    if (!rawCommand.startsWith('/')) return null;

    const atIdx = rawCommand.indexOf('@');
    if (atIdx === -1) return rawCommand;

    const command = rawCommand.substring(0, atIdx);
    const mentionedBot = rawCommand.substring(atIdx + 1).toLowerCase();
    if (!this._botUsername || mentionedBot === this._botUsername) return command;
    return null;
  }

  // ─── Semantic Dedup ─────────────────────────────────────────────────────

  /**
   * Generate a content-based hash for a signal to detect near-duplicates.
   * Uses normalized text + key metrics rather than raw text prefix matching.
   */
  _contentHash(signal) {
    // Normalize: lowercase, strip numbers that change frequently (timestamps, exact values)
    let content = '';
    if (signal.text) {
      content = signal.text.toLowerCase()
        .replace(/\d{1,2}:\d{2}/g, '')       // strip times
        .replace(/\d+\.\d+%?/g, 'NUM')       // normalize numbers
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 120);
    } else if (signal.label) {
      // For metric signals, hash the label + direction (not exact values)
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

    // Consider duplicate if seen within last 4 hours
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    return new Date(lastSeen).getTime() > fourHoursAgo;
  }

  _recordContentHash(signal) {
    const hash = this._contentHash(signal);
    this._contentHashes[hash] = new Date().toISOString();

    // Prune hashes older than 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [h, ts] of Object.entries(this._contentHashes)) {
      if (new Date(ts).getTime() < cutoff) delete this._contentHashes[h];
    }
  }

  _signalKey(signal) {
    // Improved key generation — use content hash for text signals, structured key for metrics
    if (signal.text) return `tg:${this._contentHash(signal)}`;
    return signal.key || signal.label || JSON.stringify(signal).substring(0, 60);
  }

  // ─── Rate Limiting ──────────────────────────────────────────────────────

  _checkRateLimit(tier) {
    const config = TIER_CONFIG[tier];
    if (!config) return true;

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Check cooldown since last alert of same or lower tier
    const lastSameTier = this._alertHistory
      .filter(a => a.tier === tier)
      .pop();
    if (lastSameTier && (now - lastSameTier.timestamp) < config.cooldownMs) {
      return false;
    }

    // Check hourly cap
    const recentCount = this._alertHistory
      .filter(a => a.tier === tier && a.timestamp > oneHourAgo)
      .length;
    if (recentCount >= config.maxPerHour) {
      return false;
    }

    return true;
  }

  _recordAlert(tier) {
    this._alertHistory.push({ tier, timestamp: Date.now() });
    // Keep only last 50 alerts
    if (this._alertHistory.length > 50) {
      this._alertHistory = this._alertHistory.slice(-50);
    }
  }

  _isMuted() {
    if (!this._muteUntil) return false;
    if (Date.now() > this._muteUntil) {
      this._muteUntil = null;
      return false;
    }
    return true;
  }

  // ─── Prompt Engineering ─────────────────────────────────────────────────

  _buildEvaluationPrompt() {
    return `You are Crucix, an elite intelligence alert evaluator for a personal OSINT monitoring system. You analyze signal deltas from a 25-source intelligence sweep and decide if the user needs to be alerted via Telegram.

## Your Decision Framework

You must classify each evaluation into one of four outcomes:

### NO ALERT — suppress if:
- Routine scheduled data (NFP, CPI, FOMC minutes on expected dates) UNLESS the deviation from consensus is extreme (>2σ)
- Continuation of existing trends already flagged in prior sweeps
- Low-confidence signals from single sources without corroboration
- Social media noise without hard-data confirmation (Telegram chatter alone is NOT enough)

### 🔴 FLASH — immediate, life-of-portfolio risk:
- Active military escalation between nuclear powers or NATO-involved states
- Flash crash indicators (VIX spike >40%, major index down >3% intraday)
- Central bank emergency action (unscheduled rate decision, emergency lending facility)
- Nuclear/radiological anomaly confirmed by multiple monitors
- Sanctions against major economy announced without warning
FLASH requires: ≥2 corroborating sources across different domains (e.g. OSINT + market data + satellite)

### 🟡 PRIORITY — act within hours:
- Significant market dislocation (VIX >25 AND credit spreads widening)
- Geopolitical escalation with clear energy/commodity transmission (conflict + oil move >3%)
- Unexpected economic data (>1.5σ miss on major indicator)
- New conflict front or ceasefire collapse confirmed by ACLED + Telegram
PRIORITY requires: ≥2 signals moving in same direction, at least 1 from hard data

### 🔵 ROUTINE — informational, no urgency:
- Notable trend shifts or reversals worth tracking
- Single-source signals of moderate importance
- Cumulative drift (multiple small moves in same direction over several sweeps)

## Output Format

Respond with ONLY valid JSON:
{
  "shouldAlert": true/false,
  "tier": "FLASH" | "PRIORITY" | "ROUTINE",
  "headline": "10-word max headline",
  "reason": "2-3 sentences. What happened, why it matters, what to watch next.",
  "actionable": "Specific action the user could take (or 'Monitor' if just informational)",
  "signals": ["signal1", "signal2"],
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "crossCorrelation": "Which domains are confirming each other (e.g. 'conflict + energy + satellite')"
}`;
  }

  _buildSignalContext(signals, delta) {
    const sections = [];

    // Categorize signals
    const marketSignals = signals.filter(s => ['vix', 'hy_spread', 'wti', 'brent', 'natgas', '10y2y', 'fed_funds', '10y_yield', 'usd_index'].includes(s.key));
    const osintSignals = signals.filter(s => s.key === 'tg_urgent' || s.item?.channel);
    const conflictSignals = signals.filter(s => ['conflict_events', 'conflict_fatalities', 'thermal_total'].includes(s.key));
    const otherSignals = signals.filter(s => !marketSignals.includes(s) && !osintSignals.includes(s) && !conflictSignals.includes(s));

    if (marketSignals.length > 0) {
      sections.push('📊 MARKET SIGNALS:\n' + marketSignals.map(s =>
        `  ${s.label}: ${s.from} → ${s.to} (${s.pctChange > 0 ? '+' : ''}${s.pctChange?.toFixed(1) || s.change}${s.pctChange !== undefined ? '%' : ''})`
      ).join('\n'));
    }

    if (osintSignals.length > 0) {
      sections.push('📡 OSINT SIGNALS:\n' + osintSignals.map(s => {
        const post = s.item || s;
        return `  [${post.channel || 'UNKNOWN'}] ${(post.text || s.reason || '').substring(0, 150)}`;
      }).join('\n'));
    }

    if (conflictSignals.length > 0) {
      sections.push('⚔️ CONFLICT INDICATORS:\n' + conflictSignals.map(s =>
        `  ${s.label}: ${s.from} → ${s.to} (${s.direction})`
      ).join('\n'));
    }

    if (otherSignals.length > 0) {
      sections.push('📌 OTHER:\n' + otherSignals.map(s =>
        `  ${s.label || s.key || s.reason}: ${s.from !== undefined ? `${s.from} → ${s.to}` : 'new signal'}`
      ).join('\n'));
    }

    sections.push(`\n📈 SWEEP DELTA: direction=${delta.summary.direction}, total=${delta.summary.totalChanges}, critical=${delta.summary.criticalChanges}`);

    return sections.join('\n\n');
  }

  // ─── Message Formatting ─────────────────────────────────────────────────

  _formatTieredAlert(evaluation, delta, tier) {
    const tc = TIER_CONFIG[tier];
    const confidenceEmoji = { HIGH: '🟢', MEDIUM: '🟡', LOW: '⚪' }[evaluation.confidence] || '⚪';

    const lines = [
      `${tc.emoji} *CRUCIX ${tc.label}*`,
      ``,
      `*${evaluation.headline}*`,
      ``,
      evaluation.reason,
      ``,
      `Confidence: ${confidenceEmoji} ${evaluation.confidence || 'MEDIUM'}`,
      `Direction: ${delta.summary.direction.toUpperCase()}`,
    ];

    if (evaluation.crossCorrelation) {
      lines.push(`Cross-correlation: ${evaluation.crossCorrelation}`);
    }

    if (evaluation.actionable && evaluation.actionable !== 'Monitor') {
      lines.push(``, `💡 *Action:* ${evaluation.actionable}`);
    }

    if (evaluation.signals?.length) {
      lines.push('', `Signals: ${evaluation.signals.join(' · ')}`);
    }

    lines.push('', `_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_`);

    return lines.join('\n');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* give up */ }
    }
    return null;
  }
}
