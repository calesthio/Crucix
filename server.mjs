#!/usr/bin/env node
// Crucix Intelligence Engine — Dev Server
// Serves the Jarvis dashboard, runs sweep cycle, pushes live updates via SSE

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import config from './crucix.config.mjs';
import { getLocale, currentLanguage, getSupportedLocales } from './lib/i18n.mjs';
import { fullBriefing } from './apis/briefing.mjs';
import { synthesize, generateIdeas } from './dashboard/inject.mjs';
import { MemoryManager } from './lib/delta/index.mjs';
import { createLLMProvider } from './lib/llm/index.mjs';
import { generateLLMIdeas } from './lib/llm/ideas.mjs';
import { TelegramAlerter } from './lib/alerts/telegram.mjs';
import { DiscordAlerter } from './lib/alerts/discord.mjs';
import { buildSixHourBaseline } from './lib/baseline-sixhour.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const RUNS_DIR = join(ROOT, 'runs');
const MEMORY_DIR = join(RUNS_DIR, 'memory');

// Ensure directories exist
for (const dir of [RUNS_DIR, MEMORY_DIR, join(MEMORY_DIR, 'cold')]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// === State ===
let currentData = null;    // Current synthesized dashboard data
let lastSweepTime = null;  // Timestamp of last sweep
let sweepStartedAt = null; // Timestamp when current/last sweep started
let sweepInProgress = false;
const startTime = Date.now();
const sseClients = new Set();
const selectionMemory = new Map();
const selectionMemoryTelemetry = {
  ttlExpired: 0,
  capacityEvicted: 0,
  manualCleared: 0,
  touchHits: 0,
  misses: 0,
};
const SELECTION_MEMORY_TTL_MS = 10 * 60 * 1000;
const SELECTION_MEMORY_MAX_ENTRIES = 100;

function signalId(kind = 'signal', item = {}, index = 0) {
  const raw = `${kind}:${item.signal || item.category || 'item'}:${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return raw || `${kind}-${index}`;
}

function attachSignalIds(kind = 'signal', list = []) {
  return list.map((item, index) => ({ ...item, id: item.id || signalId(kind, item, index) }));
}

function formatSignalTrustLabel(item = {}) {
  const labels = [];
  if (item.sourceHealth) labels.push(item.sourceHealth);
  if (item.evidenceSource) labels.push(item.evidenceSource);
  return labels.length ? ` {${labels.join(' · ')}}` : '';
}

function trustPhrase(item = {}) {
  const sourceHealth = item.sourceHealth || 'unknown';
  const evidenceSource = item.evidenceSource || 'mixed';
  return `${sourceHealth} via ${evidenceSource}`;
}

function touchSelection(contextKey = '', remembered = null) {
  if (!contextKey || !remembered) return remembered;
  const touched = {
    ...remembered,
    lastAccessAt: Date.now(),
  };
  selectionMemory.delete(contextKey);
  selectionMemory.set(contextKey, touched);
  selectionMemoryTelemetry.touchHits += 1;
  return touched;
}

function pruneSelectionMemory() {
  const now = Date.now();
  let pruned = 0;
  for (const [key, value] of selectionMemory.entries()) {
    if (!value || value.expiresAt <= now) {
      selectionMemory.delete(key);
      selectionMemoryTelemetry.ttlExpired += 1;
      pruned += 1;
    }
  }
  while (selectionMemory.size > SELECTION_MEMORY_MAX_ENTRIES) {
    const lruKey = selectionMemory.keys().next().value;
    if (!lruKey) break;
    selectionMemory.delete(lruKey);
    selectionMemoryTelemetry.capacityEvicted += 1;
    pruned += 1;
  }
  return pruned;
}

function selectionMemoryStats() {
  pruneSelectionMemory();
  let nextExpiry = null;
  for (const value of selectionMemory.values()) {
    if (!nextExpiry || value.expiresAt < nextExpiry) nextExpiry = value.expiresAt;
  }
  const oldestKey = selectionMemory.keys().next().value || null;
  const newestKey = selectionMemory.size ? Array.from(selectionMemory.keys()).at(-1) : null;
  return {
    activeContexts: selectionMemory.size,
    maxEntries: SELECTION_MEMORY_MAX_ENTRIES,
    ttlMs: SELECTION_MEMORY_TTL_MS,
    nextExpiry: nextExpiry ? new Date(nextExpiry).toISOString() : null,
    oldestContext: oldestKey,
    newestContext: newestKey,
    telemetry: { ...selectionMemoryTelemetry },
  };
}

function rememberSelection(contextKey = '', selection = null) {
  if (!contextKey || !selection?.id) return;
  pruneSelectionMemory();
  selectionMemory.delete(contextKey);
  selectionMemory.set(contextKey, {
    ...selection,
    expiresAt: Date.now() + SELECTION_MEMORY_TTL_MS,
    lastAccessAt: Date.now(),
  });
  pruneSelectionMemory();
}

function recallSelection(contextKey = '') {
  if (!contextKey) return null;
  const remembered = selectionMemory.get(contextKey);
  if (!remembered) {
    selectionMemoryTelemetry.misses += 1;
    return null;
  }
  if (remembered.expiresAt <= Date.now()) {
    selectionMemory.delete(contextKey);
    selectionMemoryTelemetry.ttlExpired += 1;
    selectionMemoryTelemetry.misses += 1;
    return null;
  }
  return touchSelection(contextKey, remembered);
}

function clearSelection(contextKey = '') {
  if (!contextKey) return false;
  pruneSelectionMemory();
  const cleared = selectionMemory.delete(contextKey);
  if (cleared) selectionMemoryTelemetry.manualCleared += 1;
  return cleared;
}

function selectionMeta(contextKey = '') {
  pruneSelectionMemory();
  const remembered = recallSelection(contextKey);
  if (!remembered) return null;
  return {
    kind: remembered.kind,
    index: remembered.index,
    id: remembered.id,
    expiresAt: new Date(remembered.expiresAt).toISOString(),
    lastAccessAt: remembered.lastAccessAt ? new Date(remembered.lastAccessAt).toISOString() : null,
    ttlMs: Math.max(0, remembered.expiresAt - Date.now()),
  };
}

function getSignalList(snapshot = {}, kind = 'corroborated') {
  return attachSignalIds(
    kind,
    kind === 'suspect' ? (snapshot.suspectSignals || []) : (snapshot.corroboratedSignals || [])
  );
}

function resolveSignalRef(snapshot = {}, ref = '', preferredKind = 'corroborated', contextKey = '') {
  const normalized = String(ref || '').trim().toLowerCase();
  const corroborated = getSignalList(snapshot, 'corroborated');
  const suspects = getSignalList(snapshot, 'suspect');
  const combined = [...corroborated, ...suspects];

  if (!normalized) return { kind: preferredKind, index: 0, id: null };
  if (normalized === 'top-suspect' || normalized === 'suspect-one' || normalized === 'the-suspect-one') {
    return { kind: 'suspect', index: 0, id: suspects[0]?.id || null };
  }
  if (normalized === 'top-corroborated' || normalized === 'corroborated-one' || normalized === 'the-corroborated-one') {
    return { kind: 'corroborated', index: 0, id: corroborated[0]?.id || null };
  }
  if (normalized === 'that-one' || normalized === 'top-one') {
    const remembered = recallSelection(contextKey);
    if (remembered?.id) return { kind: remembered.kind || preferredKind, index: remembered.index || 0, id: remembered.id };
    return { kind: preferredKind, index: 0, id: getSignalList(snapshot, preferredKind)[0]?.id || null };
  }
  const itemMatch = normalized.match(/^item-(\d+)$/);
  if (itemMatch) {
    const n = Math.max(0, Number.parseInt(itemMatch[1], 10) - 1);
    const list = getSignalList(snapshot, preferredKind);
    return { kind: preferredKind, index: n, id: list[n]?.id || null };
  }
  const direct = combined.find(item => item.id === normalized);
  if (direct) {
    return {
      kind: suspects.some(item => item.id === normalized) ? 'suspect' : 'corroborated',
      index: 0,
      id: direct.id,
    };
  }
  return { kind: preferredKind, index: 0, id: null };
}

function getSignalSelection(snapshot = {}, kind = 'corroborated', index = 0, id = null) {
  const list = getSignalList(snapshot, kind);
  if (id) return list.find(item => item.id === id) || null;
  return list[index] || null;
}

function buildIMessengerDrilldown(snapshot = {}, { kind = 'corroborated', action = 'why', index = 0, id = null } = {}) {
  const item = getSignalSelection(snapshot, kind, index, id);
  if (!item) return `No ${kind} signal available.`;

  if (action === 'sources') {
    return [
      `${item.signal}`,
      `Sources: ${item.evidenceSource || 'mixed'}`,
      `Trust: ${item.sourceHealth || 'unknown'}`,
      item.freshestTs ? `Freshest evidence: ${item.freshestTs}` : null,
    ].filter(Boolean).join('\n');
  }

  if (action === 'expand') {
    return [
      `${item.signal} (${item.confidence})`,
      `Trust: ${trustPhrase(item)}`,
      `Why it matters: ${item.reason || 'No explanation available.'}`,
      item.region ? `Region: ${item.region}` : null,
      item.urgentPosts != null ? `Urgent posts: ${item.urgentPosts}` : null,
      item.airTotal != null ? `Air activity: ${item.airTotal}` : null,
      item.cpm != null ? `CPM: ${item.cpm}` : null,
      item.readings != null ? `Readings: ${item.readings}` : null,
    ].filter(Boolean).join('\n');
  }

  return [
    `${item.signal}`,
    `Why: ${item.reason || 'No explanation available.'}`,
    `Trust: ${trustPhrase(item)}`,
  ].join('\n');
}

function buildIMessengerBrief(snapshot = {}) {
  const lines = [];
  const evidence = snapshot.evidenceSummary || {};
  const counts = evidence.counts || {};
  const corroborated = attachSignalIds('corroborated', snapshot.corroboratedSignals || []);
  const suspects = attachSignalIds('suspect', snapshot.suspectSignals || []);
  const topCorroborated = corroborated[0] || null;
  const topSuspect = suspects[0] || null;
  const tgUrgent = snapshot.tg?.urgent || [];

  if (evidence.headline) {
    lines.push(`Evidence: ${evidence.headline}`);
    lines.push(`Fresh ${counts.fresh || 0}, aging ${counts.aging || 0}, stale ${counts.stale || 0}, carried ${counts.carriedForward || 0}, failed ${counts.failedSources || 0}`);
  }

  if (topCorroborated) {
    lines.push(`Top corroborated [${topCorroborated.id}]: ${topCorroborated.signal} (${topCorroborated.confidence}, ${trustPhrase(topCorroborated)})`);
  }

  if (topSuspect) {
    lines.push(`Top suspect [${topSuspect.id}]: ${topSuspect.signal} (${topSuspect.confidence}, ${trustPhrase(topSuspect)})`);
  }

  if (tgUrgent.length) {
    lines.push(`OSINT urgent: ${tgUrgent.length} items`);
  }

  return lines.join('\n');
}

function buildBriefSections(snapshot = {}, { markdown = false } = {}) {
  const tg = snapshot.tg || {};
  const energy = snapshot.energy || {};
  const metals = snapshot.metals || {};
  const delta = memory.getLastDelta();
  const ideas = (snapshot.ideas || []).slice(0, 3);
  const sections = [
    markdown ? `**📋 CRUCIX BRIEF**\n_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_\n`
             : `📋 *CRUCIX BRIEF*\n_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_\n`
  ];

  if (snapshot.evidenceSummary?.headline) {
    const counts = snapshot.evidenceSummary.counts || {};
    sections.push(`🧾 Evidence: ${snapshot.evidenceSummary.headline}`);
    sections.push(`   Fresh: ${counts.fresh || 0} | Aging: ${counts.aging || 0} | Stale: ${counts.stale || 0} | Carried: ${counts.carriedForward || 0} | Failed sources: ${counts.failedSources || 0}`);
    sections.push('');
  }

  if (delta?.summary) {
    const dirEmoji = { 'risk-off': '📉', 'risk-on': '📈', 'mixed': '↔️' }[delta.summary.direction] || '↔️';
    sections.push(`${dirEmoji} Direction: ${markdown ? `**${delta.summary.direction.toUpperCase()}**` : `*${delta.summary.direction.toUpperCase()}*`} | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
    sections.push('');
  }

  const vix = snapshot.fred?.find(f => f.id === 'VIXCLS');
  const hy = snapshot.fred?.find(f => f.id === 'BAMLH0A0HYM2');
  if (vix || energy.wti || metals.gold || metals.silver) {
    sections.push(`📊 VIX: ${vix?.value || '--'} | WTI: $${energy.wti || '--'} | Brent: $${energy.brent || '--'}`);
    sections.push(`   Gold: $${metals.gold || '--'} | Silver: $${metals.silver || '--'}${hy ? ` | HY Spread: ${hy.value}` : ''}`);
    sections.push(`   NatGas: $${energy.natgas || '--'}`);
    sections.push('');
  }

  if (tg.urgent?.length > 0) {
    sections.push(`📡 OSINT: ${tg.urgent.length} urgent signals, ${tg.posts || 0} total posts`);
    for (const p of tg.urgent.slice(0, 2)) sections.push(`  • ${(p.text || '').substring(0, 80)}`);
    sections.push('');
  }

  if (snapshot.corroboratedSignals?.length) {
    sections.push(`✅ Corroborated signals:`);
    for (const item of snapshot.corroboratedSignals.slice(0, 3)) {
      sections.push(`  • ${item.signal} [${item.confidence}]${formatSignalTrustLabel(item)} ${item.reason.substring(0, 90)}`);
    }
    sections.push('');
  }

  if (snapshot.suspectSignals?.length) {
    sections.push(`⚠️ Suspect signals:`);
    for (const item of snapshot.suspectSignals.slice(0, 3)) {
      sections.push(`  • ${item.signal} [${item.confidence}]${formatSignalTrustLabel(item)} ${item.reason.substring(0, 90)}`);
    }
    sections.push('');
  }

  if (ideas.length > 0) {
    sections.push(markdown ? `**💡 Top Ideas:**` : `💡 *Top Ideas:*`);
    for (const idea of ideas) sections.push(`  ${idea.type === 'long' ? '📈' : idea.type === 'hedge' ? '🛡️' : '👁️'} ${idea.title}`);
  }

  return sections.join('\n');
}

// === Delta/Memory ===
const memory = new MemoryManager(RUNS_DIR);

// === LLM + Telegram + Discord ===
const llmProvider = createLLMProvider(config.llm);
const telegramAlerter = new TelegramAlerter(config.telegram);
const discordAlerter = new DiscordAlerter(config.discord || {});

if (llmProvider) console.log(`[Crucix] LLM enabled: ${llmProvider.name} (${llmProvider.model})`);
if (telegramAlerter.isConfigured) {
  console.log('[Crucix] Telegram alerts enabled');

  // ─── Two-Way Bot Commands ───────────────────────────────────────────────

  telegramAlerter.onCommand('/status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `🖥️ *CRUCIX STATUS*`,
      ``,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: http://localhost:${config.port}`,
    ].join('\n');
  });

  telegramAlerter.onCommand('/sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    // Fire and forget — don't block the bot response
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  telegramAlerter.onCommand('/brief', async () => {
    if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';
    return buildBriefSections(currentData, { markdown: false });
  });

  telegramAlerter.onCommand('/portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start polling for bot commands
  telegramAlerter.startPolling(config.telegram.botPollingInterval);
}

// === Discord Bot ===
if (discordAlerter.isConfigured) {
  console.log('[Crucix] Discord bot enabled');

  // Reuse the same command handlers as Telegram (DRY)
  discordAlerter.onCommand('status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `**🖥️ CRUCIX STATUS**\n`,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: http://localhost:${config.port}`,
    ].join('\n');
  });

  discordAlerter.onCommand('sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  discordAlerter.onCommand('brief', async () => {
    if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';
    return buildBriefSections(currentData, { markdown: true });
  });

  discordAlerter.onCommand('portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start the Discord bot (non-blocking — connection happens async)
  discordAlerter.start().catch(err => {
    console.error('[Crucix] Discord bot startup failed (non-fatal):', err.message);
  });
}

// === Express Server ===
const app = express();
app.use(express.static(join(ROOT, 'dashboard/public')));

// Serve loading page until first sweep completes, then the dashboard with injected locale
app.get('/', (req, res) => {
  if (!currentData) {
    res.sendFile(join(ROOT, 'dashboard/public/loading.html'));
  } else {
    const htmlPath = join(ROOT, 'dashboard/public/jarvis.html');
    let html = readFileSync(htmlPath, 'utf-8');
    
    // Inject locale data into the HTML
    const locale = getLocale();
    const localeScript = `<script>window.__CRUCIX_LOCALE__ = ${JSON.stringify(locale).replace(/<\/script>/gi, '<\\/script>')};</script>`;
    const runtimeScript = `<script>window.__CRUCIX_RUNTIME__ = ${JSON.stringify({ refreshIntervalMinutes: config.refreshIntervalMinutes }).replace(/<\/script>/gi, '<\\/script>')};</script>`;
    html = html.replace('</head>', `${localeScript}\n${runtimeScript}\n</head>`);
    
    res.type('html').send(html);
  }
});

// API: current data
app.get('/api/data', (req, res) => {
  if (!currentData) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  res.json(currentData);
});

app.get('/api/brief/compact', (req, res) => {
  if (!currentData) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const corroborated = attachSignalIds('corroborated', currentData.corroboratedSignals || []);
  const suspects = attachSignalIds('suspect', currentData.suspectSignals || []);
  res.json({
    text: buildIMessengerBrief(currentData),
    evidenceSummary: currentData.evidenceSummary || null,
    topCorroborated: corroborated[0] || null,
    topSuspect: suspects[0] || null,
    corroboratedSignals: corroborated.slice(0, 5),
    suspectSignals: suspects.slice(0, 5),
  });
});

app.get('/api/brief/drilldown', (req, res) => {
  if (!currentData) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  const requestedKind = req.query.kind === 'suspect' ? 'suspect' : 'corroborated';
  const action = ['why', 'sources', 'expand'].includes(req.query.action) ? req.query.action : 'why';
  const index = Math.max(0, Number.parseInt(req.query.index, 10) || 0);
  const id = typeof req.query.id === 'string' && req.query.id.trim() ? req.query.id.trim() : null;
  const ref = typeof req.query.ref === 'string' && req.query.ref.trim() ? req.query.ref.trim() : null;
  const contextKey = typeof req.query.context === 'string' && req.query.context.trim() ? req.query.context.trim() : '';
  const memoryBefore = contextKey ? selectionMeta(contextKey) : null;
  const resolved = ref ? resolveSignalRef(currentData, ref, requestedKind, contextKey) : { kind: requestedKind, index, id };
  const finalKind = resolved.kind || requestedKind;
  const finalIndex = resolved.index ?? index;
  const finalId = resolved.id ?? id;
  const item = getSignalSelection(currentData, finalKind, finalIndex, finalId);
  const usedRememberedSelection = Boolean(ref && contextKey && memoryBefore?.id && item?.id === memoryBefore.id && ['that-one', 'top-one'].includes(String(ref).trim().toLowerCase()));
  if (item && contextKey) rememberSelection(contextKey, { kind: finalKind, index: finalIndex, id: item.id });
  res.json({
    kind: finalKind,
    action,
    index: finalIndex,
    id: item?.id || finalId,
    ref,
    context: contextKey || null,
    contextMemory: contextKey ? {
      usedRememberedSelection,
      before: memoryBefore,
      after: selectionMeta(contextKey),
    } : null,
    text: buildIMessengerDrilldown(currentData, { kind: finalKind, action, index: finalIndex, id: item?.id || finalId }),
    item,
  });
});

app.get('/api/brief/context', (req, res) => {
  const contextKey = typeof req.query.context === 'string' && req.query.context.trim() ? req.query.context.trim() : '';
  if (!contextKey) return res.status(400).json({ error: 'context query parameter is required' });
  res.json({
    context: contextKey,
    selection: selectionMeta(contextKey),
    memory: selectionMemoryStats(),
  });
});

app.get('/api/brief/context/health', (req, res) => {
  res.json({
    memory: selectionMemoryStats(),
  });
});

app.delete('/api/brief/context', (req, res) => {
  const contextKey = typeof req.query.context === 'string' && req.query.context.trim() ? req.query.context.trim() : '';
  if (!contextKey) return res.status(400).json({ error: 'context query parameter is required' });
  const existed = clearSelection(contextKey);
  res.json({
    context: contextKey,
    cleared: existed,
    selection: selectionMeta(contextKey),
  });
});

// API: health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    lastSweep: lastSweepTime,
    nextSweep: lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
      : null,
    sweepInProgress,
    sweepStartedAt,
    sourcesOk: currentData?.meta?.sourcesOk || 0,
    sourcesFailed: currentData?.meta?.sourcesFailed || 0,
    sourceHealthSummary: currentData?.healthSummary || null,
    llmEnabled: !!config.llm.provider,
    llmProvider: config.llm.provider,
    telegramEnabled: !!(config.telegram.botToken && config.telegram.chatId),
    refreshIntervalMinutes: config.refreshIntervalMinutes,
    language: currentLanguage,
    selectionMemory: selectionMemoryStats(),
  });
});

// API: available locales
app.get('/api/locales', (req, res) => {
  res.json({
    current: currentLanguage,
    supported: getSupportedLocales(),
  });
});

// SSE: live updates
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

async function enrichIdeasAndPublish(synthesized, delta) {
  if (!llmProvider?.isConfigured) {
    synthesized.ideas = [];
    synthesized.ideasSource = 'disabled';
    return synthesized;
  }

  try {
    console.log('[Crucix] Generating LLM trade ideas...');
    const previousIdeas = memory.getLastRun()?.ideas || [];
    const llmIdeas = await generateLLMIdeas(llmProvider, synthesized, delta, previousIdeas);
    synthesized.ideas = llmIdeas || [];
    synthesized.ideasSource = llmIdeas ? 'llm' : 'llm-failed';
    console.log(`[Crucix] LLM ideas ready: ${synthesized.ideas.length} (${synthesized.ideasSource})`);
  } catch (llmErr) {
    console.error('[Crucix] LLM ideas failed (non-fatal):', llmErr.message);
    synthesized.ideas = [];
    synthesized.ideasSource = 'llm-failed';
  }

  currentData = synthesized;
  broadcast({ type: 'ideas_update', data: currentData });
  return synthesized;
}

// === Sweep Cycle ===
async function runSweepCycle() {
  if (sweepInProgress) {
    console.log('[Crucix] Sweep already in progress, skipping');
    return;
  }

  sweepInProgress = true;
  sweepStartedAt = new Date().toISOString();
  broadcast({ type: 'sweep_start', timestamp: sweepStartedAt });
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Crucix] Starting sweep at ${new Date().toLocaleTimeString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 1. Run the full briefing sweep
    const rawData = await fullBriefing();

    // 2. Save to runs/latest.json
    writeFileSync(join(RUNS_DIR, 'latest.json'), JSON.stringify(rawData, null, 2));
    lastSweepTime = new Date().toISOString();

    // 3. Synthesize into dashboard format
    console.log('[Crucix] Synthesizing dashboard data...');
    const synthesized = await synthesize(rawData);

    // 4. Delta computation + memory
    const delta = memory.addRun(synthesized);
    synthesized.delta = delta;

    const sixHourBaselineRun = memory.getBaselineRun(6);
    synthesized.baseline6h = buildSixHourBaseline(synthesized, sixHourBaselineRun);

    // 5. Publish core data immediately so LLM idea generation never blocks /api/data
    if (!llmProvider?.isConfigured) {
      synthesized.ideas = [];
      synthesized.ideasSource = 'disabled';
    } else {
      synthesized.ideas = [];
      synthesized.ideasSource = 'pending';
    }

    currentData = synthesized;
    broadcast({ type: 'update', data: currentData });

    // 6. Alert evaluation — Telegram + Discord (LLM with rule-based fallback, multi-tier, semantic dedup)
    if (delta?.summary?.totalChanges > 0) {
      if (telegramAlerter.isConfigured) {
        telegramAlerter.evaluateAndAlert(llmProvider, delta, memory, synthesized).catch(err => {
          console.error('[Crucix] Telegram alert error:', err.message);
        });
      }
      if (discordAlerter.isConfigured) {
        discordAlerter.evaluateAndAlert(llmProvider, delta, memory, synthesized).catch(err => {
          console.error('[Crucix] Discord alert error:', err.message);
        });
      }
    }

    // Prune old alerted signals
    memory.pruneAlertedSignals();

    console.log(`[Crucix] Sweep complete — ${currentData.meta.sourcesOk}/${currentData.meta.sourcesQueried} sources OK`);
    console.log(`[Crucix] ${currentData.ideas.length} ideas (${synthesized.ideasSource}) | ${currentData.news.length} news | ${currentData.newsFeed.length} feed items`);
    if (delta?.summary) console.log(`[Crucix] Delta: ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical, direction: ${delta.summary.direction}`);
    console.log(`[Crucix] Next sweep at ${new Date(Date.now() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()}`);

    if (llmProvider?.isConfigured) {
      enrichIdeasAndPublish(synthesized, delta).catch(err => {
        console.error('[Crucix] Deferred ideas enrichment failed:', err.message);
      });
    }

  } catch (err) {
    console.error('[Crucix] Sweep failed:', err.message);
    broadcast({ type: 'sweep_error', error: err.message });
  } finally {
    sweepInProgress = false;
  }
}

// === Startup ===
async function start() {
  const port = config.port;

  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           CRUCIX INTELLIGENCE ENGINE         ║
  ║          Local Palantir · 26 Sources         ║
  ╠══════════════════════════════════════════════╣
  ║  Dashboard:  http://localhost:${port}${' '.repeat(14 - String(port).length)}║
  ║  Health:     http://localhost:${port}/api/health${' '.repeat(4 - String(port).length)}║
  ║  Refresh:    Every ${config.refreshIntervalMinutes} min${' '.repeat(20 - String(config.refreshIntervalMinutes).length)}║
  ║  LLM:        ${(config.llm.provider || 'disabled').padEnd(31)}║
  ║  Telegram:   ${config.telegram.botToken ? 'enabled' : 'disabled'}${' '.repeat(config.telegram.botToken ? 24 : 23)}║
  ║  Discord:    ${config.discord?.botToken ? 'enabled' : config.discord?.webhookUrl ? 'webhook only' : 'disabled'}${' '.repeat(config.discord?.botToken ? 24 : config.discord?.webhookUrl ? 20 : 23)}║
  ╚══════════════════════════════════════════════╝
  `);

  const server = app.listen(port);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[Crucix] FATAL: Port ${port} is already in use!`);
      console.error(`[Crucix] A previous Crucix instance may still be running.`);
      console.error(`[Crucix] Fix:  taskkill /F /IM node.exe   (Windows)`);
      console.error(`[Crucix]       kill $(lsof -ti:${port})   (macOS/Linux)`);
      console.error(`[Crucix] Or change PORT in .env\n`);
    } else {
      console.error(`[Crucix] Server error:`, err.stack || err.message);
    }
    process.exit(1);
  });

  server.on('listening', async () => {
    console.log(`[Crucix] Server running on http://localhost:${port}`);

    // Auto-open browser
    // NOTE: On Windows, `start` in PowerShell is an alias for Start-Service, not cmd's start.
    // We must use `cmd /c start ""` to ensure it works in both cmd.exe and PowerShell.
    const openCmd = process.platform === 'win32' ? 'cmd /c start ""' :
                    process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${openCmd} "http://localhost:${port}"`, (err) => {
      if (err) console.log('[Crucix] Could not auto-open browser:', err.message);
    });

    // Try to load existing data first for instant display (await so dashboard shows immediately)
    try {
      const existing = JSON.parse(readFileSync(join(RUNS_DIR, 'latest.json'), 'utf8'));
      const data = await synthesize(existing);
      currentData = data;
      console.log('[Crucix] Loaded existing data from runs/latest.json — dashboard ready instantly');
      broadcast({ type: 'update', data: currentData });
    } catch {
      console.log('[Crucix] No existing data found — first sweep required');
    }

    // Run first sweep (refreshes data in background)
    console.log('[Crucix] Running initial sweep...');
    runSweepCycle().catch(err => {
      console.error('[Crucix] Initial sweep failed:', err.message || err);
    });

    // Schedule recurring sweeps
    setInterval(runSweepCycle, config.refreshIntervalMinutes * 60 * 1000);
  });
}

// Graceful error handling — log full stack traces for diagnosis
process.on('unhandledRejection', (err) => {
  console.error('[Crucix] Unhandled rejection:', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[Crucix] Uncaught exception:', err?.stack || err?.message || err);
});

start().catch(err => {
  console.error('[Crucix] FATAL — Server failed to start:', err?.stack || err?.message || err);
  process.exit(1);
});
