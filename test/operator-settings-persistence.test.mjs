import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_PORT = 3241;

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
    const initialAdmin = await waitFor(adminSettingsUrl, payload => payload?.persistence?.capabilities?.writeApi === true, 30000);
    const adminWriteToken = initialAdmin.admin.writeAuth.token;

    const updated = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/operator`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': initialAdmin.persistence.etag, 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
      body: JSON.stringify({
        expectedRevision: initialAdmin.persistence.revision,
        expectedEtag: initialAdmin.persistence.etag,
        localAdminNonce: adminWriteToken,
        preferences: {
          layout: { visualsMode: 'lite', mapMode: 'flat', displayMode: 'wallboard', defaultRegion: 'asiaPacific', activeLayer: 'news', workspacePreset: 'source-ops', performance: { wallboardVirtualization: 'on' }, panels: { reviewQueue: { collapsed: false, pinned: true, priority: 5, size: 'wide' }, tradeIdeas: { collapsed: true, pinned: false, priority: 40, size: 'compact' } }, customPresets: { focusdeck: { label: 'Focus Deck', profile: 'custom', description: 'Tighter custom workflow preset.', visualsMode: 'lite', mapMode: 'flat', displayMode: 'desktop', defaultRegion: 'europe', activeLayer: 'osint', panels: { reviewQueue: { collapsed: false, pinned: true, priority: 3, size: 'wide' } } } } },
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
          alerts: {
            operational: {
              enabled: true,
              defaultRoute: ['telegram'],
              escalationRoute: ['telegram', 'discord'],
              staleSweep: { enabled: true, cooldownMinutes: 25, escalationAfter: 2 },
              sourceFailures: { enabled: true, minFailedSources: 4, minDegradedSources: 2, cooldownMinutes: 75, escalationAfter: 3 },
              reviewPressure: { enabled: true, minChronicRegions: 2, minPressuredRegions: 2, minLowConfidenceCount: 5, cooldownMinutes: 80, escalationAfter: 2 },
              inferenceDegraded: { enabled: true, heuristicFallbackCount: 4, cooldownMinutes: 55, escalationAfter: 2 },
              noiseSuppressionPressure: { enabled: true, minRetainedEntries: 30, minRetainedDelta: 4, minConsecutiveGrowthSweeps: 3, minConsecutivePruneSweeps: 2, cooldownMinutes: 95, escalationAfter: 2 },
            },
            criticalEvents: {
              enabled: true,
              defaultRoute: ['telegram'],
              escalationRoute: ['telegram', 'discord'],
              classes: {
                governmentSiteViolence: { enabled: true, severity: 'critical', minHighTrustCorroboration: 1, minMediumTrustCorroboration: 2, officialConfirmationRequired: true, freshnessMinutes: 15 },
                aviationIncident: { enabled: true, severity: 'critical', minHighTrustCorroboration: 1, minMediumTrustCorroboration: 2, officialConfirmationRequired: false, freshnessMinutes: 25 },
                radiationAnomaly: { enabled: true, severity: 'critical', minHighTrustCorroboration: 1, minMediumTrustCorroboration: 1, officialConfirmationRequired: false, freshnessMinutes: 20 },
                chokepointDisruption: { enabled: false, severity: 'high', minHighTrustCorroboration: 1, minMediumTrustCorroboration: 3, officialConfirmationRequired: false, freshnessMinutes: 45 },
              },
            },
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
    assert.deepEqual(updated.settings.preferences.alerts.operational.defaultRoute, ['telegram']);
    assert.deepEqual(updated.settings.preferences.alerts.operational.escalationRoute, ['telegram', 'discord']);
    assert.equal(updated.settings.preferences.alerts.criticalEvents.classes.governmentSiteViolence.officialConfirmationRequired, true);
    assert.equal(updated.settings.preferences.alerts.criticalEvents.classes.chokepointDisruption.enabled, false);
    assert.equal(updated.audit.action, 'write');
    assert.equal(updated.audit.mode, 'settings');
    assert.equal(typeof updated.concurrency.revision, 'number');
    assert.equal(typeof updated.concurrency.etag, 'string');

    const missingWriteAuth = await fetch(`http://127.0.0.1:${BASE_PORT}/api/settings/operator`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': updated.concurrency.etag },
      body: JSON.stringify({ expectedRevision: updated.concurrency.revision, expectedEtag: updated.concurrency.etag, preferences: { layout: { visualsMode: 'full' } } }),
    }).then(r => r.json().then(body => ({ status: r.status, body })));
    assert.equal(missingWriteAuth.status, 428);
    assert.equal(missingWriteAuth.body.error, 'local-admin-write-token-required');

    const staleWrite = await fetch(`http://127.0.0.1:${BASE_PORT}/api/settings/operator`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': initialAdmin.persistence.etag, 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
      body: JSON.stringify({ expectedRevision: initialAdmin.persistence.revision, expectedEtag: initialAdmin.persistence.etag, preferences: { layout: { visualsMode: 'full' } } }),
    }).then(r => r.json().then(body => ({ status: r.status, body })));
    assert.equal(staleWrite.status, 409);
    assert.equal(staleWrite.body.error, 'settings-revision-conflict');
    assert.equal(typeof staleWrite.body.current.revision, 'number');
    assert.equal(typeof staleWrite.body.current.etag, 'string');

    const settings = await waitFor(settingsUrl, payload => payload?.layout?.controls?.visualsMode === 'lite', 30000);
    assert.equal(settings.layout.controls.mapMode, 'flat');
    assert.equal(settings.layout.controls.displayMode, 'wallboard');
    assert.equal(settings.layout.controls.defaultRegion, 'asiaPacific');
    assert.equal(settings.layout.controls.workspacePreset, 'source-ops');
    assert.equal(settings.layout.controls.currentWorkspacePresetLabel, 'Source Ops');
    assert.equal(settings.layout.controls.namedPresets.some(item => item.id === 'source-ops'), true);
    assert.equal(settings.layout.controls.namedPresets.some(item => item.id === 'source-ops' && item.densityMode === 'dense' && item.topbarMode === 'compact'), true);
    assert.equal(settings.layout.controls.namedPresets.some(item => item.id === 'focusdeck' && item.builtIn === false), true);
    assert.equal(settings.layout.controls.customPresets.focusdeck.label, 'Focus Deck');
    assert.equal(settings.layout.controls.performance.wallboardVirtualization, 'on');
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
    assert.equal(settings.persistence.persistedPreferences.layout.customPresets.focusdeck.activeLayer, 'osint');
    assert.equal(settings.persistence.persistedPreferences.sources.noiseSuppression.sourceRules[0].sourceId, 'gdelt-global');
    assert.equal(settings.alerts.operational.version, 'operational-alert-routing-v1');
    assert.equal(settings.sdrCorroboration.version, 'sdr-corroboration-v1');
    assert.equal(settings.alerts.criticalEvents.version, 'critical-event-policy-v1');
    assert.equal(settings.alerts.criticalEvents.queue.version, 'critical-event-queue-v1');
    assert.equal(settings.alerts.criticalEvents.routing.version, 'critical-event-routing-v1');
    assert.equal(settings.alerts.criticalEvents.classMap.governmentSiteViolence.officialConfirmationRequired, true);
    assert.equal(settings.alerts.criticalEvents.classMap.aviationIncident.freshnessMinutes, 25);
    assert.equal(settings.alerts.persistedPreferences.operational.staleSweep.cooldownMinutes, 25);
    assert.equal(settings.alerts.persistedPreferences.operational.noiseSuppressionPressure.minRetainedEntries, 30);
    assert.equal(settings.alerts.persistedPreferences.criticalEvents.classes.radiationAnomaly.minMediumTrustCorroboration, 1);
    assert.equal(settings.alerts.operational.defaultRoute[0], 'telegram');

    const exported = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/export`);
    assert.equal(exported.preferences.layout.visualsMode, 'lite');
    assert.equal(exported.preferences.layout.displayMode, 'wallboard');
    assert.equal(exported.preferences.layout.defaultRegion, 'asiaPacific');
    assert.equal(exported.preferences.layout.workspacePreset, 'source-ops');
    assert.equal(exported.preferences.layout.performance.wallboardVirtualization, 'on');
    assert.equal(exported.preferences.layout.panels.reviewQueue.size, 'wide');
    assert.deepEqual(exported.preferences.sources.enabledCategories, ['air', 'news']);
    assert.equal(exported.preferences.sources.noiseSuppression.duplicateBurst.minSimilarClusters, 3);
    assert.equal(exported.preferences.agentAnalysis.publishPolicy, 'exploratory');
    assert.equal(exported.preferences.agentAnalysis.deterministicFallbackMode, 'disabled');
    assert.equal(exported.preferences.alerts.operational.sourceFailures.minFailedSources, 4);
    assert.equal(exported.preferences.alerts.operational.noiseSuppressionPressure.minRetainedDelta, 4);
    assert.equal(exported.preferences.alerts.criticalEvents.classes.governmentSiteViolence.officialConfirmationRequired, true);
    assert.equal(exported.preferences.alerts.criticalEvents.classes.chokepointDisruption.enabled, false);

    const bundle = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/export?mode=bundle`);
    assert.equal(bundle.version, 'settings-state-bundle-v1');
    assert.equal(bundle.audit.action, 'export');
    assert.equal(bundle.audit.mode, 'bundle');
    assert.equal(bundle.config.operatorSettings.preferences.layout.visualsMode, 'lite');
    assert.equal(Array.isArray(bundle.state.reviewWorkflowAudit), true);
    assert.equal(Array.isArray(bundle.state.clusterRepairActions.decisions), true);

    const imported = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': updated.concurrency.etag },
      body: JSON.stringify({
        ...bundle,
        expectedRevision: updated.concurrency.revision,
        expectedEtag: updated.concurrency.etag,
        localAdminNonce: adminWriteToken,
        config: {
          ...bundle.config,
          operatorSettings: {
            ...bundle.config.operatorSettings,
            preferences: {
              ...bundle.config.operatorSettings.preferences,
              layout: {
                ...bundle.config.operatorSettings.preferences.layout,
                visualsMode: 'full',
                displayMode: 'desktop',
              },
            },
          },
        },
      }),
    });
    assert.equal(imported.ok, true);
    assert.equal(imported.mode, 'bundle');
    assert.equal(imported.settings.preferences.layout.visualsMode, 'full');
    assert.equal(imported.settings.preferences.layout.displayMode, 'desktop');
    assert.equal(imported.restored.reviewAcks, true);
    assert.equal(imported.audit.action, 'import');
    assert.equal(imported.audit.mode, 'bundle');
    assert.equal(typeof imported.concurrency.revision, 'number');
    assert.equal(typeof imported.concurrency.etag, 'string');

    const afterImport = await waitFor(settingsUrl, payload => payload?.layout?.controls?.visualsMode === 'full', 30000);
    assert.equal(afterImport.layout.controls.displayMode, 'desktop');

    const settingsAudit = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/settings/audit`);
    assert.equal(settingsAudit.version, 'settings-admin-audit-v1');
    assert.equal(settingsAudit.entries.some(entry => entry.action === 'write' && entry.mode === 'settings'), true);
    assert.equal(settingsAudit.entries.some(entry => entry.action === 'export' && entry.mode === 'bundle'), true);
    assert.equal(settingsAudit.entries.some(entry => entry.action === 'import' && entry.mode === 'bundle'), true);

    const page = await fetch(`http://127.0.0.1:${BASE_PORT}/settings`).then(r => r.text());
    assert.match(page, /activeSurface: 'settings'/i);
    assert.doesNotMatch(page, /id="saveBtn"/i);
    assert.doesNotMatch(page, /id="exportBtn"/i);

    const diagnosticsPage = await fetch(`http://127.0.0.1:${BASE_PORT}/diagnostics`).then(r => r.text());
    assert.match(diagnosticsPage, /Runtime and review diagnostics/i);

    const adminPage = await fetch(`http://127.0.0.1:${BASE_PORT}/admin/settings`).then(r => r.text());
    assert.match(adminPage, /saveBtn/i);
    assert.match(adminPage, /exportBtn/i);
    assert.match(adminPage, /exportBundleBtn/i);
    assert.match(adminPage, /importBtn/i);
    assert.match(adminPage, /activeSurface: 'admin-settings'/i);

    const sourceAdminBefore = await fetchJson(adminSettingsUrl);
    const sourceControl = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/source-ops/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': sourceAdminBefore.persistence.etag },
      body: JSON.stringify({ action: 'quarantine-source', sourceId: 'gdelt-global', note: 'persistence test quarantine', expectedRevision: sourceAdminBefore.persistence.revision, expectedEtag: sourceAdminBefore.persistence.etag }),
    });
    assert.equal(sourceControl.ok, true);
    assert.equal(sourceControl.after.quarantined, true);
    assert.equal(sourceControl.undo.action, 'clear-quarantine');
    assert.equal(sourceControl.audit.actorEndpoint, '/api/source-ops/control');

    const sourceAudit = await fetchJson(`http://127.0.0.1:${BASE_PORT}/api/source-ops/audit`);
    assert.equal(sourceAudit.version, 'source-control-audit-v1');
    assert.equal(sourceAudit.entries.some(entry => entry.action === 'quarantine-source' && entry.sourceId === 'gdelt-global'), true);

    const operatorContract = await fetchJson(settingsUrl);
    assert.equal(operatorContract.sdrCorroboration.version, 'sdr-corroboration-v1');
    assert.equal(operatorContract.persistence.capabilities.writeApi, false);
    assert.equal(operatorContract.persistence.capabilities.writeConcurrencyToken, true);
    assert.equal(typeof operatorContract.persistence.revision, 'number');
    assert.equal(typeof operatorContract.persistence.etag, 'string');
    assert.equal(operatorContract.persistence.concurrency.required, true);
    assert.equal(operatorContract.access.role, 'operator');

    const adminContract = await fetchJson(adminSettingsUrl);
    assert.equal(adminContract.persistence.capabilities.writeApi, true);
    assert.equal(adminContract.persistence.capabilities.writeConcurrencyToken, true);
    assert.equal(adminContract.persistence.capabilities.stateBundle, true);
    assert.equal(adminContract.persistence.capabilities.auditHistory, true);
    assert.equal(adminContract.access.role, 'admin');
    assert.equal(adminContract.admin.controls.auditEndpoint, '/api/settings/audit');
    assert.equal(adminContract.admin.controls.concurrencyHeader, 'If-Match');
    assert.equal(adminContract.admin.controls.writeAuthHeader, 'X-Crucix-Local-Admin-Nonce');
    assert.equal(adminContract.admin.controls.writeAuthBodyField, 'localAdminNonce');
    assert.equal(adminContract.admin.writeAuth.required, true);
    assert.equal(typeof adminContract.admin.writeAuth.token, 'string');
    assert.equal(adminContract.sourceConsole.sourceControls.version, 'source-ops-control-v2');
    assert.equal(adminContract.sourceConsole.sourceControls.auditEndpoint, '/api/source-ops/audit');

    const dashboard = await fetch(`http://127.0.0.1:${BASE_PORT}/`).then(r => r.text());
    assert.match(dashboard, /operatorSettings/);
    assert.match(dashboard, /"visualsMode":"full"/);
    assert.match(dashboard, /"displayMode":"desktop"/);
    assert.match(dashboard, /"defaultRegion":"asiaPacific"/);
    assert.match(dashboard, /\"workspacePreset\":\"source-ops\"/);
    assert.match(dashboard, /\"wallboardVirtualization\":\"on\"/);
    assert.match(dashboard, /\"densityMode\":\"dense\"/);
    assert.match(dashboard, /\"topbarMode\":\"compact\"/);
    assert.match(dashboard, /renderWorkspacePresetStrip/);
    assert.match(dashboard, /openDiagnostics/);
    assert.match(dashboard, /openAdminSettings/);
  } finally {
    await stopChild(child);
  }
});
