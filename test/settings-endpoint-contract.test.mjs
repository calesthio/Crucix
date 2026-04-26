import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-settings-')), 'operator-settings.json'),
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
      llmOperationsUrl: `http://127.0.0.1:${port}/api/llm/operations`,
      pageUrl: `http://127.0.0.1:${port}/settings`,
      adminPageUrl: `http://127.0.0.1:${port}/admin/settings`,
      llmOpsPageUrl: `http://127.0.0.1:${port}/llm-ops`,
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
  }, async ({ settingsUrl, adminSettingsUrl, llmOperationsUrl, pageUrl, adminPageUrl, llmOpsPageUrl }) => {
    const health = await waitFor(`http://127.0.0.1:${BASE_PORT}/api/health`, payload => payload?.runtimeIdentity?.pid && payload?.sweepWatchdog?.phase, 30000);
    assert.equal(typeof health.runtimeIdentity.pid, 'number');
    assert.equal(health.runtimeControl.version, 'runtime-control-v1');
    assert.equal(health.runtimeControl.process.pid, health.runtimeIdentity.pid);
    assert.equal(typeof health.runtimeControl.jobs.synthesis.attemptCount, 'number');
    assert.equal(typeof health.runtimeControl.jobs.ideas.timeoutMs, 'number');
    assert.equal(typeof health.runtimeControl.jobs.analysis.timeoutMs, 'number');
    assert.equal(typeof health.sweepWatchdog.phase, 'string');
    assert.equal('recoveryClassification' in health.sweepWatchdog, true);
    assert.equal('publishedAt' in health.lastSuccess, true);
    assert.equal(typeof health.llmProviderReadiness?.status, 'string');
    assert.equal(health.noiseSuppressionTelemetry.version, 'noise-suppression-history-v2');
    assert.equal(typeof health.noiseSuppressionTelemetry.decayTelemetry.agedOutSuggestionCount, 'number');
    assert.equal(typeof health.noiseSuppressionTelemetry.pruneTelemetry.summary.retainedEntries, 'number');
    assert.equal(health.noiseSuppressionTrend.version, 'noise-suppression-history-trend-v1');
    assert.equal(typeof health.noiseSuppressionTrend.snapshotCount, 'number');
    assert.equal(health.operationalAlerts.version, 'operational-alert-routing-v1');
    assert.equal(typeof health.operationalAlerts.policies.staleSweep.active, 'boolean');

    const settings = await waitFor(settingsUrl, payload => payload?.version === 'operator-settings-v1', 30000);
    assert.deepEqual(settings.sections, ['layout', 'sources', 'sourceConsole', 'llm', 'agentAnalysis', 'runtime', 'debug', 'alerts', 'config', 'persistence']);
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
    assert.equal(settings.sources.selection.noiseSuppression.duplicateBurst.enabled, true);
    assert.equal(settings.sourceConsole.noiseSuppression.version, 'noise-suppression-v1');
    assert.equal(typeof settings.sourceConsole.noiseSuppression.history.decayTelemetry.agedOutSuggestionCount, 'number');
    assert.equal(typeof settings.sourceConsole.noiseSuppression.history.pruneTelemetry.summary.retainedEntries, 'number');
    assert.equal(settings.sourceConsole.noiseSuppression.trend.version, 'noise-suppression-history-trend-v1');
    assert.equal(Array.isArray(settings.sourceConsole.noiseSuppression.trend.snapshots), true);
    assert.equal(settings.persistence.capabilities.export, false);
    assert.equal(settings.alerts.operational.version, 'operational-alert-routing-v1');
    assert.equal(Array.isArray(settings.alerts.operational.defaultRoute), true);
    assert.equal(settings.persistence.capabilities.writeApi, false);
    assert.equal(settings.sourceConsole.version, 'source-console-v1');
    assert.equal(settings.sourceConsole.surface, '/source-ops');
    assert.equal(settings.sourceConsole.roleGrouping.enabled, true);
    assert.equal(settings.sourceConsole.lifecycleActions.version, 'source-lifecycle-actions-v1');
    assert.equal(Array.isArray(settings.sourceConsole.lifecycleActions.queue.evaluations), true);
    assert.equal(typeof settings.sourceConsole.lifecycleActions.humanApprovalBoundary.activePromotionRequiresHumanApproval, 'boolean');
    assert.equal(settings.sourceConsole.performanceWorkflow.version, 'source-performance-workflow-v1');
    assert.equal(settings.sourceConsole.performanceWorkflow.attributionDiagnostics.version, 'source-attribution-diagnostics-v1');
    assert.equal(Array.isArray(settings.sourceConsole.performanceWorkflow.attributionHeadlines), true);
    assert.equal(Array.isArray(settings.sourceConsole.performanceWorkflow.confidenceCaveats), true);
    assert.equal(settings.sourceConsole.sourceControls.endpoint, '/api/source-ops/control');
    assert.equal(settings.access.role, 'operator');
    assert.equal(settings.access.diagnosticsSurface, '/diagnostics');
    assert.equal(settings.access.sourceConsoleSurface, '/source-ops');
    assert.equal(settings.access.llmOperationsSurface, '/llm-ops');
    assert.equal(settings.access.localAdminRequired, true);

    const admin = await waitFor(adminSettingsUrl, payload => payload?.version === 'admin-settings-v1', 30000);
    assert.equal(admin.persistence.capabilities.export, true);
    assert.equal(admin.persistence.capabilities.writeApi, true);
    assert.equal(admin.access.role, 'admin');
    assert.equal(admin.admin.boundaries.requiresLocalRequest, true);
    assert.equal(admin.runtimeControl.version, 'runtime-control-v1');
    assert.equal(typeof admin.runtimeControl.jobs.synthesis.attemptCount, 'number');
    assert.equal('lastOutcome' in admin.runtimeControl.jobs.ideas, true);
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

    const llmOps = await waitFor(llmOperationsUrl, payload => payload?.version === 'llm-operations-v1', 30000);
    assert.equal(llmOps.surface, '/llm-ops');
    assert.equal(llmOps.provider.name, 'ollama');
    assert.equal(Array.isArray(llmOps.fallbackChains), true);
    assert.equal(Array.isArray(llmOps.recentFailures), true);
    assert.equal(llmOps.clusteringDebug.reviewEndpoint, '/api/brief/news/review');
    assert.equal(typeof llmOps.llmTelemetry.clustering.aggregate.callCount, 'number');
    assert.equal(typeof llmOps.clusteringDebug.parseFailureArtifacts.totalArtifacts, 'number');
    assert.equal(llmOps.reasoningValidation.analysis.endpoint, '/api/analysis/validation-summary');
    assert.equal(typeof llmOps.reasoningValidation.analysis.reasoningSurfacePresent, 'boolean');
    assert.equal(typeof llmOps.provider.readiness.status, 'string');
    assert.equal('lastSuccess' in llmOps.provider.readiness, true);
    assert.equal('lastFailure' in llmOps.provider.readiness, true);
    assert.equal('classification' in llmOps.provider.readiness.lastFailure, true);
    assert.equal('lastProbeType' in llmOps.provider.readiness, true);

    const page = await fetch(pageUrl).then(r => r.text());
    assert.match(page, /read-only operator view/i);
    assert.match(page, /ops-shell\.js/i);
    assert.match(page, /activeSurface: 'settings'/i);
    assert.match(page, /ops-shell\.css/i);
    assert.doesNotMatch(page, /id="saveBtn"/i);
    assert.doesNotMatch(page, /id="exportBtn"/i);

    const sourceOpsPage = await fetch(`http://127.0.0.1:${BASE_PORT}/source-ops`).then(r => r.text());
    assert.match(sourceOpsPage, /Operator source console/i);
    assert.match(sourceOpsPage, /ops-shell\.js/i);
    assert.match(sourceOpsPage, /activeSurface: 'source-ops'/i);
    assert.match(sourceOpsPage, /source management console/i);
    assert.match(sourceOpsPage, /Blocked lifecycle actions/i);
    assert.match(sourceOpsPage, /Prune recommendation/i);
    assert.match(sourceOpsPage, /Performance workflow/i);
    assert.match(sourceOpsPage, /Attribution explanations/i);
    assert.match(sourceOpsPage, /Confidence caveats/i);
    assert.match(sourceOpsPage, /Attribution uncertainty diagnostics/i);
    assert.match(sourceOpsPage, /Runtime bucket contract and drift/i);
    assert.match(sourceOpsPage, /Observed drift/i);
    assert.match(sourceOpsPage, /Validation views/i);
    assert.match(sourceOpsPage, /Failing now/i);
    assert.match(sourceOpsPage, /Quarantine/i);

    const diagnosticsPage = await fetch(`http://127.0.0.1:${BASE_PORT}/diagnostics`).then(r => r.text());
    assert.match(diagnosticsPage, /Runtime and review diagnostics/i);
    assert.match(diagnosticsPage, /ops-shell\.js/i);
    assert.match(diagnosticsPage, /activeSurface: 'diagnostics'/i);
    assert.match(diagnosticsPage, /Noise suppression/i);

    const llmOpsPage = await fetch(llmOpsPageUrl).then(r => r.text());
    assert.match(llmOpsPage, /Provider health and fallback operations/i);
    assert.match(llmOpsPage, /ops-shell\.js/i);
    assert.match(llmOpsPage, /activeSurface: 'llm-ops'/i);
    assert.match(llmOpsPage, /Raw JSON/i);
    assert.match(llmOpsPage, /Clustering prompt debug/i);
    assert.match(llmOpsPage, /Reasoning surface validation/i);
    assert.match(llmOpsPage, /Operator-visible cost, latency, and completion telemetry/i);
    assert.match(llmOpsPage, /Provider readiness heartbeat/i);
    assert.match(llmOpsPage, /Failure class/i);
    assert.match(llmOpsPage, /Probe type/i);

    const adminPage = await fetch(adminPageUrl).then(r => r.text());
    assert.match(adminPage, /Local control plane/i);
    assert.match(adminPage, /ops-shell\.js/i);
    assert.match(adminPage, /activeSurface: 'admin-settings'/i);
    assert.match(adminPage, /saveBtn/i);
    assert.match(adminPage, /exportBtn/i);
    assert.match(adminPage, /restartBtn/i);
    assert.match(adminPage, /stopBtn/i);
    assert.match(adminPage, /Noise suppression/i);
  });
});
