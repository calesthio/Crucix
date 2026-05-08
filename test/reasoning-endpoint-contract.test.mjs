import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const BASE_PORT = 3237;

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
    await waitFor(healthUrl, json => Boolean(json?.sourceOps?.fusionRoles?.total), 30000);
    return await fn({
      healthUrl,
      analysisUrl: `http://127.0.0.1:${port}/api/analysis`,
      newsUrl: `http://127.0.0.1:${port}/api/brief/news`,
    });
  } finally {
    await stopChild(child);
  }
}

test('booted /api/analysis and /api/brief/news preserve reasoning metadata contract', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    },
  }, async ({ analysisUrl, newsUrl }) => {
    const analysis = await waitFor(analysisUrl, payload => Boolean(payload?.agentAnalysis?.sourceReasoning), 30000);
    assert.equal(analysis.agentAnalysis.sourceReasoning.totalSources, 30);
    assert.equal(analysis.agentAnalysis.sourceReasoning.anchorCount >= 1, true);
    assert.equal(analysis.agentAnalysis.sourceReasoning.exploratoryCount >= 1, true);
    assert.deepEqual(analysis.agentAnalysis.sourceReasoning.guidance.cautionRoles, ['exploratory']);

    const news = await waitFor(newsUrl, payload => Boolean(payload?.sourceReasoning), 30000);
    assert.equal(news.sourceReasoning.totalSources, 30);
    assert.equal(news.sourceReasoning.anchorCount >= 1, true);
    assert.equal(news.sourceReasoning.exploratoryCount >= 1, true);
    assert.deepEqual(news.sourceReasoning.guidance.groundingPriority, ['anchor', 'corroborator', 'anomaly-detector', 'context', 'exploratory']);
  });
});
