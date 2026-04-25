import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not extract chunk between ${startMarker} and ${endMarker}`);
  }
  return source.slice(start, end);
}

const context = {
  console,
  config: {
    refreshIntervalMinutes: 15,
    llm: { provider: 'ollama', model: 'qwen', baseUrl: 'http://127.0.0.1:11434' },
    telegram: { botToken: 'x', chatId: 'y' },
    discord: { webhookUrl: 'https://discord.example/webhook' },
    debugEndpoints: { exposure: 'local-only' },
  },
  llmProvider: { model: 'qwen', isConfigured: true },
  currentLanguage: 'en',
  currentData: null,
  lastSweepTime: '2026-04-25T20:00:00.000Z',
  sweepInProgress: false,
  sweepStartedAt: null,
  buildOperatorSourceOps: snapshot => ({
    inventory: {
      total: 30,
      active: 29,
      byCategory: { social: 3, macro: 4, air: 2 },
      byLifecycle: { active: 29, shadow: 1 },
      liveStateSummary: { ok: 28, failed: 2 },
    },
  }),
  buildOperatorLlmStateContract: () => ({ status: 'applied', label: 'LLM APPLIED' }),
  getSweepWatchdogSnapshot: () => ({ timeoutMinutes: 45, timeoutMs: 2700000, pollMs: 30000 }),
  module: { exports: {} },
  exports: {},
};
vm.createContext(context);
vm.runInContext(`
  ${extractChunk('function buildOperatorSettingsContract(snapshot = null) {', '// API: current data')}
  module.exports = { buildOperatorSettingsContract };
`, context);

const { buildOperatorSettingsContract } = context.module.exports;

test('operator settings contract centralizes layout, source, llm, agent, runtime, and debug posture', () => {
  const contract = buildOperatorSettingsContract({
    agentAnalysis: {
      status: 'ready',
      confidenceLabel: 'moderate',
      tippingPoints: [{ id: 'tp-1' }, { id: 'tp-2' }],
    },
    agentAnalysisMeta: {
      source: 'llm',
      refinementState: 'completed',
      refinementCompletion: 'llm-applied',
    },
  });

  assert.equal(contract.version, 'operator-settings-v1');
  assert.equal(JSON.stringify(contract.sections), JSON.stringify(['layout', 'sources', 'llm', 'agentAnalysis', 'runtime', 'debug', 'alerts']));
  assert.equal(contract.layout.current, 'default-terminal');
  assert.equal(contract.layout.available.some(item => item.id === 'operator'), true);
  assert.equal(contract.sources.total, 30);
  assert.equal(contract.sources.active, 29);
  assert.equal(contract.sources.categories[0].category, 'macro');
  assert.equal(contract.llm.provider, 'ollama');
  assert.equal(contract.llm.requestedModeOptions.includes('force'), true);
  assert.equal(contract.agentAnalysis.current.source, 'llm');
  assert.equal(contract.agentAnalysis.current.tippingPointCount, 2);
  assert.equal(contract.runtime.refreshIntervalMinutes, 15);
  assert.equal(contract.runtime.watchdog.timeoutMinutes, 45);
  assert.equal(contract.debug.endpointExposure, 'local-only');
  assert.equal(contract.alerts.telegramEnabled, true);
  assert.equal(contract.alerts.discordEnabled, true);
  assert.match(contract.notes[0], /centralizes current operator-visible settings/i);
});
