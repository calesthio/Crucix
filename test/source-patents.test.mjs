// USPTO Patents source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/patents.mjs';

const CANNED_RESPONSE = {
  patents: [
    {
      patent_id: 'US123456',
      patent_title: 'Test Patent',
      patent_date: '2026-01-01',
      assignees: [{ assignee_organization: 'Test Corp' }],
      assignee_organization: 'Test Corp',
      patent_type: 'utility',
      patent_abstract: 'A test patent abstract',
    },
  ],
  total_patent_count: 1,
};

describe('patents briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'USPTO Patents');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns recentPatents keyed by domain', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.ok(result.recentPatents);
      assert.ok(typeof result.recentPatents === 'object');
      // 7 strategic domains defined in source
      const domainKeys = Object.keys(result.recentPatents);
      assert.equal(domainKeys.length, 7);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('compacts patent fields correctly', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      // Pick any domain that has patents
      const domains = Object.values(result.recentPatents);
      const anyWithPatents = domains.find(p => p.length > 0);
      assert.ok(anyWithPatents);
      const patent = anyWithPatents[0];
      assert.equal(patent.id, 'US123456');
      assert.equal(patent.title, 'Test Patent');
      assert.equal(patent.date, '2026-01-01');
      assert.equal(patent.assignee, 'Test Corp');
      assert.equal(patent.type, 'utility');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns totalFound count', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.equal(typeof result.totalFound, 'number');
      // 7 domains × 1 patent each
      assert.equal(result.totalFound, 7);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('includes domains map with labels', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.ok(result.domains);
      assert.ok(result.domains.ai);
      assert.ok(result.domains.quantum);
      assert.ok(result.domains.semiconductor);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns signals array', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(CANNED_RESPONSE),
    });
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.signals));
      assert.ok(result.signals.length > 0);
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
      assert.equal(result.source, 'USPTO Patents');
      assert.equal(result.totalFound, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles HTTP error response gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    });
    try {
      const result = await briefing();
      assert.ok(result !== undefined);
      assert.equal(result.source, 'USPTO Patents');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
