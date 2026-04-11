import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { searchPatents, searchByAssignee, briefing } from '../apis/sources/patents.mjs';

function makePatent(overrides = {}) {
  return {
    patent_id: 'US-12345678-A1',
    patent_title: 'Machine Learning System',
    patent_date: '2026-03-01',
    patent_abstract: 'A system for machine learning inference.',
    assignee_organization: 'TechCorp Inc',
    patent_type: 'utility',
    ...overrides,
  };
}

function makePatentsResponse(patents) {
  return { patents };
}

describe('patents', () => {
  before(() => saveFetch());
  after(() => restoreFetch());

  describe('searchPatents', () => {
    it('returns patents on success', async () => {
      const body = makePatentsResponse([makePatent()]);
      mockFetch(body);

      const result = await searchPatents('machine learning');
      assert.ok(result.patents);
      assert.equal(result.patents.length, 1);
      assert.equal(result.patents[0].patent_title, 'Machine Learning System');
    });

    it('returns error on failure', async () => {
      mockFetchError('timeout');
      const result = await searchPatents('quantum');
      assert.ok(result.error);
    });
  });

  describe('searchByAssignee', () => {
    it('searches by organization name', async () => {
      let capturedUrl;
      globalThis.fetch = async (url) => {
        capturedUrl = url;
        const body = makePatentsResponse([makePatent()]);
        const text = JSON.stringify(body);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(text),
        };
      };

      const result = await searchByAssignee('TechCorp');
      assert.ok(capturedUrl.includes('assignee_organization'));
    });
  });

  describe('briefing', () => {
    it('returns structured results across all domains', async () => {
      const body = makePatentsResponse([
        makePatent(),
        makePatent({ patent_id: 'US-99999999-B1', patent_title: 'Quantum Processor' }),
      ]);
      mockFetch(body);

      const result = await briefing();
      assert.equal(result.source, 'USPTO Patents');
      assert.ok(result.timestamp);
      assert.ok(result.searchWindow);
      assert.ok(typeof result.totalFound === 'number');
      assert.ok(result.recentPatents);
      assert.ok(result.domains);
      assert.ok(Array.isArray(result.signals));
    });

    it('detects high-activity assignee (3+ patents)', async () => {
      const patents = [
        makePatent({ assignee_organization: 'BigTech Corp' }),
        makePatent({ patent_id: 'US-2', assignee_organization: 'BigTech Corp' }),
        makePatent({ patent_id: 'US-3', assignee_organization: 'BigTech Corp' }),
      ];
      mockFetch(makePatentsResponse(patents));

      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('HIGH ACTIVITY') && s.includes('BigTech Corp')));
    });

    it('flags watch organizations', async () => {
      const patents = [
        makePatent({ assignee_organization: 'Lockheed Martin Corporation', patent_title: 'Hypersonic Vehicle' }),
      ];
      mockFetch(makePatentsResponse(patents));

      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('WATCH ORG') && s.includes('Lockheed Martin')));
    });

    it('returns default signal when no patterns detected', async () => {
      mockFetch(makePatentsResponse([]));
      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('No unusual patent filing patterns')));
      assert.equal(result.totalFound, 0);
    });

    it('handles API error gracefully', async () => {
      mockFetchError('ECONNRESET');
      const result = await briefing();
      assert.equal(result.source, 'USPTO Patents');
      assert.equal(result.totalFound, 0);
    });
  });
});
