import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSourceHealth } from '../lib/source-health.mjs';

test('source health summarizes fallback, llm fallback, and empty-result counters', () => {
  const sweep = {
    crucix: { timestamp: '2026-04-24T19:00:00.000Z' },
    newsLlmDebug: {
      fallbackReason: 'partial-fallback',
      heuristicFallbackCount: 2,
      llmErrorCount: 1,
    },
    sources: {
      OpenSky: {
        timestamp: '2026-04-24T18:59:00.000Z',
        servedFromCache: true,
        cacheAgeMinutes: 5,
      },
      Telegram: {
        timestamp: '2026-04-24T18:59:00.000Z',
        status: 'web_scrape',
        totalPosts: 170,
      },
      ReliefWeb: {
        timestamp: '2026-04-24T18:59:00.000Z',
        source: 'HDX (Humanitarian Data Exchange) — ReliefWeb fallback',
        rwError: 'HTTP 406 blocked due to bot activity',
        hdxDatasets: [],
      },
      WHO: {
        timestamp: '2026-04-24T18:59:00.000Z',
        diseaseOutbreakNews: [],
        outbreakError: null,
      },
      GDELT: {
        timestamp: '2026-04-24T18:59:00.000Z',
        allArticles: [],
      },
    },
  };

  const { entries, summary } = buildSourceHealth(sweep);

  assert.equal(entries.find(entry => entry.name === 'OpenSky').counters.fallbackCount, 1);
  assert.equal(entries.find(entry => entry.name === 'Telegram').counters.fallbackCount, 1);
  assert.equal(entries.find(entry => entry.name === 'ReliefWeb').counters.fallbackCount, 1);
  assert.equal(entries.find(entry => entry.name === 'WHO').counters.emptyResultCount, 1);
  assert.equal(entries.find(entry => entry.name === 'GDELT').counters.llmFallbackCount, 1);
  assert.deepEqual(summary.counters, {
    fallback: 3,
    parseFailures: 0,
    llmFallbacks: 1,
    emptyResults: 2,
  });
});

test('source health counts parse failures when source status indicates malformed payloads', () => {
  const sweep = {
    crucix: { timestamp: '2026-04-24T19:00:00.000Z' },
    sources: {
      Space: {
        timestamp: '2026-04-24T18:59:00.000Z',
        status: 'parse_error',
        error: 'invalid json payload from upstream',
      },
    },
  };

  const { entries, summary } = buildSourceHealth(sweep);
  assert.equal(entries[0].counters.parseFailureCount, 1);
  assert.equal(summary.counters.parseFailures, 1);
});
