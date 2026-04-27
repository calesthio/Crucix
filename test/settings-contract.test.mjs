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
    alerting: { enabled: true, cooldownMinutes: 30, escalationCooldownMinutes: 120 },
  },
  llmProvider: { model: 'qwen', isConfigured: true },
  currentLanguage: 'en',
  OPERATOR_SETTINGS_PATH: '/tmp/test-operator-settings.json',
  currentData: null,
  lastSweepTime: '2026-04-25T20:00:00.000Z',
  sweepInProgress: false,
  sweepStartedAt: null,
  process: { env: {} },
  operatorSettingsDefaults: () => ({ version: 'operator-settings-store-v1', updatedAt: null, preferences: { alerts: { operational: { enabled: true, defaultRoute: ['telegram'], escalationRoute: ['telegram', 'discord'], staleSweep: { enabled: true, cooldownMinutes: 30, escalationAfter: 2 }, sourceFailures: { enabled: true, minFailedSources: 3, minDegradedSources: 2, cooldownMinutes: 60, escalationAfter: 3 }, reviewPressure: { enabled: true, minChronicRegions: 2, minPressuredRegions: 2, minLowConfidenceCount: 4, cooldownMinutes: 60, escalationAfter: 2 }, inferenceDegraded: { enabled: true, heuristicFallbackCount: 3, cooldownMinutes: 45, escalationAfter: 2 }, noiseSuppressionPressure: { enabled: true, minRetainedEntries: 25, minRetainedDelta: 3, minConsecutiveGrowthSweeps: 2, minConsecutivePruneSweeps: 2, cooldownMinutes: 90, escalationAfter: 2 } } } } }),
  memory: {
    getSignalState: () => ({ policies: {} }),
    getLlmFailureHistory: () => ({ snapshots: [{ summary: { heuristicFallbackCount: 2, weakClusterCount: 3 } }] }),
    getNoiseSuppressionTelemetryHistory: () => ({ snapshots: [], deltaViews: [], summary: { snapshotCount: 0 } }),
  },
  getOperationalAlertsState: () => ({ policies: {} }),
  summarizeClusterReviewStats: () => ({ chronicFailureCount: 1, recentFailureCount: 1 }),
  summarizeClusterPressureStats: () => ({ pressuredRegionCount: 1 }),
  loadOperatorSettings: () => ({
    version: 'operator-settings-store-v1',
    updatedAt: null,
    preferences: {
      layout: { visualsMode: 'full', mapMode: 'auto', displayMode: 'desktop', defaultRegion: 'world', activeLayer: null, workspacePreset: 'diagnostics', panels: { reviewQueue: { collapsed: false, pinned: true, priority: 10, size: 'wide' } } },
      sources: { enabledCategories: ['news'], enabledSourceIds: ['gdelt-global'], suppressedSourceIds: [], quarantinedSourceIds: [], noiseSuppression: { duplicateBurst: { enabled: true, minSimilarClusters: 3 }, repetitiveLowValue: { enabled: true, maxStoryCount: 1, maxSourceCount: 1 }, sourceRules: [{ sourceId: 'gdelt-global', action: 'suppress', reason: 'duplicate burst source', enabled: true }] } },
      llm: { newsModeDefault: 'auto' },
      agentAnalysis: {
        detailLevel: 'standard',
        tippingPointMinProbability: 'MEDIUM',
        maxPublishedTippingPoints: 3,
        publishPolicy: 'balanced',
        deterministicFallbackMode: 'llm-unavailable-only',
        horizonBehavior: 'extended',
      },
      alerts: { operational: { enabled: true, defaultRoute: ['telegram'], escalationRoute: ['telegram', 'discord'], staleSweep: { enabled: true, cooldownMinutes: 30, escalationAfter: 2 }, sourceFailures: { enabled: true, minFailedSources: 3, minDegradedSources: 2, cooldownMinutes: 60, escalationAfter: 3 }, reviewPressure: { enabled: true, minChronicRegions: 2, minPressuredRegions: 2, minLowConfidenceCount: 4, cooldownMinutes: 60, escalationAfter: 2 }, inferenceDegraded: { enabled: true, heuristicFallbackCount: 3, cooldownMinutes: 45, escalationAfter: 2 }, noiseSuppressionPressure: { enabled: true, minRetainedEntries: 25, minRetainedDelta: 3, minConsecutiveGrowthSweeps: 2, minConsecutivePruneSweeps: 2, cooldownMinutes: 90, escalationAfter: 2 } } },
    },
  }),
  buildNewsClusterSummary: snapshot => ({ sourceReasoning: snapshot?.newsSourceReasoning || null }),
  summarizeClusterRepairArtifacts: artifacts => ({ totalArtifacts: Array.isArray(artifacts) ? artifacts.length : 0, topReasons: [], topRegions: [], items: Array.isArray(artifacts) ? artifacts : [] }),
  buildOperatorSourceOps: snapshot => ({
    contract: {
      version: 'source-ops-profile-v1',
      lifecycleEvaluationSchemaPath: 'source-ops/schemas/lifecycle-evaluation.schema.json',
      lifecycleBatchSchemaPath: 'source-ops/schemas/lifecycle-batch.schema.json',
    },
    history: { version: 'source-health-history-v1', windows: [] },
    performance: {
      version: 'source-performance-workflow-v1',
      totalMeasuredSources: 2,
      withClusterAttribution: 1,
      withSignalContribution: 1,
      degradedOrFailing: 0,
      byTrustOutcome: { supportive: 1, mixed: 0, degraded: 0, none: 1 },
      attributionCoverage: { clusterAttributedRatio: 0.5 },
      topImpactSources: [],
      measurementNotes: { directClusterAttribution: 'available' },
      workflow: {
        attributionDiagnostics: { version: 'source-attribution-diagnostics-v1', summary: { aliasCollisionCount: 1 } },
        attributionHeadlines: [],
        confidenceCaveats: [],
        validationViews: { trustOutcomes: [] },
      },
    },
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
  buildOperatorLlmStateContract: () => ({ status: 'applied', label: 'LLM APPLIED', summary: 'LLM participated', surfaces: { analysis: { label: 'LLM APPLIED' }, ideas: { label: 'STATIC BY DESIGN' } } }),
  buildNoiseSuppressionContract: () => ({ version: 'noise-suppression-v1', summary: { activeSourceRuleCount: 1 }, sourceRules: { activeRules: [{ sourceId: 'gdelt-global' }], suggestedRules: [] } }),
  sourceControlAuditSnapshot: () => [],
  settingsAdminAuditSnapshot: () => [],
  getSweepWatchdogSnapshot: () => ({ timeoutMinutes: 45, timeoutMs: 2700000, pollMs: 30000, overdue: false, overdueMs: 0, phase: 'idle', recoveryClassification: null }),
  getLlmProviderReadinessSnapshot: () => ({ status: 'unknown', lastSuccess: null, lastFailure: null, lastProbeType: null }),
  module: { exports: {} },
  exports: {},
};
vm.createContext(context);
vm.runInContext(`
  ${extractChunk('function buildRuntimeConfigContract() {', '// API: current data')}
  module.exports = { buildRuntimeConfigContract, summarizeNoiseSuppressionPressure, summarizeOperationalAlertState, buildOperatorSettingsContract, buildAdminSettingsContract, buildLlmOperationsContract };
`, context);

const { buildRuntimeConfigContract, summarizeNoiseSuppressionPressure, summarizeOperationalAlertState, buildOperatorSettingsContract, buildAdminSettingsContract, buildLlmOperationsContract } = context.module.exports;

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
    newsLlmDebug: {
      requestedMode: 'force',
      providerConfigured: true,
      fallbackReason: 'parse-failed',
      heuristicFallbackCount: 2,
      llmSuccessCount: 1,
      llmErrorCount: 1,
      review: { topReasons: [{ reason: 'no-json-match', count: 1 }] },
    },
    ideasSource: 'llm-failed',
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
  assert.equal(contract.agentAnalysis.controls.publishMode, 'balanced');
  assert.equal(contract.agentAnalysis.controls.deterministicFallbackMode, 'llm-unavailable-only');
  assert.equal(contract.agentAnalysis.controls.horizonBehavior, 'extended');
  assert.equal(contract.agentAnalysis.controls.tippingPointMinProbability, 'MEDIUM');
  assert.equal(contract.agentAnalysis.controls.maxPublishedTippingPoints, 3);
  assert.equal(Array.isArray(contract.agentAnalysis.controls.availablePublishPolicies), true);
  assert.equal(Array.isArray(contract.agentAnalysis.controls.availableDeterministicFallbackModes), true);
  assert.equal(contract.runtime.refreshIntervalMinutes, 15);
  assert.equal(contract.runtime.watchdog.timeoutMinutes, 45);
  assert.equal(contract.debug.endpointExposure, 'local-only');
  assert.equal(contract.alerts.telegramEnabled, true);
  assert.equal(contract.alerts.discordEnabled, true);
  assert.equal(contract.alerts.operational.version, 'operational-alert-routing-v1');
  assert.equal(contract.alerts.persistedPreferences.operational.inferenceDegraded.heuristicFallbackCount, 3);
  assert.equal(contract.alerts.persistedPreferences.operational.noiseSuppressionPressure.minConsecutiveGrowthSweeps, 2);
  assert.equal(contract.alerts.operational.policies.noiseSuppressionPressure.active, false);
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
  assert.equal(contract.sourceConsole.contract.lifecycleEvaluationSchemaPath, 'source-ops/schemas/lifecycle-evaluation.schema.json');
  assert.equal(contract.sourceConsole.contract.lifecycleBatchSchemaPath, 'source-ops/schemas/lifecycle-batch.schema.json');
  assert.equal(Array.isArray(contract.sourceConsole.lifecycleActions.humanApprovalBoundary.humanApprovalBoundaryStates), true);
  assert.equal(Array.isArray(contract.sourceConsole.lifecycleActions.queue.evaluations), true);
  assert.equal(Array.isArray(contract.sourceConsole.inventory), true);
  assert.equal(contract.sourceConsole.performanceWorkflow.version, 'source-performance-workflow-v1');
  assert.equal(contract.sourceConsole.performanceWorkflow.attributionDiagnostics.version, 'source-attribution-diagnostics-v1');
  assert.equal(Array.isArray(contract.sourceConsole.performanceWorkflow.attributionHeadlines), true);
  assert.equal(Array.isArray(contract.sourceConsole.performanceWorkflow.confidenceCaveats), true);
  assert.equal(contract.sourceConsole.sourceControls.version, 'source-ops-control-v2');
  assert.equal(contract.sourceConsole.sourceControls.endpoint, '/api/source-ops/control');
  assert.equal(contract.sourceConsole.sourceControls.auditEndpoint, '/api/source-ops/audit');
  assert.equal(Array.isArray(contract.sourceConsole.sourceControls.recentAudit), true);
  assert.deepEqual(contract.sources.selection.enabledCategories, ['news']);
  assert.deepEqual(contract.sources.selection.enabledSourceIds, ['gdelt-global']);
  assert.deepEqual(contract.sources.selection.suppressedSourceIds, []);
  assert.deepEqual(contract.sources.selection.quarantinedSourceIds, []);
  assert.equal(contract.sources.selection.noiseSuppression.duplicateBurst.minSimilarClusters, 3);
  assert.equal(contract.sourceConsole.noiseSuppression.version, 'noise-suppression-v1');
  assert.equal(Array.isArray(contract.sourceConsole.noiseSuppression.sourceRules.activeRules), true);
  assert.equal(contract.persistence.capabilities.export, false);
  assert.equal(contract.persistence.capabilities.writeApi, false);
  assert.equal(contract.access.role, 'operator');
  assert.equal(contract.access.diagnosticsSurface, '/diagnostics');
  assert.equal(contract.access.sourceConsoleSurface, '/source-ops');
  assert.equal(contract.access.llmOperationsSurface, '/llm-ops');
  assert.equal(contract.access.localAdminRequired, true);
  assert.match(contract.notes[0], /centralizes current operator-visible settings/i);
});

test('noise suppression pressure summaries escalate retained-growth and prune streaks into operator cues', () => {
  context.memory.getNoiseSuppressionTelemetryHistory = () => ({
    snapshots: [
      { timestamp: '2026-04-26T12:00:00.000Z', summary: { retainedEntries: 31, pruningActive: true, agedOutSuggestionCount: 5 } },
      { timestamp: '2026-04-26T11:30:00.000Z', summary: { retainedEntries: 27, pruningActive: true, agedOutSuggestionCount: 2 } },
      { timestamp: '2026-04-26T11:00:00.000Z', summary: { retainedEntries: 22, pruningActive: false, agedOutSuggestionCount: 1 } },
    ],
    deltaViews: [
      { summaryDelta: { retainedEntries: 4, agedOutSuggestionCount: 3 } },
      { summaryDelta: { retainedEntries: 5, agedOutSuggestionCount: 1 } },
    ],
    summary: { snapshotCount: 3 },
  });

  const pressure = summarizeNoiseSuppressionPressure({}, { minRetainedEntries: 25, minRetainedDelta: 3, minConsecutiveGrowthSweeps: 2, minConsecutivePruneSweeps: 2 });
  assert.equal(pressure.active, true);
  assert.equal(pressure.severity, 'warning');
  assert.equal(pressure.metrics.consecutiveGrowthSweeps, 2);
  assert.equal(pressure.metrics.consecutivePruneSweeps, 2);

  const alertState = summarizeOperationalAlertState({ noiseSuppressionTelemetrySnapshot: { summary: { retainedEntries: 31 } } });
  assert.equal(alertState.policies.noiseSuppressionPressure.active, true);
  assert.equal(alertState.policies.noiseSuppressionPressure.metrics.latestRetainedDelta, 4);
  assert.match(alertState.policies.noiseSuppressionPressure.summary, /operator attention/i);

  context.memory.getNoiseSuppressionTelemetryHistory = () => ({ snapshots: [], deltaViews: [], summary: { snapshotCount: 0 } });
});

test('admin settings contract exposes local-write controls separately from operator view', () => {
  const contract = buildAdminSettingsContract();
  assert.equal(contract.version, 'admin-settings-v1');
  assert.equal(contract.persistence.capabilities.export, true);
  assert.equal(contract.persistence.capabilities.import, true);
  assert.equal(contract.persistence.capabilities.writeApi, true);
  assert.equal(contract.persistence.path, '/tmp/test-operator-settings.json');
  assert.equal(contract.persistence.persistedPreferences.sources.noiseSuppression.duplicateBurst.minSimilarClusters, 3);
  assert.equal(contract.persistence.persistedPreferences.alerts.operational.noiseSuppressionPressure.minRetainedEntries, 25);
  assert.equal(contract.access.role, 'admin');
  assert.equal(contract.access.mode, 'local-write');
  assert.equal(contract.access.diagnosticsSurface, '/diagnostics');
  assert.equal(contract.admin.boundaries.requiresLocalRequest, true);
  assert.equal(contract.admin.controls.writeEndpoint, '/api/settings/operator');
  assert.equal(contract.admin.controls.runtimeHistoryDiagnosticsEndpoint, '/api/runtime-history/diagnostics');
});

test('llm operations contract exposes provider health, mode forcing, fallback chains, and recent failure reasons', () => {
  const contract = buildLlmOperationsContract({
    newsLlmDebug: {
      requestedMode: 'force',
      providerConfigured: true,
      attempted: true,
      used: false,
      fallbackReason: 'all-candidate-sets-fell-back',
      heuristicFallbackCount: 3,
      retryCount: 1,
      llmSuccessCount: 2,
      llmErrorCount: 1,
      repairArtifacts: [{
        region: 'Iran',
        reason: 'shape-mismatch',
        stage: 'repair-failed',
        promptFingerprint: 'prompt-fp',
        repairPromptFingerprint: 'repair-fp',
        tuningFingerprint: 'tuning-fp',
        promptPreview: 'user prompt',
        repairPromptPreview: 'repair user',
      }],
      review: { topReasons: [{ reason: 'no-json-match', count: 2 }], failedRegionCount: 2, reviewItems: [{ region: 'Iran', reason: 'no-json-match', itemCount: 3 }] },
    },
    agentAnalysis: {
      sourceReasoning: {
        totalSources: 30,
        anchorCount: 4,
        corroboratorCount: 8,
        anomalyDetectorCount: 2,
        contextCount: 10,
        exploratoryCount: 6,
        guidance: { cautionRoles: ['exploratory'], groundingPriority: ['anchor', 'corroborator'] },
      },
    },
    agentAnalysisMeta: {
      source: 'deterministic',
      error: 'parse-failed',
      refinementState: 'failed',
      refinementCompletion: 'fallback-parse-failed',
      llmTelemetry: {
        surface: 'agent-analysis',
        provider: 'ollama',
        model: 'qwen',
        latencyMs: 842,
        timeoutMs: 90000,
        completion: 'parse-failed',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: { available: true, estimatedUsd: 0, basis: 'local-provider' },
      },
    },
    newsSourceReasoning: {
      totalSources: 30,
      anchorCount: 4,
      corroboratorCount: 8,
      anomalyDetectorCount: 2,
      exploratoryCount: 6,
      guidance: { cautionRoles: ['exploratory'] },
    },
    ideasSource: 'llm-failed',
  });
  assert.equal(contract.version, 'llm-operations-v1');
  assert.equal(contract.surface, '/llm-ops');
  assert.equal(contract.provider.name, 'ollama');
  assert.equal(contract.provider.activeModel, 'qwen');
  assert.equal(contract.provider.readiness.status, 'unknown');
  assert.equal(contract.provider.readiness.lastSuccess.at, null);
  assert.equal(contract.provider.readiness.lastFailure.classification, null);
  assert.equal(contract.provider.readiness.lastProbeType, null);
  assert.equal(contract.modes.defaultNewsMode, 'auto');
  assert.equal(Array.isArray(contract.fallbackChains), true);
  assert.equal(contract.fallbackChains[0].surface, 'news-clustering');
  assert.equal(contract.fallbackChains[0].fallbackReason, 'all-candidate-sets-fell-back');
  assert.equal(contract.clusteringDebug.promptDebug.promptFingerprint, 'prompt-fp');
  assert.equal(contract.clusteringDebug.parseFailureArtifacts.totalArtifacts, 1);
  assert.equal(typeof contract.llmTelemetry.clustering.aggregate.callCount, 'number');
  assert.equal(contract.llmTelemetry.analysis.completion, 'parse-failed');
  assert.equal(contract.reasoningValidation.analysis.reasoningSurfacePresent, true);
  assert.deepEqual(contract.reasoningValidation.analysis.sourceReasoning.cautionRoles, ['exploratory']);
  assert.equal(contract.navigation.api, '/api/llm/operations');
  assert.match(contract.notes[2], /active readiness probe heartbeat/i);
  assert.equal(contract.recentFailures.some(item => item.surface === 'news-clustering'), true);
  assert.equal(contract.recentFailures.some(item => item.surface === 'analysis'), true);
});
