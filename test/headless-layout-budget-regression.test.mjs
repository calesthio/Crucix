import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const execFile = promisify(execFileCb);
const BASE_PORT = 3261;
const AGENT_BROWSER = '/opt/homebrew/bin/agent-browser';

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
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-layout-budget-settings-')), 'operator-settings.json'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    await waitFor(healthUrl, payload => payload?.lifecycle?.phase === 'serving' && payload?.lifecycle?.dataReady === true, 90000);
    return await fn({ baseUrl: `http://127.0.0.1:${port}` });
  } finally {
    await stopChild(child);
  }
}

async function runBrowser(session, ...args) {
  const { stdout } = await execFile(AGENT_BROWSER, ['--session', session, ...args], {
    cwd: new URL('..', import.meta.url).pathname,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function browserJson(session, expression) {
  const output = await runBrowser(session, 'eval', `JSON.stringify(${expression})`);
  return JSON.parse(JSON.parse(output));
}

function pct(value) {
  return Number.parseFloat(String(value || '0').replace('%', ''));
}

async function capturePreset(session, presetId, viewport, expectedLayoutMode) {
  await runBrowser(session, 'set', 'viewport', String(viewport.width), String(viewport.height));
  await runBrowser(session, 'eval', `applyWorkspacePreset('${presetId}'); 'ok'`);
  await runBrowser(session, 'wait', '1200');
  await runBrowser(session, 'wait', '--fn', `document.body.dataset.layoutMode === '${expectedLayoutMode}' && document.body.dataset.topbarMode && window.getLayoutBudgetSnapshot && getLayoutBudgetSnapshot().mapHeight > 0`);
  return browserJson(session, `({
    preset: '${presetId}',
    densityMode: document.body.dataset.densityMode || null,
    topbarMode: document.body.dataset.topbarMode || null,
    snapshot: getLayoutBudgetSnapshot()
  })`);
}

test('headless browser layout-budget measurements stay within bounded preset thresholds', async () => {
  const session = `crucix-layout-budget-${crypto.randomUUID()}`;
  try {
    await withBootedServer({
      port: BASE_PORT,
      env: {
        DEBUG_ENDPOINT_EXPOSURE: 'local-only',
        LLM_PROVIDER: 'ollama',
        LLM_MODEL: 'llamacpp.gguf',
        OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      },
    }, async ({ baseUrl }) => {
      await runBrowser(session, 'open', `${baseUrl}/`);
      await runBrowser(session, 'wait', '3000');
      await runBrowser(session, 'wait', '--fn', "Boolean(window.getLayoutBudgetSnapshot && document.getElementById('topbar') && document.getElementById('mapContainer') && document.getElementById('lowerGrid'))");

      const operator = await capturePreset(session, 'operator', { width: 1440, height: 1024 }, 'desktop');
      const diagnostics = await capturePreset(session, 'diagnostics', { width: 1440, height: 1024 }, 'desktop');
      const wallboard = await capturePreset(session, 'executive-briefing', { width: 1920, height: 1080 }, 'wallboard');

      assert.equal(operator.densityMode, 'balanced');
      assert.equal(operator.topbarMode, 'standard');
      assert.ok(pct(operator.snapshot.topbarShare) <= 12, `operator topbar share too large: ${operator.snapshot.topbarShare}`);
      assert.ok(pct(operator.snapshot.mapShare) <= 60, `operator map share too large: ${operator.snapshot.mapShare}`);
      assert.ok(pct(operator.snapshot.firstScreenShare) <= 70, `operator first-screen share too large: ${operator.snapshot.firstScreenShare}`);
      assert.ok(Number(operator.snapshot.remainingViewport) >= 250, `operator remaining viewport too small: ${operator.snapshot.remainingViewport}`);

      assert.equal(diagnostics.densityMode, 'dense');
      assert.equal(diagnostics.topbarMode, 'compact');
      assert.ok(diagnostics.snapshot.topbarHeight <= operator.snapshot.topbarHeight, 'diagnostics topbar should not exceed operator topbar height');
      assert.ok(diagnostics.snapshot.mapHeight < operator.snapshot.mapHeight, 'diagnostics map should be tighter than operator map');
      assert.ok(pct(diagnostics.snapshot.mapShare) <= 50, `diagnostics map share too large: ${diagnostics.snapshot.mapShare}`);
      assert.ok(pct(diagnostics.snapshot.firstScreenShare) <= 60, `diagnostics first-screen share too large: ${diagnostics.snapshot.firstScreenShare}`);
      assert.ok(Number(diagnostics.snapshot.remainingViewport) >= 350, `diagnostics remaining viewport too small: ${diagnostics.snapshot.remainingViewport}`);

      assert.equal(wallboard.densityMode, 'briefing');
      assert.equal(wallboard.topbarMode, 'briefing');
      assert.ok(wallboard.snapshot.virtualizedPanelCount >= 1, 'wallboard should activate at least one virtualized panel in headless mode');
      assert.ok(pct(wallboard.snapshot.topbarShare) <= 18, `wallboard topbar share too large: ${wallboard.snapshot.topbarShare}`);
      assert.ok(pct(wallboard.snapshot.mapShare) <= 73, `wallboard map share too large: ${wallboard.snapshot.mapShare}`);
      assert.ok(pct(wallboard.snapshot.firstScreenShare) <= 90, `wallboard first-screen share too large: ${wallboard.snapshot.firstScreenShare}`);
      assert.ok(Number(wallboard.snapshot.remainingViewport) >= 80, `wallboard remaining viewport too small: ${wallboard.snapshot.remainingViewport}`);
    });
  } finally {
    try {
      await runBrowser(session, 'close');
    } catch {}
  }
});
