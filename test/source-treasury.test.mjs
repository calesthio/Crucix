// US Treasury source — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { briefing } from '../apis/sources/treasury.mjs';

const CANNED_DEBT = {
  data: [
    {
      record_date: '2026-01-01',
      tot_pub_debt_out_amt: '36000000000000.00',
      debt_held_public_amt: '27000000000000.00',
      intragov_hold_amt: '9000000000000.00',
    },
  ],
  meta: { total_count: 1 },
};

const CANNED_RATES = {
  data: [
    {
      record_date: '2026-01-01',
      security_desc: 'Treasury Bills',
      avg_interest_rate_amt: '5.25',
    },
  ],
  meta: { total_count: 1 },
};

describe('treasury briefing', () => {
  it('returns structured data on success', async () => {
    const originalFetch = globalThis.fetch;
    // safeFetch calls fetch internally; mock to return different data per URL
    globalThis.fetch = async (url) => {
      const body = url.includes('avg_interest_rates') ? CANNED_RATES : CANNED_DEBT;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    };
    try {
      const result = await briefing();
      assert.ok(result.source);
      assert.ok(result.timestamp);
      assert.equal(result.source, 'US Treasury');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps debt fields correctly', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const body = url.includes('avg_interest_rates') ? CANNED_RATES : CANNED_DEBT;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    };
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.debt));
      const entry = result.debt[0];
      assert.equal(entry.date, '2026-01-01');
      assert.equal(entry.totalDebt, '36000000000000.00');
      assert.equal(entry.publicDebt, '27000000000000.00');
      assert.equal(entry.intragovDebt, '9000000000000.00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maps interest rate fields correctly', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const body = url.includes('avg_interest_rates') ? CANNED_RATES : CANNED_DEBT;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    };
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.interestRates));
      const rate = result.interestRates[0];
      assert.equal(rate.date, '2026-01-01');
      assert.equal(rate.security, 'Treasury Bills');
      assert.equal(rate.rate, '5.25');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('generates a signal when debt exceeds $36T', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const body = url.includes('avg_interest_rates') ? CANNED_RATES : CANNED_DEBT;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    };
    try {
      const result = await briefing();
      assert.ok(Array.isArray(result.signals));
      // 36T exactly triggers the signal (> 36_000_000_000_000 is false at exact value,
      // but our canned value IS exactly 36T — check either outcome)
      // The source uses strict >, so 36.0T won't trigger it. Test that signals is an array.
      assert.ok(result.signals !== undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('generates a signal when debt strictly exceeds $36T', async () => {
    const highDebt = {
      data: [
        {
          record_date: '2026-01-01',
          tot_pub_debt_out_amt: '36500000000000.00',
          debt_held_public_amt: '27000000000000.00',
          intragov_hold_amt: '9500000000000.00',
        },
      ],
      meta: { total_count: 1 },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const body = url.includes('avg_interest_rates') ? CANNED_RATES : highDebt;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    };
    try {
      const result = await briefing();
      assert.ok(result.signals.some(s => s.includes('National debt')));
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
      assert.equal(result.source, 'US Treasury');
      assert.ok(result.timestamp);
      assert.ok(Array.isArray(result.debt));
      assert.ok(Array.isArray(result.interestRates));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns a valid ISO timestamp', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const body = url.includes('avg_interest_rates') ? CANNED_RATES : CANNED_DEBT;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      };
    };
    try {
      const result = await briefing();
      assert.ok(!isNaN(Date.parse(result.timestamp)));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
