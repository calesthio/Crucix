import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const BASE_PORT = 3239;

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

test('booted /api/settings exposes runtime config defaults, effective values, and env drift', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(BASE_PORT),
      REFRESH_INTERVAL_MINUTES: '21',
      DEFAULT_FRESHNESS_MINUTES: '77',
      OPENSKY_FRESHNESS_MINUTES: '12',
      DEBUG_ENDPOINT_EXPOSURE: 'open',
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const settingsUrl = `http://127.0.0.1:${BASE_PORT}/api/settings`;
    const settings = await waitFor(settingsUrl, payload => payload?.config?.contract?.version === 'runtime-config-v1', 30000);
    const contract = settings.config.contract;
    assert.equal(contract.effective.refreshIntervalMinutes, 21);
    assert.equal(contract.effective.debugEndpoints.exposure, 'open');
    assert.equal(contract.effective.freshnessPolicy.defaultFreshnessMinutes, 77);
    assert.equal(contract.effective.freshnessPolicy.sources.OpenSky.freshnessTargetMinutes, 12);
    assert.equal(contract.driftSummary.envOverrides >= 4, true);
    assert.equal(contract.validation.valid, true);
    assert.equal(contract.entries.some(entry => entry.key === 'refreshIntervalMinutes' && entry.envPresent && entry.source === 'env'), true);
    assert.equal(contract.entries.some(entry => entry.key === 'llm.provider' && entry.effectiveValue === 'ollama'), true);
  } finally {
    await stopChild(child);
  }
});
