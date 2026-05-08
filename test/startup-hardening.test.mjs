import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const BASE_PORT = 3241;

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function waitFor(url, predicate, timeoutMs = 30000) {
  const started = Date.now();
  let lastError = null;
  while ((Date.now() - started) < timeoutMs) {
    try {
      const json = await fetchJson(url);
      if (!predicate || predicate(json)) return json;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
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

test('api health exposes startup validation and serving lifecycle, and shutdown exits cleanly', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(BASE_PORT),
      CRUCIX_AUTO_OPEN_BROWSER: '0',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const health = await waitFor(`http://127.0.0.1:${BASE_PORT}/api/health`, payload => payload?.lifecycle?.phase === 'serving');
    assert.equal(health.status, 'ok');
    assert.equal(health.lifecycle.phase, 'serving');
    assert.equal(health.lifecycle.ready, true);
    assert.equal(health.lifecycle.shuttingDown, false);
    assert.equal(health.startupValidation.valid, true);
    assert.equal(Array.isArray(health.startupValidation.warnings), true);
  } finally {
    await stopChild(child);
  }

  assert.equal(child.exitCode, 0);
});

test('startup validation fails fast on incomplete secret configuration', async () => {
  const port = BASE_PORT + 1;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      CRUCIX_AUTO_OPEN_BROWSER: '0',
      TELEGRAM_BOT_TOKEN: 'test',
      TELEGRAM_CHAT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  const exitCode = await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(10000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      return child.exitCode;
    }),
  ]);

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /Startup configuration validation failed/i);
  assert.match(stderr, /TELEGRAM_CHAT_ID is required/i);
});
