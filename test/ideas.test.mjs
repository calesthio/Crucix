// LLM Ideas — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';

// ─── Mock LLM Provider ───

function mockProvider(responseText, { configured = true, shouldThrow = false } = {}) {
  return {
    get isConfigured() { return configured; },
    async complete(systemPrompt, userMessage, opts) {
      if (shouldThrow) throw new Error('LLM request failed');
      return { text: responseText, usage: { inputTokens: 100, outputTokens: 50 }, model: 'test-model' };
    },
  };
}

// ─── Sample Data ───

const minimalSweep = {
  fred: [
    { id: 'VIXCLS', value: 18.5, momChange: 2.1 },
    { id: 'DGS10', value: 4.25, momChange: -0.1 },
  ],
  energy: { wti: 72.5, brent: 76.3, natgas: 2.15, crudeStocks: 450 },
  metals: { gold: 2340, silver: 28.5, goldChangePct: 1.2, silverChangePct: -0.5 },
};

const sampleDelta = {
  summary: { direction: 'escalating', totalChanges: 5, criticalChanges: 1 },
  signals: {
    escalated: [{ label: 'VIX', previous: 16.0, current: 18.5, changePct: 15.6 }],
    new: [{ label: 'Gold surge', text: 'Gold breaks 2340' }],
  },
};

const validIdeas = [
  {
    title: 'Long Gold on Geopolitical Risk',
    type: 'LONG',
    ticker: 'GLD',
    confidence: 'HIGH',
    rationale: 'Gold surging with VIX elevated.',
    risk: 'Dollar strength',
    horizon: 'Weeks',
    signals: ['gold_price', 'vix'],
  },
  {
    title: 'Short Crude on Demand Weakness',
    type: 'SHORT',
    ticker: 'CL',
    confidence: 'MEDIUM',
    rationale: 'Crude stocks building.',
    risk: 'OPEC cuts',
    horizon: 'Days',
    signals: ['crude_stocks'],
  },
];

// ─── Tests ───

describe('generateLLMIdeas', () => {
  it('should return null when provider is not configured', async () => {
    const provider = mockProvider('', { configured: false });
    const result = await generateLLMIdeas(provider, minimalSweep, null);
    assert.equal(result, null);
  });

  it('should return null when provider is null', async () => {
    const result = await generateLLMIdeas(null, minimalSweep, null);
    assert.equal(result, null);
  });

  it('should return null when provider is undefined', async () => {
    const result = await generateLLMIdeas(undefined, minimalSweep, null);
    assert.equal(result, null);
  });

  it('should parse valid JSON array response', async () => {
    const provider = mockProvider(JSON.stringify(validIdeas));
    const result = await generateLLMIdeas(provider, minimalSweep, sampleDelta);

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Long Gold on Geopolitical Risk');
    assert.equal(result[0].type, 'LONG');
    assert.equal(result[0].ticker, 'GLD');
    assert.equal(result[0].confidence, 'HIGH');
    assert.equal(result[0].source, 'llm');
    assert.equal(result[1].title, 'Short Crude on Demand Weakness');
  });

  it('should handle markdown-wrapped JSON response', async () => {
    const wrapped = '```json\n' + JSON.stringify(validIdeas) + '\n```';
    const provider = mockProvider(wrapped);
    const result = await generateLLMIdeas(provider, minimalSweep, sampleDelta);

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
  });

  it('should filter ideas missing required fields', async () => {
    const mixed = [
      { title: 'Valid Idea', type: 'LONG', confidence: 'HIGH' },
      { title: 'No Type', confidence: 'LOW' },         // missing type
      { type: 'SHORT', confidence: 'LOW' },             // missing title
      { title: 'No Confidence', type: 'WATCH' },        // missing confidence
    ];
    const provider = mockProvider(JSON.stringify(mixed));
    const result = await generateLLMIdeas(provider, minimalSweep, null);

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Valid Idea');
  });

  it('should return null on empty array response', async () => {
    const provider = mockProvider('[]');
    const result = await generateLLMIdeas(provider, minimalSweep, null);
    assert.equal(result, null);
  });

  it('should return null on non-array JSON response', async () => {
    const provider = mockProvider('{"not":"an array"}');
    const result = await generateLLMIdeas(provider, minimalSweep, null);
    assert.equal(result, null);
  });

  it('should return null on completely invalid response', async () => {
    const provider = mockProvider('This is not JSON at all');
    const result = await generateLLMIdeas(provider, minimalSweep, null);
    assert.equal(result, null);
  });

  it('should return null when LLM provider throws', async () => {
    const provider = mockProvider('', { shouldThrow: true });
    const result = await generateLLMIdeas(provider, minimalSweep, sampleDelta);
    assert.equal(result, null);
  });

  it('should extract JSON array from mixed text', async () => {
    const mixed = 'Here are my ideas:\n' + JSON.stringify(validIdeas) + '\n\nThese are based on...';
    const provider = mockProvider(mixed);
    const result = await generateLLMIdeas(provider, minimalSweep, null);

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
  });

  it('should handle null delta gracefully', async () => {
    const provider = mockProvider(JSON.stringify(validIdeas));
    const result = await generateLLMIdeas(provider, minimalSweep, null);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
  });

  it('should pass previousIdeas for dedup', async () => {
    let capturedUserMessage = '';
    const provider = {
      get isConfigured() { return true; },
      async complete(systemPrompt, userMessage) {
        capturedUserMessage = userMessage;
        return { text: JSON.stringify(validIdeas), usage: { inputTokens: 10, outputTokens: 5 }, model: 'test' };
      },
    };

    const previousIdeas = [{ title: 'Old Idea', type: 'LONG' }];
    await generateLLMIdeas(provider, minimalSweep, null, previousIdeas);

    assert.ok(capturedUserMessage.includes('PREVIOUS_IDEAS'));
    assert.ok(capturedUserMessage.includes('Old Idea'));
  });

  it('should compact sweep data with all sections', async () => {
    let capturedUserMessage = '';
    const provider = {
      get isConfigured() { return true; },
      async complete(systemPrompt, userMessage) {
        capturedUserMessage = userMessage;
        return { text: JSON.stringify(validIdeas), usage: { inputTokens: 10, outputTokens: 5 }, model: 'test' };
      },
    };

    const fullSweep = {
      ...minimalSweep,
      bls: [{ id: 'UNRATE', value: '3.8' }],
      treasury: 34.5,
      gscpi: { value: 0.5, interpretation: 'neutral' },
      tg: { urgent: [{ text: 'Major conflict escalation in region X' }] },
      thermal: [{ region: 'Eastern Europe', det: 15, hc: 3 }],
      air: [{ region: 'Baltic', total: 45 }],
      nuke: [{ site: 'Zaporizhzhia', cpm: 150, anom: true }],
      who: [{ title: 'Avian Flu Outbreak Alert' }],
      defense: [{ amount: 500000000, recipient: 'Lockheed Martin' }],
    };

    await generateLLMIdeas(provider, fullSweep, sampleDelta);

    assert.ok(capturedUserMessage.includes('ECONOMIC'));
    assert.ok(capturedUserMessage.includes('ENERGY'));
    assert.ok(capturedUserMessage.includes('METALS'));
    assert.ok(capturedUserMessage.includes('LABOR'));
    assert.ok(capturedUserMessage.includes('TREASURY'));
    assert.ok(capturedUserMessage.includes('SUPPLY_CHAIN'));
    assert.ok(capturedUserMessage.includes('URGENT_OSINT'));
    assert.ok(capturedUserMessage.includes('THERMAL'));
    assert.ok(capturedUserMessage.includes('AIR_ACTIVITY'));
    assert.ok(capturedUserMessage.includes('NUCLEAR_ANOMALY'));
    assert.ok(capturedUserMessage.includes('WHO_ALERTS'));
    assert.ok(capturedUserMessage.includes('DEFENSE_CONTRACTS'));
    assert.ok(capturedUserMessage.includes('DELTA_SINCE_LAST_SWEEP'));
    assert.ok(capturedUserMessage.includes('ESCALATED'));
    assert.ok(capturedUserMessage.includes('NEW_SIGNALS'));
  });

  it('should set defaults for missing idea fields', async () => {
    const sparseIdeas = [{ title: 'Sparse', type: 'WATCH', confidence: 'LOW' }];
    const provider = mockProvider(JSON.stringify(sparseIdeas));
    const result = await generateLLMIdeas(provider, minimalSweep, null);

    assert.equal(result[0].ticker, '');
    assert.equal(result[0].rationale, '');
    assert.equal(result[0].risk, '');
    assert.equal(result[0].horizon, '');
    assert.deepEqual(result[0].signals, []);
    assert.equal(result[0].source, 'llm');
  });

  it('should handle empty/null response text', async () => {
    const provider = mockProvider('');
    const result = await generateLLMIdeas(provider, minimalSweep, null);
    assert.equal(result, null);
  });
});
