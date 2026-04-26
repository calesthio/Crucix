import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryManager } from '../lib/delta/memory.mjs';

test('noise suppression telemetry history snapshots and deltas are reconstructed from compact memory', () => {
  const root = mkdtempSync(join(tmpdir(), 'crucix-noise-suppression-'));
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
            noiseSuppressionTelemetrySnapshot: {
              version: 'noise-suppression-history-trend-v1',
              summary: {
                agedOutSuggestionCount: 6,
                retainedEntries: 14,
                totalEntries: 16,
                expiredEntriesRemoved: 2,
                overflowEntriesRemoved: 0,
                pruningActive: true,
              },
              bucketCounts: { duplicateBursts: 1, repetitiveLowValueEvents: 10, sourceRuleHits: 3 },
              candidateCounts: { duplicateBursts: 2, repetitiveLowValueEvents: 4, suggestedSourceRules: 1, activeSourceRules: 1 },
            },
          },
          delta: {},
        },
        {
          timestamp: '2026-04-26T11:30:00.000Z',
          data: {
            meta: { timestamp: '2026-04-26T11:30:00.000Z' },
            noiseSuppressionTelemetrySnapshot: {
              version: 'noise-suppression-history-trend-v1',
              summary: {
                agedOutSuggestionCount: 1,
                retainedEntries: 9,
                totalEntries: 9,
                expiredEntriesRemoved: 0,
                overflowEntriesRemoved: 0,
                pruningActive: false,
              },
              bucketCounts: { duplicateBursts: 0, repetitiveLowValueEvents: 7, sourceRuleHits: 2 },
              candidateCounts: { duplicateBursts: 0, repetitiveLowValueEvents: 3, suggestedSourceRules: 0, activeSourceRules: 1 },
            },
          },
          delta: {},
        },
      ],
      alertedSignals: {},
      signalStates: {},
    }, null, 2));

    const memory = new MemoryManager(runsDir);
    const history = memory.getNoiseSuppressionTelemetryHistory();

    assert.equal(history.version, 'noise-suppression-history-trend-v1');
    assert.equal(history.snapshotCount, 2);
    assert.equal(history.snapshots[0].summary.retainedEntries, 14);
    assert.equal(history.snapshots[0].candidateCounts.duplicateBursts, 2);
    assert.equal(history.deltaViews[0].summaryDelta.retainedEntries, 5);
    assert.equal(history.deltaViews[0].summaryDelta.agedOutSuggestionCount, 5);
    assert.equal(history.deltaViews[0].bucketCountDelta.repetitiveLowValueEvents, 3);
    assert.equal(history.deltaViews[0].candidateCountDelta.duplicateBursts, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
