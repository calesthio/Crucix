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
          layout: { visualsMode: 'lite', mapMode: 'flat', defaultRegion: 'asiaPacific', activeLayer: 'news' },
          sources: { enabledCategories: ['news', 'air'], enabledSourceIds: ['gdelt-global', 'opensky-network'] },
          llm: { newsModeDefault: 'force' },
          agentAnalysis: { detailLevel: 'expanded' },
        },
      }),
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.settings.preferences.layout.visualsMode, 'lite');
    assert.equal(updated.settings.preferences.llm.newsModeDefault, 'force');
    assert.equal(updated.settings.preferences.agentAnalysis.detailLevel, 'expanded');

    const settings = await waitFor(settingsUrl, payload => payload?.layout?.controls?.visualsMode === 'lite', 30000);
    assert.equal(settings.layout.controls.mapMode, 'flat');
    assert.equal(settings.layout.controls.defaultRegion, 'asiaPacific');
    assert.equal(settings.layout.controls.activeLayer, 'news');
    assert.equal(settings.sources.selection.supportsPerSourceControl, true);
    assert.deepEqual(settings.sources.selection.enabledCategories, ['air', 'news']);
    assert.deepEqual(settings.sources.selection.enabledSourceIds, ['gdelt-global', 'opensky-network']);
    assert.equal(settings.llm.defaultMode, 'force');
    assert.equal(settings.agentAnalysis.controls.detailLevel, 'expanded');
    assert.equal(settings.persistence.persistedPreferences.layout.visualsMode, 'lite');

    const exported = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/export`);
    assert.equal(exported.preferences.layout.visualsMode, 'lite');
    assert.equal(exported.preferences.layout.defaultRegion, 'asiaPacific');
    assert.deepEqual(exported.preferences.sources.enabledCategories, ['air', 'news']);

    const page = await fetch(`http://127.0.0.1:${BASE_PORT}/settings`).then(r => r.text());
    assert.doesNotMatch(page, /id="saveBtn"/i);
    assert.doesNotMatch(page, /id="exportBtn"/i);

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
    assert.match(dashboard, /"defaultRegion":"asiaPacific"/);
  } finally {
    await stopChild(child);
  }
});
