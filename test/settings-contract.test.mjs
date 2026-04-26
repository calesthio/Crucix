import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not extract chunk between ${startMarker} and ${endMarker}`);
  }
  return source.slice(start, end);
}

const context = {
  console,
  config: {
    port: 3117,
    refreshIntervalMinutes: 15,
    llm: { provider: 'ollama', model: 'qwen', baseUrl: 'http://127.0.0.1:11434' },
    telegram: { botToken: 'x', chatId: 'y' },
    discord: { webhookUrl: 'https://discord.example/webhook' },
    debugEndpoints: { exposure: 'local-only' },
  },
  llmProvider: { model: 'qwen', isConfigured: true },
  currentLanguage: 'en',
  OPERATOR_SETTINGS_PATH: '/tmp/test-operator-settings.json',
  currentData: null,
  lastSweepTime: '2026-04-25T20:00:00.000Z',
  sweepInProgress: false,
  sweepStartedAt: null,
  process: { env: {} },
  loadOperatorSettings: () => ({
    version: 'operator-settings-store-v1',
    updatedAt: null,
    preferences: {
      layout: { visualsMode: 'full', mapMode: 'auto', displayMode: 'desktop', defaultRegion: 'world', activeLayer: null, workspacePreset: 'diagnostics', panels: { reviewQueue: { collapsed: false, pinned: true, priority: 10, size: 'wide' } } },
      sources: { enabledCategories: ['news'], enabledSourceIds: ['gdelt-global'] },
      llm: { newsModeDefault: 'auto' },
      agentAnalysis: { detailLevel: 'standard' },
    },
  }),
  buildOperatorSourceOps: snapshot => ({
    inventory: {
      total: 30,
      active: 29,
      byCategory: { social: 3, macro: 4, air: 2 },
      byLifecycle: { active: 29, shadow: 1 },
      liveStateSummary: { ok: 28, failed: 2 },
      items: [
        { id: 'gdelt-global', name: 'GDELT', category: 'news', lifecycle: 'active', liveState: 'ok' },
        { id: 'opensky-network', name: 'OpenSky', category: 'air', lifecycle: 'active', liveState: 'ok' },
      ],
    },
  }),
  buildOperatorLlmStateContract: () => ({ status: 'applied', label: 'LLM APPLIED' }),
  getSweepWatchdogSnapshot: () => ({ timeoutMinutes: 45, timeoutMs: 2700000, pollMs: 30000 }),
  module: { exports: {} },
  exports: {},
};
vm.createContext(context);
vm.runInContext(`
  ${extractChunk('function buildRuntimeConfigContract() {', '// API: current data')}
  module.exports = { buildRuntimeConfigContract, buildOperatorSettingsContract, buildAdminSettingsContract };
`, context);

const { buildRuntimeConfigContract, buildOperatorSettingsContract, buildAdminSettingsContract } = context.module.exports;

test('runtime config contract exposes defaults, effective values, validation, and drift summary', () => {
  context.process.env = {
    REFRESH_INTERVAL_MINUTES: '22',
    LLM_PROVIDER: 'ollama',
    DEBUG_ENDPOINT_EXPOSURE: 'local-only',
  };
  const contract = buildRuntimeConfigContract();
  assert.equal(contract.version, 'runtime-config-v1');
  assert.equal(contract.schema.version, 'runtime-config-schema-v1');
  assert.equal(contract.effective.refreshIntervalMinutes, 15);
  assert.equal(contract.validation.valid, true);
  assert.equal(contract.entries.some(item => item.key === 'refreshIntervalMinutes'), true);
  assert.equal(contract.driftSummary.envOverrides >= 1, true);
  assert.equal(contract.driftSummary.totalEntries >= 10, true);
  assert.match(contract.notes[0], /Sensitive values are redacted/i);
});

test('operator settings contract centralizes layout, source, llm, agent, runtime, debug, and config posture', () => {
  const contract = buildOperatorSettingsContract({
    agentAnalysis: {
      status: 'ready',
      confidenceLabel: 'moderate',
      tippingPoints: [{ id: 'tp-1' }, { id: 'tp-2' }],
    },
    agentAnalysisMeta: {
      source: 'llm',
      refinementState: 'completed',
      refinementCompletion: 'llm-applied',
    },
  });

  assert.equal(contract.version, 'operator-settings-v1');
  assert.equal(JSON.stringify(contract.sections), JSON.stringify(['layout', 'sources', 'sourceConsole', 'llm', 'agentAnalysis', 'runtime', 'debug', 'alerts', 'config', 'persistence']));
  assert.equal(contract.layout.current, 'diagnostics');
  assert.equal(contract.layout.controls.displayMode, 'desktop');
  assert.equal(contract.layout.controls.workspacePreset, 'diagnostics');
  assert.equal(Array.isArray(contract.layout.controls.availableDisplayModes), true);
  assert.equal(Array.isArray(contract.layout.controls.availableWorkspacePresets), true);
  assert.equal(contract.layout.controls.panelPreferences.reviewQueue.pinned, true);
  assert.equal(contract.layout.controls.panelPreferences.reviewQueue.size, 'wide');
  assert.equal(contract.layout.available.some(item => item.id === 'operator'), true);
  assert.equal(contract.layout.mutability.presets, 'server-file');
  assert.equal(contract.sources.total, 30);
  assert.equal(contract.sources.active, 29);
  assert.equal(contract.sources.categories[0].category, 'macro');
  assert.equal(contract.llm.provider, 'ollama');
  assert.equal(contract.llm.requestedModeOptions.includes('force'), true);
  assert.equal(contract.agentAnalysis.current.source, 'llm');
  assert.equal(contract.agentAnalysis.current.tippingPointCount, 2);
  assert.equal(contract.runtime.refreshIntervalMinutes, 15);
  assert.equal(contract.runtime.watchdog.timeoutMinutes, 45);
  assert.equal(contract.debug.endpointExposure, 'local-only');
  assert.equal(contract.alerts.telegramEnabled, true);
  assert.equal(contract.alerts.discordEnabled, true);
  assert.equal(contract.config.contract.version, 'runtime-config-v1');
  assert.equal(typeof contract.config.driftSummary.driftedEntries, 'number');
  assert.equal(Array.isArray(contract.config.contract.entries), true);
  assert.equal(Array.isArray(contract.config.contract.notes), true);
  assert.equal(contract.config.validation.valid, true);
  assert.equal(contract.sources.selection.supportsPerSourceControl, true);
  assert.equal(Array.isArray(contract.sources.availableSources), true);
  assert.equal(contract.sourceConsole.version, 'source-console-v1');
  assert.equal(contract.sourceConsole.surface, '/source-ops');
  assert.equal(contract.sourceConsole.roleGrouping.enabled, true);
  assert.equal(contract.sourceConsole.lifecycleActions.version, 'source-lifecycle-actions-v1');
  assert.equal(Array.isArray(contract.sourceConsole.lifecycleActions.humanApprovalBoundary.humanApprovalBoundaryStates), true);
  assert.equal(Array.isArray(contract.sourceConsole.lifecycleActions.queue.evaluations), true);
  assert.equal(Array.isArray(contract.sourceConsole.inventory), true);
  assert.deepEqual(contract.sources.selection.enabledCategories, ['news']);
  assert.deepEqual(contract.sources.selection.enabledSourceIds, ['gdelt-global']);
  assert.equal(contract.persistence.capabilities.export, false);
  assert.equal(contract.persistence.capabilities.writeApi, false);
  assert.equal(contract.access.role, 'operator');
  assert.equal(contract.access.diagnosticsSurface, '/diagnostics');
  assert.equal(contract.access.sourceConsoleSurface, '/source-ops');
  assert.equal(contract.access.localAdminRequired, true);
  assert.match(contract.notes[0], /centralizes current operator-visible settings/i);
});

test('admin settings contract exposes local-write controls separately from operator view', () => {
  const contract = buildAdminSettingsContract();
  assert.equal(contract.version, 'admin-settings-v1');
  assert.equal(contract.persistence.capabilities.export, true);
  assert.equal(contract.persistence.capabilities.import, true);
  assert.equal(contract.persistence.capabilities.writeApi, true);
  assert.equal(contract.persistence.path, '/tmp/test-operator-settings.json');
  assert.equal(contract.access.role, 'admin');
  assert.equal(contract.access.mode, 'local-write');
  assert.equal(contract.access.diagnosticsSurface, '/diagnostics');
  assert.equal(contract.admin.boundaries.requiresLocalRequest, true);
  assert.equal(contract.admin.controls.writeEndpoint, '/api/settings/operator');
});
