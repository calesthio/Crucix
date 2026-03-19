// USAspending source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/usaspending.mjs';

// Canned responses
const AWARDS_RESPONSE = {
  results: [
    {
      'Award ID': 'CONT_AWD_001',
      'Recipient Name': 'Test Corp',
      'Award Amount': 1000000,
      'Award Type': 'Contract',
      'Awarding Agency': 'DOD',
      'Start Date': '2026-01-01',
      'Description': 'Defense systems procurement',
    },
  ],
  page_metadata: { total: 1 },
};

const AGENCY_RESPONSE = {
  results: [
    {
      agency_name: 'Department of Defense',
      budget_authority_amount: '500000000000.00',
      percentage_of_total_budget_authority: 15.2,
      obligated_amount: '480000000000.00',
      outlay_amount: '460000000000.00',
    },
  ],
};

describe('usaspending briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    // searchAwards uses POST, getAgencySpending uses GET via safeFetch
    // safeFetch calls fetch and reads .text() then JSON.parses it
    // searchAwards calls fetch directly and reads .json()
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === 'POST') {
        // searchAwards POST endpoint
        return {
          ok: true,
          status: 200,
          json: async () => AWARDS_RESPONSE,
          text: async () => JSON.stringify(AWARDS_RESPONSE),
        };
      }
      // getAgencySpending GET endpoint (via safeFetch which uses .text())
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(AGENCY_RESPONSE),
      };
    };
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.equal(result.source, 'USAspending');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.recentDefenseContracts));
      assert.ok(Array.isArray(result.topAgencies));
      // Verify the award fields are mapped correctly from string-keyed response
      if (result.recentDefenseContracts.length > 0) {
        const contract = result.recentDefenseContracts[0];
        assert.equal(contract.awardId, 'CONT_AWD_001');
        assert.equal(contract.recipient, 'Test Corp');
        assert.equal(contract.amount, 1000000);
        assert.equal(contract.agency, 'DOD');
      }
      // Verify agency data
      if (result.topAgencies.length > 0) {
        const agency = result.topAgencies[0];
        assert.equal(agency.name, 'Department of Defense');
        assert.ok(agency.budget);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles fetch failure gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network error'); };
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'USAspending');
      assert.ok(result.timestamp);
      // recentDefenseContracts should be empty array on failure
      assert.ok(Array.isArray(result.recentDefenseContracts));
      assert.equal(result.recentDefenseContracts.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'USAspending');
      // Should still have the shape even if data is empty
      assert.ok(Array.isArray(result.recentDefenseContracts));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles empty results arrays', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [], page_metadata: { total: 0 } }),
          text: async () => JSON.stringify({ results: [] }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ results: [] }),
      };
    };
    try {
      const result = await briefing();
      assert.equal(result.source, 'USAspending');
      assert.ok(Array.isArray(result.recentDefenseContracts));
      assert.equal(result.recentDefenseContracts.length, 0);
      assert.ok(Array.isArray(result.topAgencies));
      assert.equal(result.topAgencies.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
