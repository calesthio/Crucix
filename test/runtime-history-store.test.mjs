import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryManager } from '../lib/delta/memory.mjs';

function buildRun({ timestamp, healthFailed = 0, chronicFailureCount = 0, recentFailureCount = 0, attentionScore = 5 } = {}) {
  return {
    meta: { timestamp },
    tg: { posts: 1, urgent: [] },
    healthSummary: {
      total: 3,
      ok: 3 - healthFailed,
      degraded: 0,
      stale: 0,
      failed: healthFailed,
      byTrustClass: { high: 1, medium: 1, low: 1, unknown: 0 },
      byCategory: { news: 1, air: 1, other: 1 },
    },
    clusterReviewStats: {
      trackedRegionCount: 2,
      chronicFailureCount,
      recentFailureCount,
    },
    newsClusters: [
      {
        id: `cluster-${timestamp}`,
        headline: 'Example cluster',
        region: 'Example',
        storyCount: 1,
        sourceCount: 1,
        quality: 'low',
        confidenceLabel: 'weak',
        qualityFlags: ['heuristic-only', 'single-source'],
      },
    ],
    sourceOps: {
      performance: {
        version: 'source-performance-workflow-v1',
        totalMeasuredSources: 3,
        withClusterAttribution: 1,
        withSignalContribution: 1,
        degradedOrFailing: healthFailed,
        byTrustOutcome: { supportive: 1, mixed: 0, degraded: healthFailed, none: 2 - healthFailed },
        workflow: {
          validationViews: {
            clusterQuality: [{ label: 'Low quality', value: 1 }],
            reviewPressure: [{ label: 'Low confidence', value: recentFailureCount }],
          },
          attributionHeadlines: [{ name: 'ACLED', attentionScore }],
        },
        topImpactSources: [{ name: 'ACLED', attentionScore, trustOutcome: healthFailed ? 'degraded' : 'supportive' }],
      },
    },
  };
}

test('MemoryManager persists runtime history and signal state into sqlite-backed store', () => {
  const root = mkdtempSync(join(tmpdir(), 'crucix-runtime-history-'));
  try {
    const runsDir = join(root, 'runs');
    const memory = new MemoryManager(runsDir);

    memory.addRun(buildRun({ timestamp: '2026-04-26T12:00:00.000Z', healthFailed: 1, chronicFailureCount: 1, recentFailureCount: 1, attentionScore: 7 }));
    memory.addRun(buildRun({ timestamp: '2026-04-26T13:00:00.000Z', healthFailed: 0, chronicFailureCount: 0, recentFailureCount: 0, attentionScore: 9 }));
    memory.setSignalState('cluster-review:pressure', { updatedAt: '2026-04-26T13:00:00.000Z', regions: { Iran: { retryCount: 2 } } });

    assert.equal(existsSync(join(runsDir, 'runtime-history.sqlite')), true);

    const reloaded = new MemoryManager(runsDir);
    assert.deepEqual(reloaded.getSignalState('cluster-review:pressure'), {
      updatedAt: '2026-04-26T13:00:00.000Z',
      regions: { Iran: { retryCount: 2 } },
    });

    const sourceHealthHistory = reloaded.getSourceHealthHistory();
    assert.equal(sourceHealthHistory.snapshotCount, 2);
    assert.equal(sourceHealthHistory.snapshots[0].summary.failed, 0);
    assert.equal(sourceHealthHistory.deltaViews[0].summaryDelta.failed, -1);

    const reviewPressureHistory = reloaded.getReviewPressureHistory();
    assert.equal(reviewPressureHistory.snapshots[0].summary.chronicFailureCount, 0);
    assert.equal(reviewPressureHistory.deltaViews[0].summaryDelta.recentFailureCount, -1);

    const llmFailureHistory = reloaded.getLlmFailureHistory();
    assert.equal(llmFailureHistory.snapshotCount, 2);
    assert.equal(llmFailureHistory.snapshots[0].summary.heuristicFallbackCount, 1);

    const sourcePerformanceHistory = reloaded.getSourcePerformanceHistory();
    assert.equal(sourcePerformanceHistory.snapshotCount, 2);
    assert.equal(sourcePerformanceHistory.snapshots[0].topImpactSources[0].attentionScore, 9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
