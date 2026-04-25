import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const BASE_PORT = 3227;

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function waitFor(url, predicate, timeoutMs = 90000) {
  const started = Date.now();
  let lastError = null;
  while ((Date.now() - started) < timeoutMs) {
    try {
      const json = await fetchJson(url);
      if (!predicate || predicate(json)) return json;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(5000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
}

async function withBootedServer({ port, env }, fn) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    await waitFor(healthUrl, json => Boolean(json?.llmState?.version), 30000);
    return await fn({
      healthUrl,
      dataUrl: `http://127.0.0.1:${port}/api/data`,
      briefUrl: `http://127.0.0.1:${port}/api/brief/compact`,
    });
  } finally {
    await stopChild(child);
  }
}

test('booted runtime matrix reports unavailable contract when no LLM provider is configured', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      LLM_PROVIDER: '',
      LLM_MODEL: '',
    },
  }, async ({ healthUrl, dataUrl, briefUrl }) => {
    for (const url of [healthUrl, dataUrl, briefUrl]) {
      const json = await waitFor(url, payload => Boolean(payload?.llmState?.version), 30000);
      assert.equal(json.llmState.version, 'llm-operator-state-v1');
      assert.equal(json.llmState.status, 'unavailable');
      assert.equal(json.llmState.label, 'LLM UNAVAILABLE');
      assert.equal(json.llmState.support.analysis.supported, false);
      assert.equal(json.llmState.support.ideas.supported, false);
      assert.equal(json.llmState.participation.analysis.participated, false);
      assert.equal(json.llmState.participation.ideas.participated, false);
      assert.equal(json.runtimeLlm.status, json.llmState.status);
    }
  });
});

test('booted runtime matrix reports configured static-by-design ideas contract when provider is configured', async () => {
  await withBootedServer({
    port: BASE_PORT + 1,
    env: {
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    },
  }, async ({ healthUrl, dataUrl, briefUrl }) => {
    for (const url of [healthUrl, dataUrl, briefUrl]) {
      const json = await waitFor(url, payload => Boolean(payload?.llmState?.version), 30000);
      assert.equal(json.llmState.version, 'llm-operator-state-v1');
      assert.equal(json.llmState.support.ideas.supported, true);
      assert.equal(json.llmState.support.ideas.available, true);
      assert.equal(json.llmState.participation.ideas.attempted, false);
      assert.equal(json.llmState.participation.ideas.participated, false);
      assert.equal(json.llmState.surfaces.ideas.reason, 'static-by-design');
      assert.equal(json.llmState.surfaces.ideas.label, 'STATIC BY DESIGN');
      assert.equal(json.runtimeLlm.status, json.llmState.status);
    }
  });
});
