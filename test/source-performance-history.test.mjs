import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryManager } from '../lib/delta/memory.mjs';

test('source performance history snapshots and deltas are reconstructed from compact memory', () => {
  const root = mkdtempSync(join(tmpdir(), 'crucix-source-performance-'));
  try {
    const runsDir = join(root, 'runs');
    const memoryDir = join(runsDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });

    writeFileSync(join(memoryDir, 'hot.json'), JSON.stringify({
      runs: [
        {
          timestamp: '2026-04-26T12:00:00.000Z',
          data: {
            meta: { timestamp: '2026-04-26T12:00:00.000Z' },
            sourcePerformanceSnapshot: {
              version: 'source-performance-workflow-v1',
              totalMeasuredSources: 30,
              withClusterAttribution: 5,
              withSignalContribution: 4,
              degradedOrFailing: 2,
              byTrustOutcome: { supportive: 2, mixed: 1, degraded: 2, none: 25 },
              validationViews: {
                clusterQuality: [{ label: 'High quality', value: 4 }, { label: 'Low quality', value: 2 }],
                reviewPressure: [{ label: 'Low confidence', value: 1 }],
              },
              attributionHeadlines: [{ name: 'ACLED', attentionScore: 7 }],
              topImpactSources: [
                { name: 'ACLED', attentionScore: 7, trustOutcome: 'supportive' },
                { name: 'Bluesky', attentionScore: 5, trustOutcome: 'degraded' }
              ],
            },
          },
          delta: {},
        },
        {
          timestamp: '2026-04-26T11:30:00.000Z',
          data: {
            meta: { timestamp: '2026-04-26T11:30:00.000Z' },
            sourcePerformanceSnapshot: {
              version: 'source-performance-workflow-v1',
              totalMeasuredSources: 30,
              withClusterAttribution: 3,
              withSignalContribution: 2,
              degradedOrFailing: 3,
              byTrustOutcome: { supportive: 1, mixed: 1, degraded: 3, none: 25 },
              validationViews: {
                clusterQuality: [{ label: 'High quality', value: 2 }, { label: 'Low quality', value: 3 }],
                reviewPressure: [{ label: 'Low confidence', value: 3 }],
              },
              attributionHeadlines: [{ name: 'Bluesky', attentionScore: 4 }],
              topImpactSources: [
                { name: 'Bluesky', attentionScore: 4, trustOutcome: 'degraded' },
                { name: 'Telegram', attentionScore: 3, trustOutcome: 'mixed' }
              ],
            },
          },
          delta: {},
        },
      ],
      alertedSignals: {},
      signalStates: {},
    }, null, 2));

    const memory = new MemoryManager(runsDir);
    const history = memory.getSourcePerformanceHistory();

    assert.equal(history.version, 'source-performance-history-v1');
    assert.equal(history.snapshotCount, 2);
    assert.equal(history.snapshots[0].summary.withClusterAttribution, 5);
    assert.equal(history.deltaViews[0].summaryDelta.withClusterAttribution, 2);
    assert.equal(history.deltaViews[0].summaryDelta.degradedOrFailing, -1);
    assert.equal(history.deltaViews[0].summaryDelta.byTrustOutcome.supportive, 1);
    assert.equal(history.deltaViews[0].summaryDelta.clusterQuality['High quality'], 2);
    assert.equal(history.deltaViews[0].summaryDelta.reviewPressure['Low confidence'], -2);
    assert.equal(history.deltaViews[0].topSourceShifts[0].name, 'ACLED');
    assert.equal(history.deltaViews[0].topSourceShifts[0].status, 'new');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
