// OFAC source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/ofac.mjs';

// OFAC returns XML, so safeFetch falls back to { rawText: '...' }
const XML_RESPONSE = '<SDN_LIST><Publish_Date>01/01/2026</Publish_Date><sdnEntry><uid>1234</uid><lastName>TEST PERSON</lastName><sdnType>Individual</sdnType></sdnEntry></SDN_LIST>';

describe('ofac briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    // Return XML text — safeFetch will fail JSON.parse and wrap as { rawText }
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => XML_RESPONSE,
    });
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'OFAC Sanctions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses publishDate from XML', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => XML_RESPONSE,
    });
    try {
      const result = await briefing();
      assert.equal(result.sdnList.publishDate, '01/01/2026');
      assert.equal(result.advancedList.publishDate, '01/01/2026');
      assert.equal(result.lastUpdated, '01/01/2026');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('counts sdnEntry elements', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => XML_RESPONSE,
    });
    try {
      const result = await briefing();
      assert.equal(result.sdnList.entryCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('extracts sampleEntries from XML', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => XML_RESPONSE,
    });
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.sampleEntries));
      assert.equal(result.sampleEntries.length, 1);
      assert.equal(result.sampleEntries[0].uid, '1234');
      assert.equal(result.sampleEntries[0].name, 'TEST PERSON');
      assert.equal(result.sampleEntries[0].type, 'Individual');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exposes endpoint URLs', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => XML_RESPONSE,
    });
    try {
      const result = await briefing();
      assert.ok(result.endpoints.sdnXml);
      assert.ok(result.endpoints.sdnAdvanced);
      assert.ok(result.endpoints.consolidatedAdvanced);
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
      assert.equal(result.source, 'OFAC Sanctions');
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
      assert.equal(result.source, 'OFAC Sanctions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
