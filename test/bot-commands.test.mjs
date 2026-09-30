// Shared bot commands — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies, no network

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_COMMANDS, MARKUP, createCommandHandlers, registerCommandHandlers } from '../lib/alerts/commands.mjs';

function makeContext(state = {}) {
  let sweeps = 0;
  const ctx = {
    getState: () => ({ currentData: null, lastSweepTime: null, sweepInProgress: false, sseClientCount: 0, ...state }),
    llmProvider: null,
    memory: { getLastDelta: () => ({ summary: { direction: 'risk-off', totalChanges: 4, criticalChanges: 1 } }) },
    config: { refreshIntervalMinutes: 15, port: 3117, publicUrl: null },
    startTime: Date.now(),
    runSweep: async () => { sweeps++; },
  };
  return { ctx, sweeps: () => sweeps };
}

const SAMPLE_DATA = {
  meta: { sourcesOk: 27, sourcesQueried: 29, sourcesFailed: 2 },
  tg: { urgent: [{ text: 'Urgent post' }], posts: 12 },
  energy: { wti: 80, brent: 84, natgas: 3 },
  metals: { gold: 2400, silver: 30 },
  fred: [{ id: 'VIXCLS', value: 18 }],
  ideas: [{ type: 'long', title: 'Idea one' }],
};

describe('bot commands', () => {
  it('uses platform markup for the same content', async () => {
    const { ctx } = makeContext({ currentData: SAMPLE_DATA });
    const tg = await createCommandHandlers(ctx, MARKUP.telegram).brief();
    const dc = await createCommandHandlers(ctx, MARKUP.discord).brief();
    assert.match(tg, /^\*📋 CRUCIX BRIEF\*/);
    assert.match(dc, /^\*\*📋 CRUCIX BRIEF\*\*/);
    assert.equal(tg.replace(/\*/g, ''), dc.replace(/\*/g, ''));
  });

  it('reports source counts in status', async () => {
    const { ctx } = makeContext({ currentData: SAMPLE_DATA, sseClientCount: 3 });
    const text = await createCommandHandlers(ctx, MARKUP.discord).status();
    assert.match(text, /Sources: 27\/29 OK \(2 failed\)/);
    assert.match(text, /SSE clients: 3/);
    assert.match(text, /Dashboard: http:\/\/localhost:3117/);
  });

  it('brief waits for first sweep', async () => {
    const { ctx } = makeContext();
    assert.match(await createCommandHandlers(ctx, MARKUP.telegram).brief(), /No data yet/);
  });

  it('sweep triggers once and refuses while in progress', async () => {
    const idle = makeContext();
    assert.match(await createCommandHandlers(idle.ctx, MARKUP.telegram).sweep(), /triggered/);
    assert.equal(idle.sweeps(), 1);

    const busy = makeContext({ sweepInProgress: true });
    assert.match(await createCommandHandlers(busy.ctx, MARKUP.telegram).sweep(), /already in progress/);
    assert.equal(busy.sweeps(), 0);
  });

  it('registers every handler with the platform prefix', () => {
    const { ctx } = makeContext();
    const handlers = createCommandHandlers(ctx, MARKUP.telegram);
    const registered = [];
    registerCommandHandlers({ onCommand: name => registered.push(name) }, handlers, '/');
    assert.deepEqual(registered, ['/status', '/sweep', '/brief', '/portfolio']);
  });

  it('catalogue covers every shared handler', () => {
    const { ctx } = makeContext();
    const names = new Set(BOT_COMMANDS.map(c => c.name));
    for (const name of Object.keys(createCommandHandlers(ctx, MARKUP.discord))) {
      assert.ok(names.has(name), `${name} missing from BOT_COMMANDS`);
    }
  });
});
