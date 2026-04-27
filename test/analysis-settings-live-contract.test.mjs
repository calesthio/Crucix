import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE_PORT = 3242;

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function waitFor(url, predicate, timeoutMs = 90000) {
  const started = Date.now();
  let lastError = null;
  while ((Date.now() - started) < timeoutMs) {
    try {
      const json = await fetchJson(url);
      if (!predicate || predicate(json)) return json;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(5000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
}

function writeSettings(root, preferences) {
  const settingsPath = join(root, 'operator-settings.json');
  writeFileSync(settingsPath, JSON.stringify({
    version: 'operator-settings-store-v1',
    updatedAt: new Date().toISOString(),
    preferences,
  }, null, 2));
  return settingsPath;
}

async function withBootedServer({ port, env, preferences }, fn) {
  const root = mkdtempSync(join(tmpdir(), 'crucix-analysis-live-'));
  const settingsPath = writeSettings(root, preferences);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      OPERATOR_SETTINGS_PATH: settingsPath,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    await waitFor(healthUrl, payload => payload?.lifecycle?.phase === 'serving' && payload?.lifecycle?.dataReady === true, 90000);
    return await fn({
      analysisUrl: `http://127.0.0.1:${port}/api/analysis`,
      settingsUrl: `http://127.0.0.1:${port}/api/settings`,
      healthUrl,
    });
  } finally {
    await stopChild(child);
  }
}

function defaultPreferences() {
  return {
    layout: { visualsMode: 'full', mapMode: 'auto', displayMode: 'auto', defaultRegion: 'world', activeLayer: null, workspacePreset: 'operator', panels: {} },
    sources: { enabledCategories: [], enabledSourceIds: [], noiseSuppression: { duplicateBurst: { enabled: true, minSimilarClusters: 2 }, repetitiveLowValue: { enabled: true, maxStoryCount: 1, maxSourceCount: 1 }, sourceRules: [] } },
    llm: { newsModeDefault: 'auto' },
    agentAnalysis: { detailLevel: 'standard', publishPolicy: 'strict', deterministicFallbackMode: 'always', horizonBehavior: 'balanced', tippingPointMinProbability: 'HIGH', maxPublishedTippingPoints: 5 },
    alerts: { operational: { enabled: true, defaultRoute: [], escalationRoute: [], staleSweep: { enabled: true, cooldownMinutes: 30, escalationAfter: 2 }, sourceFailures: { enabled: true, minFailedSources: 3, minDegradedSources: 2, cooldownMinutes: 60, escalationAfter: 2 }, reviewPressure: { enabled: true, minChronicRegions: 2, minPressuredRegions: 2, minLowConfidenceCount: 4, cooldownMinutes: 60, escalationAfter: 2 }, inferenceDegraded: { enabled: true, heuristicFallbackCount: 2, cooldownMinutes: 60, escalationAfter: 2 }, noiseSuppressionPressure: { enabled: true, minRetainedEntries: 20, minRetainedDelta: 3, minConsecutiveGrowthSweeps: 3, minConsecutivePruneSweeps: 2, cooldownMinutes: 60, escalationAfter: 2 } } },
  };
}

test('live /api/analysis honors short-only horizon publishing and tipping-point caps from operator settings', async () => {
  const preferences = defaultPreferences();
  preferences.agentAnalysis.horizonBehavior = 'short-only';
  preferences.agentAnalysis.maxPublishedTippingPoints = 1;
  preferences.agentAnalysis.tippingPointMinProbability = 'HIGH';
  preferences.agentAnalysis.publishPolicy = 'strict';

  await withBootedServer({
    port: BASE_PORT,
    preferences,
    env: {},
  }, async ({ analysisUrl, settingsUrl }) => {
    const settings = await waitFor(settingsUrl, payload => payload?.agentAnalysis?.controls?.horizonBehavior === 'short-only', 30000);
    assert.equal(settings.agentAnalysis.controls.maxPublishedTippingPoints, 1);
    assert.equal(settings.agentAnalysis.controls.tippingPointMinProbability, 'HIGH');

    const analysis = await waitFor(analysisUrl, payload => Array.isArray(payload?.agentAnalysis?.outlook) && Array.isArray(payload?.agentAnalysis?.tippingPoints), 30000);
    assert.equal(Array.isArray(analysis.agentAnalysis.outlook), true);
    assert.equal(analysis.agentAnalysis.outlook.length <= 1, true);
    assert.equal(analysis.agentAnalysis.outlook.every(item => item.horizonId === 'short'), true);
    assert.equal(analysis.agentAnalysis.tippingPoints.length <= 1, true);
    assert.equal(analysis.agentAnalysis.tippingPoints.every(item => item.status === 'active'), true);
    assert.equal(analysis.agentAnalysis.tippingPoints.every(item => item.probability === 'HIGH'), true);
  });
});

test('live /api/analysis withholds deterministic draft when fallback is disabled and LLM is configured but unavailable', async () => {
  const preferences = defaultPreferences();
  preferences.agentAnalysis.deterministicFallbackMode = 'disabled';
  preferences.agentAnalysis.publishPolicy = 'balanced';
  preferences.agentAnalysis.horizonBehavior = 'extended';
  preferences.agentAnalysis.tippingPointMinProbability = 'LOW';
  preferences.agentAnalysis.maxPublishedTippingPoints = 2;

  await withBootedServer({
    port: BASE_PORT + 1,
    preferences,
    env: {
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:9',
    },
  }, async ({ analysisUrl, settingsUrl, healthUrl }) => {
    const settings = await waitFor(settingsUrl, payload => payload?.agentAnalysis?.controls?.deterministicFallbackMode === 'disabled', 30000);
    assert.equal(settings.agentAnalysis.controls.publishMode, 'balanced');
    assert.equal(settings.agentAnalysis.controls.maxPublishedTippingPoints, 2);

    const analysis = await waitFor(analysisUrl, payload => payload?.meta?.refinementState && Array.isArray(payload?.agentAnalysis?.caveats), 30000);
    assert.equal(analysis.meta.source, 'deterministic');
    assert.equal(['failed', 'completed'].includes(analysis.meta.refinementState), true);
    assert.equal(analysis.agentAnalysis.outlook.length, 0);
    assert.equal(analysis.agentAnalysis.tippingPoints.length, 0);
    assert.match(JSON.stringify(analysis.agentAnalysis.caveats), /deterministic fallback is disabled/i);
    assert.match(JSON.stringify(analysis.agentAnalysis.iMessageSummary), /analysis withheld by policy/i);

    const health = await fetchJson(healthUrl);
    assert.equal(health.runtimeLlm.status, health.llmState.status);
  });
});
