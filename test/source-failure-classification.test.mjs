import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSourceHealth } from '../lib/source-health.mjs';

test('source health classifies setup debt, external limits, and live outages', () => {
  const sweep = {
    crucix: { timestamp: '2026-04-24T19:20:00.000Z' },
    sources: {
      FRED: {
        timestamp: '2026-04-24T19:19:00.000Z',
        source: 'FRED',
        error: 'No FRED API key. Get one free at https://fred.stlouisfed.org/docs/api/api_key.html',
      },
      OpenSky: {
        timestamp: '2026-04-24T19:19:00.000Z',
        source: 'OpenSky',
        error: 'OpenSky cooldown active, serving cached snapshot (25.9m old)',
        liveError: 'cooldown-active',
      },
      Space: {
        timestamp: '2026-04-24T19:19:00.000Z',
        source: 'Space/CelesTrak',
        status: 'error',
        error: 'fetch failed',
      },
      BLS: {
        timestamp: '2026-04-24T19:19:00.000Z',
        source: 'BLS',
        error: 'Request could not be serviced, as the daily threshold for total number of requests allocated to the user with registration key has been reached.',
        rawStatus: 'REQUEST_NOT_PROCESSED',
      },
    },
  };

  const { entries, summary } = buildSourceHealth(sweep);

  assert.equal(entries.find(entry => entry.name === 'FRED').failure.class, 'setup-debt');
  assert.equal(entries.find(entry => entry.name === 'OpenSky').failure.class, 'external-limit');
  assert.equal(entries.find(entry => entry.name === 'Space').failure.class, 'live-outage');
  assert.equal(entries.find(entry => entry.name === 'BLS').failure.class, 'external-limit');
  assert.deepEqual(summary.failureClassification, {
    setupDebt: 1,
    externalLimit: 2,
    liveOutage: 1,
    parseFailure: 0,
    otherFailure: 0,
    topFailures: [
      {
        name: 'FRED',
        class: 'setup-debt',
        severity: 'warning',
        operatorLabel: 'Setup debt',
        reason: 'No FRED API key. Get one free at https://fred.stlouisfed.org/docs/api/api_key.html',
      },
      {
        name: 'OpenSky',
        class: 'external-limit',
        severity: 'warning',
        operatorLabel: 'External limit',
        reason: 'OpenSky cooldown active, serving cached snapshot (25.9m old)',
      },
      {
        name: 'Space',
        class: 'live-outage',
        severity: 'critical',
        operatorLabel: 'Live outage',
        reason: 'fetch failed',
      },
      {
        name: 'BLS',
        class: 'external-limit',
        severity: 'warning',
        operatorLabel: 'External limit',
        reason: 'Request could not be serviced, as the daily threshold for total number of requests allocated to the user with registration key has been reached.',
      },
    ],
  });
});

test('source health classifies parse failures separately', () => {
  const sweep = {
    crucix: { timestamp: '2026-04-24T19:20:00.000Z' },
    sources: {
      SomeSource: {
        timestamp: '2026-04-24T19:19:00.000Z',
        status: 'parse_error',
        error: 'invalid json payload from upstream',
      },
    },
  };

  const { entries, summary } = buildSourceHealth(sweep);
  assert.equal(entries[0].failure.class, 'parse-failure');
  assert.equal(summary.failureClassification.parseFailure, 1);
});
