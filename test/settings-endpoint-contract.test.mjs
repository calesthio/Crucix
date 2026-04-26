import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const BASE_PORT = 3238;

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

async function withBootedServer({ port, env }, fn) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    await waitFor(healthUrl, json => Boolean(json?.sourceOps?.inventory?.total), 30000);
    return await fn({
      settingsUrl: `http://127.0.0.1:${port}/api/settings`,
      adminSettingsUrl: `http://127.0.0.1:${port}/api/settings/admin`,
      pageUrl: `http://127.0.0.1:${port}/settings`,
      adminPageUrl: `http://127.0.0.1:${port}/admin/settings`,
    });
  } finally {
    await stopChild(child);
  }
}

test('booted operator and admin settings surfaces stay role-separated with local-safe admin controls', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      DEBUG_ENDPOINT_EXPOSURE: 'local-only',
    },
  }, async ({ settingsUrl, adminSettingsUrl, pageUrl, adminPageUrl }) => {
    const health = await waitFor(`http://127.0.0.1:${BASE_PORT}/api/health`, payload => payload?.runtimeIdentity?.pid && payload?.sweepWatchdog?.phase, 30000);
    assert.equal(typeof health.runtimeIdentity.pid, 'number');
    assert.equal(health.runtimeControl.version, 'runtime-control-v1');
    assert.equal(health.runtimeControl.process.pid, health.runtimeIdentity.pid);
    assert.equal(typeof health.sweepWatchdog.phase, 'string');
    assert.equal('recoveryClassification' in health.sweepWatchdog, true);
    assert.equal('publishedAt' in health.lastSuccess, true);

    const settings = await waitFor(settingsUrl, payload => payload?.version === 'operator-settings-v1', 30000);
    assert.deepEqual(settings.sections, ['layout', 'sources', 'llm', 'agentAnalysis', 'runtime', 'debug', 'alerts', 'config', 'persistence']);
    assert.equal(settings.layout.current, 'operator');
    assert.equal(Array.isArray(settings.layout.controls.availableDisplayModes), true);
    assert.equal(Array.isArray(settings.layout.controls.availableWorkspacePresets), true);
    assert.equal(settings.sources.total >= 1, true);
    assert.equal(Array.isArray(settings.sources.categories), true);
    assert.equal(settings.llm.provider, 'ollama');
    assert.equal(settings.llm.requestedModeOptions.includes('auto'), true);
    assert.equal(settings.runtime.refreshIntervalMinutes >= 1, true);
    assert.equal(settings.debug.endpointExposure, 'local-only');
    assert.equal(settings.config.contract.version, 'runtime-config-v1');
    assert.equal(settings.config.validation.valid, true);
    assert.equal(settings.config.driftSummary.envOverrides >= 1, true);
    assert.equal(settings.sources.selection.supportsPerSourceControl, true);
    assert.equal(Array.isArray(settings.sources.availableSources), true);
    assert.equal(settings.persistence.capabilities.export, false);
    assert.equal(settings.persistence.capabilities.writeApi, false);
    assert.equal(settings.access.role, 'operator');
    assert.equal(settings.access.diagnosticsSurface, '/diagnostics');
    assert.equal(settings.access.localAdminRequired, true);

    const admin = await waitFor(adminSettingsUrl, payload => payload?.version === 'admin-settings-v1', 30000);
    assert.equal(admin.persistence.capabilities.export, true);
    assert.equal(admin.persistence.capabilities.writeApi, true);
    assert.equal(admin.access.role, 'admin');
    assert.equal(admin.admin.boundaries.requiresLocalRequest, true);
    assert.equal(admin.runtimeControl.version, 'runtime-control-v1');
    assert.equal(Array.isArray(admin.runtimeControl.controls.allowedActions), true);
    assert.equal(admin.runtimeControl.controls.allowedActions.includes('restart-safe'), true);
    assert.equal(admin.runtimeControl.controls.allowedActions.includes('stop'), true);

    const badControl = await fetch(`http://127.0.0.1:${BASE_PORT}/api/runtime/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'explode' }),
    }).then(r => r.json().then(body => ({ status: r.status, body })));
    assert.equal(badControl.status, 400);
    assert.equal(badControl.body.ok, false);

    const page = await fetch(pageUrl).then(r => r.text());
    assert.match(page, /read-only operator view/i);
    assert.doesNotMatch(page, /id="saveBtn"/i);
    assert.doesNotMatch(page, /id="exportBtn"/i);

    const diagnosticsPage = await fetch(`http://127.0.0.1:${BASE_PORT}/diagnostics`).then(r => r.text());
    assert.match(diagnosticsPage, /Runtime and review diagnostics/i);
    assert.match(diagnosticsPage, /Operator settings/i);

    const adminPage = await fetch(adminPageUrl).then(r => r.text());
    assert.match(adminPage, /Local control plane/i);
    assert.match(adminPage, /Diagnostics/i);
    assert.match(adminPage, /id="saveBtn"/i);
    assert.match(adminPage, /id="exportBtn"/i);
    assert.match(adminPage, /id="restartBtn"/i);
    assert.match(adminPage, /id="stopBtn"/i);
  });
});
