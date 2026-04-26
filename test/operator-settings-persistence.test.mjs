import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_PORT = 3240;

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
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

test('operator settings persist, export, and influence runtime bootstrap state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'crucix-operator-settings-'));
  const settingsPath = join(root, 'operator-settings.json');
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(BASE_PORT),
      OPERATOR_SETTINGS_PATH: settingsPath,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const settingsUrl = `http://127.0.0.1:${BASE_PORT}/api/settings`;
    const adminSettingsUrl = `http://127.0.0.1:${BASE_PORT}/api/settings/admin`;
    await waitFor(adminSettingsUrl, payload => payload?.persistence?.capabilities?.writeApi === true, 30000);

    const updated = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/operator`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          layout: { visualsMode: 'lite', mapMode: 'flat', displayMode: 'wallboard', defaultRegion: 'asiaPacific', activeLayer: 'news', workspacePreset: 'source-ops', panels: { reviewQueue: { collapsed: false, pinned: true, priority: 5, size: 'wide' }, tradeIdeas: { collapsed: true, pinned: false, priority: 40, size: 'compact' } } },
          sources: { enabledCategories: ['news', 'air'], enabledSourceIds: ['gdelt-global', 'opensky-network'], noiseSuppression: { duplicateBurst: { enabled: true, minSimilarClusters: 3 }, repetitiveLowValue: { enabled: false, maxStoryCount: 2, maxSourceCount: 1 }, sourceRules: [{ sourceId: 'gdelt-global', action: 'suppress', reason: 'duplicate-heavy', enabled: true }] } },
          llm: { newsModeDefault: 'force' },
          agentAnalysis: {
            detailLevel: 'expanded',
            publishPolicy: 'exploratory',
            deterministicFallbackMode: 'disabled',
            horizonBehavior: 'short-only',
            tippingPointMinProbability: 'LOW',
            maxPublishedTippingPoints: 2,
          },
        },
      }),
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.settings.preferences.layout.visualsMode, 'lite');
    assert.equal(updated.settings.preferences.llm.newsModeDefault, 'force');
    assert.equal(updated.settings.preferences.agentAnalysis.detailLevel, 'expanded');
    assert.equal(updated.settings.preferences.agentAnalysis.publishPolicy, 'exploratory');
    assert.equal(updated.settings.preferences.agentAnalysis.deterministicFallbackMode, 'disabled');
    assert.equal(updated.settings.preferences.agentAnalysis.horizonBehavior, 'short-only');
    assert.equal(updated.settings.preferences.agentAnalysis.tippingPointMinProbability, 'LOW');
    assert.equal(updated.settings.preferences.agentAnalysis.maxPublishedTippingPoints, 2);

    const settings = await waitFor(settingsUrl, payload => payload?.layout?.controls?.visualsMode === 'lite', 30000);
    assert.equal(settings.layout.controls.mapMode, 'flat');
    assert.equal(settings.layout.controls.displayMode, 'wallboard');
    assert.equal(settings.layout.controls.defaultRegion, 'asiaPacific');
    assert.equal(settings.layout.controls.workspacePreset, 'source-ops');
    assert.equal(settings.layout.controls.panelPreferences.reviewQueue.pinned, true);
    assert.equal(settings.layout.controls.panelPreferences.reviewQueue.priority, 5);
    assert.equal(settings.layout.controls.panelPreferences.tradeIdeas.collapsed, true);
    assert.equal(settings.layout.controls.activeLayer, 'news');
    assert.equal(settings.sources.selection.supportsPerSourceControl, true);
    assert.deepEqual(settings.sources.selection.enabledCategories, ['air', 'news']);
    assert.deepEqual(settings.sources.selection.enabledSourceIds, ['gdelt-global', 'opensky-network']);
    assert.equal(settings.sources.selection.noiseSuppression.duplicateBurst.minSimilarClusters, 3);
    assert.equal(settings.sources.selection.noiseSuppression.repetitiveLowValue.enabled, false);
    assert.equal(settings.llm.defaultMode, 'force');
    assert.equal(settings.agentAnalysis.controls.detailLevel, 'expanded');
    assert.equal(settings.agentAnalysis.controls.publishMode, 'exploratory');
    assert.equal(settings.agentAnalysis.controls.deterministicFallbackMode, 'disabled');
    assert.equal(settings.agentAnalysis.controls.horizonBehavior, 'short-only');
    assert.equal(settings.agentAnalysis.controls.tippingPointMinProbability, 'LOW');
    assert.equal(settings.agentAnalysis.controls.maxPublishedTippingPoints, 2);
    assert.equal(settings.persistence.persistedPreferences.layout.visualsMode, 'lite');
    assert.equal(settings.persistence.persistedPreferences.sources.noiseSuppression.sourceRules[0].sourceId, 'gdelt-global');

    const exported = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/export`);
    assert.equal(exported.preferences.layout.visualsMode, 'lite');
    assert.equal(exported.preferences.layout.displayMode, 'wallboard');
    assert.equal(exported.preferences.layout.defaultRegion, 'asiaPacific');
    assert.equal(exported.preferences.layout.workspacePreset, 'source-ops');
    assert.equal(exported.preferences.layout.panels.reviewQueue.size, 'wide');
    assert.deepEqual(exported.preferences.sources.enabledCategories, ['air', 'news']);
    assert.equal(exported.preferences.sources.noiseSuppression.duplicateBurst.minSimilarClusters, 3);
    assert.equal(exported.preferences.agentAnalysis.publishPolicy, 'exploratory');
    assert.equal(exported.preferences.agentAnalysis.deterministicFallbackMode, 'disabled');

    const page = await fetch(`http://127.0.0.1:${BASE_PORT}/settings`).then(r => r.text());
    assert.match(page, /Diagnostics/i);
    assert.doesNotMatch(page, /id="saveBtn"/i);
    assert.doesNotMatch(page, /id="exportBtn"/i);

    const diagnosticsPage = await fetch(`http://127.0.0.1:${BASE_PORT}/diagnostics`).then(r => r.text());
    assert.match(diagnosticsPage, /Runtime and review diagnostics/i);

    const adminPage = await fetch(`http://127.0.0.1:${BASE_PORT}/admin/settings`).then(r => r.text());
    assert.match(adminPage, /id="saveBtn"/i);
    assert.match(adminPage, /id="exportBtn"/i);

    const operatorContract = await fetchJson(settingsUrl);
    assert.equal(operatorContract.persistence.capabilities.writeApi, false);
    assert.equal(operatorContract.access.role, 'operator');

    const adminContract = await fetchJson(adminSettingsUrl);
    assert.equal(adminContract.persistence.capabilities.writeApi, true);
    assert.equal(adminContract.access.role, 'admin');

    const dashboard = await fetch(`http://127.0.0.1:${BASE_PORT}/`).then(r => r.text());
    assert.match(dashboard, /operatorSettings/);
    assert.match(dashboard, /"visualsMode":"lite"/);
    assert.match(dashboard, /"displayMode":"wallboard"/);
    assert.match(dashboard, /"defaultRegion":"asiaPacific"/);
    assert.match(dashboard, /"workspacePreset":"source-ops"/);
    assert.match(dashboard, /renderWorkspacePresetStrip/);
    assert.match(dashboard, /openDiagnostics/);
    assert.match(dashboard, /openAdminSettings/);
  } finally {
    await stopChild(child);
  }
});
