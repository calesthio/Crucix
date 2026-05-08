import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const execFile = promisify(execFileCb);
const BASE_PORT = 3245;
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
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-ops-shell-settings-')), 'operator-settings.json'),
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

async function inspectSurface(session, baseUrl, path) {
  await runBrowser(session, 'open', `${baseUrl}${path}`);
  await runBrowser(session, 'wait', '--load', 'networkidle');
  await runBrowser(session, 'wait', '--fn', "Boolean(document.querySelector('.page-shell') && document.querySelectorAll('.nav-card').length >= 6 && !String(document.getElementById('shellStatus')?.textContent || '').startsWith('Loading'))");
  return browserJson(session, `({
    title: document.querySelector('h1')?.textContent?.trim() || null,
    subtitle: document.querySelector('.sub')?.textContent?.trim() || null,
    status: document.getElementById('shellStatus')?.textContent?.trim() || null,
    navCount: document.querySelectorAll('.nav-card').length,
    activeHref: document.querySelector('.nav-card.active')?.getAttribute('href') || null,
    activeLabel: document.querySelector('.nav-card.active .nav-card-title span')?.textContent?.trim() || null,
    actionIds: Array.from(document.querySelectorAll('#shellActions .pill')).map(el => el.id || el.textContent.trim()),
    hasSaveBtn: Boolean(document.getElementById('saveBtn')),
    hasExportBtn: Boolean(document.getElementById('exportBtn')),
    hasExportBundleBtn: Boolean(document.getElementById('exportBundleBtn')),
    hasImportBtn: Boolean(document.getElementById('importBtn')),
    hasRestartBtn: Boolean(document.getElementById('restartBtn')),
    hasStopBtn: Boolean(document.getElementById('stopBtn')),
    bodyText: document.body.innerText
  })`);
}

test('browser-rendered ops shell preserves active nav, boundary copy, and admin control separation across shared surfaces', async () => {
  const session = `crucix-ops-shell-${crypto.randomUUID()}`;
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
      const settings = await inspectSurface(session, baseUrl, '/settings');
      assert.equal(settings.navCount, 6);
      assert.equal(settings.activeHref, '/settings');
      assert.equal(settings.activeLabel, 'Operator settings');
      assert.equal(settings.hasSaveBtn, false);
      assert.equal(settings.actionIds.includes('Raw JSON'), true);
      assert.match(settings.subtitle || '', /read-only operator view/i);
      assert.match(settings.bodyText || '', /Persisted writes, export\/import, and debug-adjacent controls are intentionally separated/i);

      const sourceOps = await inspectSurface(session, baseUrl, '/source-ops');
      assert.equal(sourceOps.navCount, 6);
      assert.equal(sourceOps.activeHref, '/source-ops');
      assert.equal(sourceOps.activeLabel, 'Source ops');
      assert.match(sourceOps.bodyText || '', /source management console/i);

      const diagnostics = await inspectSurface(session, baseUrl, '/diagnostics');
      assert.equal(diagnostics.navCount, 6);
      assert.equal(diagnostics.activeHref, '/diagnostics');
      assert.equal(diagnostics.activeLabel, 'Diagnostics');
      assert.match(diagnostics.bodyText || '', /Runtime and review diagnostics/i);

      const llmOps = await inspectSurface(session, baseUrl, '/llm-ops');
      assert.equal(llmOps.navCount, 6);
      assert.equal(llmOps.activeHref, '/llm-ops');
      assert.equal(llmOps.activeLabel, 'LLM ops');
      assert.match(llmOps.bodyText || '', /Provider health and fallback operations/i);

      const admin = await inspectSurface(session, baseUrl, '/admin/settings');
      assert.equal(admin.navCount, 6);
      assert.equal(admin.activeHref, '/admin/settings');
      assert.equal(admin.activeLabel, 'Admin settings');
      assert.equal(admin.hasSaveBtn, true);
      assert.equal(admin.hasExportBtn, true);
      assert.equal(admin.hasExportBundleBtn, true);
      assert.equal(admin.hasImportBtn, true);
      assert.equal(admin.hasRestartBtn, true);
      assert.equal(admin.hasStopBtn, true);
      assert.match(admin.subtitle || '', /local-only admin writes, export\/import, and other debug-adjacent control-plane actions/i);
      assert.match(admin.bodyText || '', /Recent admin audit/i);
      assert.match(admin.bodyText || '', /Runtime control/i);
    });
  } finally {
    try {
      await runBrowser(session, 'close');
    } catch {}
  }
});
