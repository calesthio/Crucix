import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetchError } from './helpers.mjs';

import { getGSCPI, briefing } from '../apis/sources/gscpi.mjs';

const SAMPLE_CSV = `Date,Vintage1,Vintage2,Latest
31-Jan-2026,0.5,0.6,0.55
28-Feb-2026,0.8,0.9,0.85
31-Mar-2026,1.2,1.3,1.25
30-Apr-2025,0.3,0.4,0.35
31-May-2025,-0.2,-0.1,-0.15
30-Jun-2025,0.1,0.2,0.10
31-Jul-2025,0.4,0.5,0.45
31-Aug-2025,0.6,0.7,0.65
30-Sep-2025,0.9,1.0,0.95
31-Oct-2025,0.2,0.3,0.25
30-Nov-2025,0.1,0.2,0.15
31-Dec-2025,0.3,0.4,0.35`;

function mockCsvFetch(csvText) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(csvText),
  });
}

describe('gscpi', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('getGSCPI', () => {
    it('parses CSV and returns data sorted newest first', async () => {
      mockCsvFetch(SAMPLE_CSV);
      const result = await getGSCPI(12);
      assert.ok(result.data);
      assert.ok(result.data.length > 0);
      // Newest first
      assert.equal(result.data[0].date, '2026-03');
      assert.equal(result.data[0].value, 1.25);
    });

    it('respects months limit', async () => {
      mockCsvFetch(SAMPLE_CSV);
      const result = await getGSCPI(3);
      assert.ok(result.data.length <= 3);
    });

    it('returns error on network failure', async () => {
      mockFetchError('DNS resolution failed');
      const result = await getGSCPI();
      assert.ok(result.error);
      assert.deepStrictEqual(result.data, []);
    });

    it('returns error on HTTP error', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      });
      const result = await getGSCPI();
      assert.ok(result.error);
    });

    it('handles empty CSV', async () => {
      mockCsvFetch('Date,Latest\n');
      const result = await getGSCPI();
      assert.deepStrictEqual(result.data, []);
    });

    it('skips rows with #N/A values', async () => {
      const csv = `Date,Latest
31-Jan-2026,#N/A
28-Feb-2026,0.75`;
      mockCsvFetch(csv);
      const result = await getGSCPI();
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].value, 0.75);
    });
  });

  describe('briefing', () => {
    it('returns latest value, trend, and signals', async () => {
      mockCsvFetch(SAMPLE_CSV);
      const result = await briefing();
      assert.equal(result.source, 'NY Fed GSCPI');
      assert.ok(result.timestamp);
      assert.ok(result.latest);
      assert.equal(result.latest.value, 1.25);
      assert.equal(result.latest.interpretation, 'elevated');
      assert.ok(result.trend);
      assert.ok(Array.isArray(result.history));
      assert.ok(Array.isArray(result.signals));
    });

    it('generates elevated signal when value > 1.0', async () => {
      mockCsvFetch(SAMPLE_CSV);
      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('elevated') || s.includes('GSCPI')));
    });

    it('returns error when fetch fails', async () => {
      mockFetchError('timeout');
      const result = await briefing();
      assert.equal(result.source, 'NY Fed GSCPI');
      assert.ok(result.error);
    });

    it('detects rising trend', async () => {
      // Values increasing from oldest to newest (newest first in sorted order)
      const csv = `Date,Latest
31-Mar-2026,2.0
28-Feb-2026,1.5
31-Jan-2026,1.0
31-Dec-2025,0.5`;
      mockCsvFetch(csv);
      const result = await briefing();
      assert.equal(result.trend, 'rising');
    });

    it('detects falling trend', async () => {
      const csv = `Date,Latest
31-Mar-2026,0.5
28-Feb-2026,1.0
31-Jan-2026,1.5
31-Dec-2025,2.0`;
      mockCsvFetch(csv);
      const result = await briefing();
      assert.equal(result.trend, 'falling');
    });

    it('generates surge signal on large MoM change', async () => {
      const csv = `Date,Latest
31-Mar-2026,2.5
28-Feb-2026,1.8
31-Jan-2026,1.5`;
      mockCsvFetch(csv);
      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('surged')));
    });
  });
});
