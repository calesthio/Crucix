import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE_PORT = 3240;

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
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-settings-')), 'operator-settings.json'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    await waitFor(healthUrl, payload => payload?.lifecycle?.phase === 'serving' && payload?.lifecycle?.dataReady === true && payload?.sourceOps?.inventory?.total >= 1, 90000);
    return await fn({
      port,
      healthUrl,
      dataUrl: `http://127.0.0.1:${port}/api/data`,
      analysisUrl: `http://127.0.0.1:${port}/api/analysis`,
      newsUrl: `http://127.0.0.1:${port}/api/brief/news`,
      settingsUrl: `http://127.0.0.1:${port}/api/settings`,
      adminSettingsUrl: `http://127.0.0.1:${port}/api/settings/admin`,
    });
  } finally {
    await stopChild(child);
  }
}

function assertOperatorLlmState(payload) {
  assert.equal(payload.llmState.version, 'llm-operator-state-v1');
  assert.equal(typeof payload.llmState.status, 'string');
  assert.equal(typeof payload.llmState.label, 'string');
  assert.equal(typeof payload.llmState.support.analysis.supported, 'boolean');
  assert.equal(typeof payload.llmState.participation.analysis.participated, 'boolean');
  assert.equal(typeof payload.runtimeLlm.status, 'string');
  assert.equal(payload.runtimeLlm.status, payload.llmState.status);
}

test('booted UI-facing and operator-facing payloads preserve core contracts across dashboard, health, analysis, brief, settings, and admin surfaces', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      DEBUG_ENDPOINT_EXPOSURE: 'local-only',
    },
  }, async ({ healthUrl, dataUrl, analysisUrl, newsUrl, settingsUrl, adminSettingsUrl }) => {
    const health = await waitFor(healthUrl, payload => payload?.runtimeIdentity?.pid && payload?.llmState?.version, 30000);
    assert.equal(health.status, 'ok');
    assert.equal(health.lifecycle.phase, 'serving');
    assert.equal(typeof health.lifecycle.dataReady, 'boolean');
    assert.equal(typeof health.runtimeIdentity.pid, 'number');
    assert.equal(health.runtimeControl.version, 'runtime-control-v1');
    assert.equal(health.sourceOps.inventory.total >= 1, true);
    assert.equal(health.sourceInventory.total, health.sourceOps.inventory.total);
    assert.equal(typeof health.selectionMemory.activeContexts, 'number');
    assert.equal(typeof health.reviewAcks.active, 'number');
    assert.equal(health.operationalAlerts.version, 'operational-alert-routing-v1');
    assert.equal(health.criticalEventQueue.version, 'critical-event-queue-v1');
    assert.equal(Array.isArray(health.criticalEventQueue.confidenceStates), true);
    assert.equal(typeof health.criticalEventQueue.promotedCount, 'number');
    assertOperatorLlmState(health);

    const data = await waitFor(dataUrl, payload => payload?.llmState?.version && payload?.reviewWorkflow?.version, 60000);
    assert.equal(Array.isArray(data.news), true);
    assert.equal(Array.isArray(data.corroboratedSignals), true);
    assert.equal(Array.isArray(data.suspectSignals), true);
    assert.equal(data.sourceOps.inventory.total >= 1, true);
    assert.equal(data.sourceInventory.total, data.sourceOps.inventory.total);
    assert.equal(typeof data.reviewQueue.state, 'string');
    assert.equal(data.reviewWorkflow.version, 'review-workflow-v1');
    assert.equal(data.criticalEventQueue.version, 'critical-event-queue-v1');
    assert.equal(Array.isArray(data.criticalEventQueue.candidates), true);
    assert.equal(typeof data.criticalEventQueue.activeCount, 'number');
    assert.equal(typeof data.reviewQueue.summary, 'string');
    assert.equal(typeof data.reviewWorkflow.noiseSuppression.pressureAlert.active, 'boolean');
    assertOperatorLlmState(data);

    const analysis = await waitFor(analysisUrl, payload => payload?.agentAnalysis?.sourceReasoning && payload?.meta, 30000);
    assert.equal(Array.isArray(analysis.agentAnalysis.outlook), true);
    assert.equal(Array.isArray(analysis.agentAnalysis.iMessageSummary), true);
    assert.equal(Array.isArray(analysis.agentAnalysis.horizons), true);
    assert.equal(Array.isArray(analysis.agentAnalysis.tippingPoints), true);
    assert.equal(typeof analysis.meta.refinementState, 'string');
    assert.equal(typeof analysis.meta.source, 'string');

    const news = await waitFor(newsUrl, payload => typeof payload?.totalClusters === 'number' && payload?.llm?.requestedMode, 30000);
    assert.equal(Array.isArray(news.clusters), true);
    assert.equal(news.totalClusters >= news.clusters.length, true);
    assert.equal('topCluster' in news, true);
    assert.equal(typeof news.quality.low, 'number');
    assert.equal(typeof news.llm.requestedMode, 'string');
    assert.equal(typeof news.sourceReasoning.totalSources, 'number');
    assert.equal(typeof news.llm.providerConfigured, 'boolean');

    const settings = await waitFor(settingsUrl, payload => payload?.version === 'operator-settings-v1', 30000);
    assert.deepEqual(settings.sections, ['layout', 'sources', 'sourceConsole', 'llm', 'agentAnalysis', 'runtime', 'debug', 'alerts', 'config', 'persistence']);
    assert.equal(settings.sourceConsole.version, 'source-console-v1');
    assert.equal(settings.config.contract.version, 'runtime-config-v1');
    assert.equal(settings.persistence.capabilities.writeApi, false);
    assert.equal(settings.alerts.criticalEvents.queue.version, 'critical-event-queue-v1');
    assert.equal(settings.access.role, 'operator');
    assert.equal(settings.access.adminSurface, '/admin/settings');
    assert.equal(settings.access.localAdminRequired, true);

    const admin = await waitFor(adminSettingsUrl, payload => payload?.version === 'admin-settings-v1', 30000);
    assert.equal(admin.access.role, 'admin');
    assert.equal(admin.access.operatorSurface, '/settings');
    assert.equal(admin.admin.boundaries.requiresLocalRequest, true);
    assert.equal(admin.admin.controls.writeEndpoint, '/api/settings/operator');
    assert.equal(admin.admin.controls.auditEndpoint, '/api/settings/audit');
    assert.equal(admin.admin.controls.runtimeHistoryDiagnosticsEndpoint, '/api/runtime-history/diagnostics');
    assert.equal(admin.persistence.capabilities.writeApi, true);
    assert.equal(admin.runtimeControl.version, 'runtime-control-v1');
  });
});
