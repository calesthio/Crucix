// Bot Commands — one definition shared by every chat platform (Telegram, Discord)
// Each alerter handles transport; this module owns the command list and the reply text.

// Command catalogue. Alerters derive their platform registration from this list.
export const BOT_COMMANDS = [
  { name: 'status',    description: 'System health, last sweep time, source status' },
  { name: 'sweep',     description: 'Trigger a manual sweep cycle' },
  { name: 'brief',     description: 'Compact intelligence summary' },
  { name: 'portfolio', description: 'Portfolio status (if Alpaca connected)' },
  { name: 'alerts',    description: 'Recent alert history' },
  { name: 'mute',      description: 'Mute alerts for N hours (default 1)',
    options: [{ name: 'hours', description: 'Hours to mute (default: 1)', type: 'number', required: false }] },
  { name: 'unmute',    description: 'Resume alerts' },
  { name: 'help',      description: 'Show available commands' },
];

// Inline markup per platform
export const MARKUP = {
  telegram: { bold: s => `*${s}*`, italic: s => `_${s}_` },
  discord:  { bold: s => `**${s}**`, italic: s => `_${s}_` },
};

/**
 * Build the data-driven command handlers (status, sweep, brief, portfolio).
 * Built-ins that touch alerter state (alerts, mute, unmute, help) live in each alerter.
 * @param {object} ctx
 * @param {() => object} ctx.getState - returns { currentData, lastSweepTime, sweepInProgress, sseClientCount }
 * @param {object|null} ctx.llmProvider
 * @param {object} ctx.memory - MemoryManager
 * @param {object} ctx.config - crucix config
 * @param {number} ctx.startTime - server start (ms)
 * @param {() => Promise<void>} ctx.runSweep
 * @param {{ bold: Function, italic: Function }} markup
 * @returns {Record<string, (args: string) => Promise<string>>}
 */
export function createCommandHandlers(ctx, markup) {
  const { bold, italic } = markup;

  return {
    async status() {
      const { currentData, lastSweepTime, sweepInProgress, sseClientCount } = ctx.getState();
      const uptime = Math.floor((Date.now() - ctx.startTime) / 1000);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const sourcesOk = currentData?.meta?.sourcesOk || 0;
      const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
      const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
      const llmStatus = ctx.llmProvider?.isConfigured ? `✅ ${ctx.llmProvider.name}` : '❌ Disabled';
      const nextSweep = lastSweepTime
        ? new Date(new Date(lastSweepTime).getTime() + ctx.config.refreshIntervalMinutes * 60000).toLocaleTimeString()
        : 'pending';

      return [
        bold('🖥️ CRUCIX STATUS'),
        ``,
        `Uptime: ${h}h ${m}m`,
        `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
        `Next sweep: ${nextSweep} UTC`,
        `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
        `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
        `LLM: ${llmStatus}`,
        `SSE clients: ${sseClientCount}`,
        `Dashboard: ${ctx.config.publicUrl || `http://localhost:${ctx.config.port}`}`,
      ].join('\n');
    },

    async sweep() {
      if (ctx.getState().sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
      // Fire and forget — don't block the bot response
      ctx.runSweep().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
      return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
    },

    async brief() {
      const { currentData } = ctx.getState();
      if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';

      const tg = currentData.tg || {};
      const energy = currentData.energy || {};
      const metals = currentData.metals || {};
      const delta = ctx.memory.getLastDelta();
      const ideas = (currentData.ideas || []).slice(0, 3);

      const sections = [
        bold('📋 CRUCIX BRIEF'),
        italic(`${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`),
        ``,
      ];

      // Delta direction
      if (delta?.summary) {
        const dirEmoji = { 'risk-off': '📉', 'risk-on': '📈', 'mixed': '↔️' }[delta.summary.direction] || '↔️';
        sections.push(`${dirEmoji} Direction: ${bold(delta.summary.direction.toUpperCase())} | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
        sections.push('');
      }

      // Key metrics
      const vix = currentData.fred?.find(f => f.id === 'VIXCLS');
      const hy = currentData.fred?.find(f => f.id === 'BAMLH0A0HYM2');
      if (vix || energy.wti || metals.gold || metals.silver) {
        sections.push(`📊 VIX: ${vix?.value || '--'} | WTI: $${energy.wti || '--'} | Brent: $${energy.brent || '--'}`);
        sections.push(`   Gold: $${metals.gold || '--'} | Silver: $${metals.silver || '--'}${hy ? ` | HY Spread: ${hy.value}` : ''}`);
        sections.push(`   NatGas: $${energy.natgas || '--'}`);
        sections.push('');
      }

      // OSINT — top 2 urgent
      if (tg.urgent?.length > 0) {
        sections.push(`📡 OSINT: ${tg.urgent.length} urgent signals, ${tg.posts || 0} total posts`);
        for (const p of tg.urgent.slice(0, 2)) {
          sections.push(`  • ${(p.text || '').substring(0, 80)}`);
        }
        sections.push('');
      }

      // Top ideas
      if (ideas.length > 0) {
        sections.push(bold('💡 Top Ideas:'));
        for (const idea of ideas) {
          sections.push(`  ${idea.type === 'long' ? '📈' : idea.type === 'hedge' ? '🛡️' : '👁️'} ${idea.title}`);
        }
      }

      return sections.join('\n');
    },

    async portfolio() {
      return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
    },
  };
}

/**
 * Register the shared handlers on an alerter.
 * @param {{ onCommand: Function }} alerter
 * @param {string} prefix - '/' for Telegram (commands keyed as '/status'), '' for Discord
 */
export function registerCommandHandlers(alerter, handlers, prefix = '') {
  for (const [name, handler] of Object.entries(handlers)) {
    alerter.onCommand(`${prefix}${name}`, handler);
  }
}
