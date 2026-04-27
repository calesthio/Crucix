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

function loadHarness({ llmConfigured = true, now = '2026-04-24T18:00:00.000Z' } = {}) {
  const context = {
    console,
    Date,
    llmProvider: { isConfigured: llmConfigured, model: 'test-model' },
    memory: { getTrendSummary: () => ({ windows: [] }) },
    lastSweepTime: null,
    sweepInProgress: false,
    buildSourceOpsSurface: () => null,
    loadOperatorSettings: () => ({ preferences: { agentAnalysis: { detailLevel: 'standard', publishPolicy: 'strict', deterministicFallbackMode: 'always', horizonBehavior: 'balanced', tippingPointMinProbability: 'HIGH', maxPublishedTippingPoints: 5 } } }),
    operatorSettingsDefaults: () => ({ preferences: { agentAnalysis: { detailLevel: 'standard', publishPolicy: 'strict', deterministicFallbackMode: 'always', horizonBehavior: 'balanced', tippingPointMinProbability: 'HIGH', maxPublishedTippingPoints: 5 } } }),
    ROOT: '/tmp',
  };
  vm.createContext(context);
  vm.runInContext(`
    ${extractChunk('function buildReasoningSourceContext(snapshot = {}) {', 'function compactAgentAnalysisContext(snapshot = {}, fallback = null) {')}
    globalThis.__agentHarness = {
      buildDeterministicAgentAnalysis,
      reconcileTippingPointLifecycle,
      buildPublishedAgentAnalysis,
      dedupePublishedOutlook,
      isCurrentSnapshotStale,
    };
  `, context);
  const realNow = Date.now;
  Date.now = () => new Date(now).getTime();
  return {
    ...context.__agentHarness,
    restore() {
      Date.now = realNow;
    },
  };
}

function makeTrendWindow(overrides = {}) {
  return {
    hours: 24,
    status: 'ready',
    runCount: 12,
    signals: { suspectCurrent: 2, corroboratedCurrent: 1 },
    urgentTempo: { current: 4 },
    sourceHealth: { currentFailed: 1 },
    marketRegime: { vix: { current: 22 } },
    commodityDrift: { energy: { brentCurrent: 96 } },
    anomalyPersistence: { airRuns: 3, nuclearRuns: 1 },
    ...overrides,
  };
}

test('thin history stays thin-history when LLM is configured', () => {
  const harness = loadHarness({ llmConfigured: true });
  try {
    const analysis = harness.buildDeterministicAgentAnalysis({
      meta: { timestamp: '2026-04-24T17:55:00.000Z' },
      trendSummary: { generatedAt: '2026-04-24T17:55:00.000Z', windows: [{ hours: 24, status: 'thin-history', runCount: 1, signals: {}, urgentTempo: {}, sourceHealth: {}, marketRegime: {}, commodityDrift: {}, anomalyPersistence: {} }] },
      healthSummary: { failed: 0, degraded: 0 },
      suspectSignals: [],
      corroboratedSignals: [],
    });
    assert.equal(analysis.status, 'thin-history');
    assert.match(JSON.stringify(analysis.caveats), /thin/i);
  } finally {
    harness.restore();
  }
});

test('stale current snapshot degrades analysis even with rich trend memory', () => {
  const harness = loadHarness({ llmConfigured: true, now: '2026-04-24T18:00:00.000Z' });
  try {
    const analysis = harness.buildDeterministicAgentAnalysis({
      meta: { timestamp: '2026-04-24T08:00:00.000Z' },
      trendSummary: { generatedAt: '2026-04-24T17:50:00.000Z', windows: [makeTrendWindow()] },
      healthSummary: { failed: 0, degraded: 0 },
      suspectSignals: [{ signal: 'Signal A', confidence: 'medium', reason: 'needs review' }],
      corroboratedSignals: [{ signal: 'Signal B', confidence: 'high', reason: 'confirmed enough' }],
    });
    assert.equal(harness.isCurrentSnapshotStale({ meta: { timestamp: '2026-04-24T08:00:00.000Z' } }), true);
    assert.equal(analysis.status, 'degraded');
    assert.equal(analysis.confidenceLabel, 'low');
    assert.ok(analysis.caveats.some(item => /stale relative to retained trend memory/i.test(item.text)));
  } finally {
    harness.restore();
  }
});

test('deterministic analysis carries source reasoning context when source ops metadata is present', () => {
  const harness = loadHarness({ llmConfigured: true });
  try {
    const analysis = harness.buildDeterministicAgentAnalysis({
      meta: { timestamp: '2026-04-24T17:55:00.000Z' },
      trendSummary: { generatedAt: '2026-04-24T17:55:00.000Z', windows: [makeTrendWindow()] },
      healthSummary: { failed: 0, degraded: 0 },
      suspectSignals: [],
      corroboratedSignals: [],
      sourceOps: {
        inventory: { byTrustClass: { high: 18, medium: 9, low: 3, unknown: 0 } },
        fusionRoles: {
          total: 30,
          byRole: { anchor: 18, corroborator: 5, 'anomaly-detector': 3, context: 1, exploratory: 3 },
          byRoleAndTrust: {
            anchor: { high: 18, medium: 0, low: 0, unknown: 0 },
            exploratory: { high: 0, medium: 0, low: 3, unknown: 0 },
          },
        },
      },
    });
    assert.equal(analysis.sourceReasoning.anchorCount, 18);
    assert.equal(analysis.sourceReasoning.exploratoryCount, 3);
    assert.ok(analysis.evidenceSummary.some(item => item.kind === 'source-mix'));
  } finally {
    harness.restore();
  }
});

test('published analysis only shows active HIGH tipping points', () => {
  const harness = loadHarness();
  try {
    const published = harness.buildPublishedAgentAnalysis({
      status: 'ready',
      confidenceLabel: 'medium',
      tippingPoints: [
        { title: 'Show me', probability: 'HIGH', condition: 'A', expectedImpact: 'B', whyItMatters: 'C', status: 'active' },
        { title: 'Hide medium', probability: 'MEDIUM', condition: 'A', expectedImpact: 'B', whyItMatters: 'C', status: 'active' },
        { title: 'Hide cleared', probability: 'HIGH', condition: 'A', expectedImpact: 'B', whyItMatters: 'C', status: 'cleared' },
      ],
    });
    assert.equal(published.tippingPoints.length, 1);
    assert.equal(published.tippingPoints[0].title, 'Show me');
  } finally {
    harness.restore();
  }
});

test('expired active tipping points are auto-reconciled out of the published surface', () => {
  const harness = loadHarness({ now: '2026-04-24T18:00:00.000Z' });
  try {
    const reconciled = harness.reconcileTippingPointLifecycle({
      status: 'ready',
      confidenceLabel: 'medium',
      tippingPoints: [
        {
          title: 'Expired point',
          probability: 'HIGH',
          condition: 'A',
          expectedImpact: 'B',
          whyItMatters: 'C',
          status: 'active',
          windowEnd: '2026-04-24T10:00:00.000Z',
        },
      ],
    });
    assert.equal(reconciled.tippingPoints[0].status, 'expired');
    assert.match(reconciled.tippingPoints[0].resolutionNote || '', /Automatically expired/i);
    const published = harness.buildPublishedAgentAnalysis(reconciled);
    assert.equal(published.tippingPoints.length, 0);
  } finally {
    harness.restore();
  }
});

test('degraded source-health windows keep caution visible', () => {
  const harness = loadHarness({ llmConfigured: true });
  try {
    const analysis = harness.buildDeterministicAgentAnalysis({
      meta: { timestamp: '2026-04-24T17:55:00.000Z' },
      trendSummary: { generatedAt: '2026-04-24T17:55:00.000Z', windows: [makeTrendWindow({ sourceHealth: { currentFailed: 6 } })] },
      healthSummary: { failed: 6, degraded: 2 },
      suspectSignals: [{ signal: 'Signal A', confidence: 'medium', reason: 'needs review' }],
      corroboratedSignals: [],
    });
    assert.equal(analysis.status, 'degraded');
    assert.ok(analysis.risks.some(item => item.title === 'Source degradation' && item.severity === 'high'));
    assert.ok(analysis.caveats.some(item => /failed sources/i.test(item.text)));
  } finally {
    harness.restore();
  }
});

test('published outlook deduplicates repeated horizons and preserves stable horizon order', () => {
  const harness = loadHarness();
  try {
    const published = harness.buildPublishedAgentAnalysis({
      status: 'ready',
      confidenceLabel: 'medium',
      horizons: [
        { id: 'short', label: 'Next 24h', windowHours: 24, status: 'ready', summary: 'short' },
        { id: 'medium', label: 'Next 72h', windowHours: 72, status: 'ready', summary: 'medium' },
        { id: 'extended', label: 'Next 7d', windowHours: 168, status: 'ready', summary: 'extended' },
      ],
      outlook: [
        { horizonId: 'medium', text: 'Medium low confidence', confidence: 'low', evidenceRefs: [{ type: 'trend', id: 'a', label: 'a' }] },
        { horizonId: 'short', text: 'Short medium confidence', confidence: 'medium', evidenceRefs: [{ type: 'trend', id: 'b', label: 'b' }] },
        { horizonId: 'short', text: 'Short high confidence', confidence: 'high', evidenceRefs: [{ type: 'trend', id: 'c', label: 'c' }] },
        { horizonId: 'extended', text: 'Extended medium confidence', confidence: 'medium', evidenceRefs: [] },
      ],
    }, { publishPolicy: 'exploratory', horizonBehavior: 'extended', tippingPointMinProbability: 'HIGH', maxPublishedTippingPoints: 5 });
    assert.deepEqual(Array.from(published.outlook, item => item.horizonId), ['short', 'medium', 'extended']);
    assert.equal(published.outlook[0].text, 'Short high confidence');
    assert.equal(published.outlook.length, 3);
  } finally {
    harness.restore();
  }
});

 test('published outlook falls back to stronger evidence count when confidence ties', () => {
  const harness = loadHarness();
  try {
    const deduped = harness.dedupePublishedOutlook({
      horizons: [{ id: 'short', label: 'Next 24h', windowHours: 24, status: 'ready', summary: 'short' }],
      outlook: [
        { horizonId: 'short', text: 'Weakly evidenced', confidence: 'medium', evidenceRefs: [{ type: 'trend', id: 'a', label: 'a' }] },
        { horizonId: 'short', text: 'More evidenced', confidence: 'medium', evidenceRefs: [{ type: 'trend', id: 'a', label: 'a' }, { type: 'signal', id: 'b', label: 'b' }] },
      ],
    });
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].text, 'More evidenced');
  } finally {
    harness.restore();
  }
});
