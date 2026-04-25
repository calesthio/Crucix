import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const BASE_PORT = 3238;

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
    await waitFor(healthUrl, json => Boolean(json?.sourceOps?.inventory?.total), 30000);
    return await fn({
      settingsUrl: `http://127.0.0.1:${port}/api/settings`,
      pageUrl: `http://127.0.0.1:${port}/settings`,
    });
  } finally {
    await stopChild(child);
  }
}

test('booted /api/settings centralizes operator settings contract and /settings serves the UI shell', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      DEBUG_ENDPOINT_EXPOSURE: 'local-only',
    },
  }, async ({ settingsUrl, pageUrl }) => {
    const settings = await waitFor(settingsUrl, payload => payload?.version === 'operator-settings-v1', 30000);
    assert.deepEqual(settings.sections, ['layout', 'sources', 'llm', 'agentAnalysis', 'runtime', 'debug', 'alerts', 'config', 'persistence']);
    assert.equal(settings.layout.current, 'default-terminal');
    assert.equal(settings.sources.total >= 1, true);
    assert.equal(Array.isArray(settings.sources.categories), true);
    assert.equal(settings.llm.provider, 'ollama');
    assert.equal(settings.llm.requestedModeOptions.includes('auto'), true);
    assert.equal(settings.runtime.refreshIntervalMinutes >= 1, true);
    assert.equal(settings.debug.endpointExposure, 'local-only');
    assert.equal(settings.config.contract.version, 'runtime-config-v1');
    assert.equal(settings.config.validation.valid, true);
    assert.equal(settings.config.driftSummary.envOverrides >= 1, true);
    assert.equal(settings.sources.selection.supportsPerSourceControl, true);
    assert.equal(Array.isArray(settings.sources.availableSources), true);
    assert.equal(settings.persistence.capabilities.export, true);
    assert.equal(settings.persistence.capabilities.writeApi, true);

    const page = await fetch(pageUrl).then(r => r.text());
    assert.match(page, /Settings control plane/i);
    assert.match(page, /\/api\/settings/);
  });
});
