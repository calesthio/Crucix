import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryManager } from '../lib/delta/memory.mjs';

test('legacy compact runs are normalized without zeroing new trend fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'crucix-memory-'));
  try {
    const runsDir = join(root, 'runs');
    const memoryDir = join(runsDir, 'memory');
    const coldDir = join(memoryDir, 'cold');
    mkdirSync(coldDir, { recursive: true });

    writeFileSync(join(memoryDir, 'hot.json'), JSON.stringify({
      runs: [
        {
          timestamp: '2026-04-24T20:50:00.000Z',
          data: {
            meta: { timestamp: '2026-04-24T20:50:00.000Z' },
            tg: { posts: 100, urgentCount: 8, urgent: [] },
            healthSummary: { total: 28, ok: 23, degraded: 1, stale: 0, failed: 4 },
            clusterReviewStats: { trackedRegionCount: 5, chronicFailureCount: 2, recentFailureCount: 1 },
            corroboratedSignalsSummary: { total: 3 },
            suspectSignalsSummary: { total: 7 },
            newsClusters: [],
          },
          delta: {},
        },
      ],
      alertedSignals: {},
      signalStates: {},
    }, null, 2));

    writeFileSync(join(coldDir, '2026-04-24.json'), JSON.stringify([
      {
        timestamp: '2026-04-24T05:00:00.000Z',
        data: {
          meta: { timestamp: '2026-04-24T05:00:00.000Z' },
          tg: { posts: 80, urgent: [{ text: 'legacy urgent' }] },
          news: { count: 12 },
          newsClusters: [],
        },
        delta: {},
      },
    ], null, 2));

    const memory = new MemoryManager(runsDir);
    const summary = memory.getTrendSummary([24]);
    const window = summary.windows[0];

    assert.equal(window.runCount, 2);
    assert.equal(window.urgentTempo.current, 8);
    assert.equal(window.urgentTempo.average, 4.5);
    assert.equal(window.sourceHealth.currentFailed, 4);
    assert.equal(window.sourceHealth.maxFailed, 4);
    assert.equal(window.sourceHealth.compatibilityBackfilledRuns, 1);
    assert.equal(window.reviewPressure.trackedRegionCount, 5);
    assert.equal(window.reviewPressure.compatibilityBackfilledRuns, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
