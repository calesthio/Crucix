import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const execFile = promisify(execFileCb);
const BASE_PORT = 3251;
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
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-admin-preset-settings-')), 'operator-settings.json'),
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

async function waitForStatus(session, matcher, timeoutMs = 20000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const status = await runBrowser(session, 'get', 'text', '#shellStatus');
    if (matcher.test(status)) return status;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for shell status ${matcher}`);
}

test('browser-rendered admin preset flows clone, import, delete, and persist correctly', async () => {
  const session = `crucix-admin-preset-${crypto.randomUUID()}`;
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
      await runBrowser(session, 'open', `${baseUrl}/admin/settings`);
      await runBrowser(session, 'wait', '--load', 'networkidle');
      await runBrowser(session, 'wait', '--fn', "Boolean(document.getElementById('workspacePreset') && document.getElementById('saveBtn') && !String(document.getElementById('shellStatus')?.textContent || '').startsWith('Loading'))");

      await runBrowser(session, 'eval', `window.__promptQueue = ['focusdeckbrowser', 'Focus Deck Browser', 'Browser-created custom preset']; window.prompt = () => window.__promptQueue.shift() ?? ''; window.confirm = () => true; 'ok'`);
      await runBrowser(session, 'click', '#clonePresetBtn');
      await waitForStatus(session, /Cloned preset into custom preset Focus Deck Browser/i);
      assert.equal(await runBrowser(session, 'get', 'value', '#workspacePreset'), 'focusdeckbrowser');

      await runBrowser(session, 'click', '#saveBtn');
      let settings = await waitFor(`${baseUrl}/api/settings`, payload => payload?.layout?.controls?.customPresets?.focusdeckbrowser?.label === 'Focus Deck Browser', 30000);
      assert.equal(settings.layout.controls.customPresets.focusdeckbrowser.description, 'Browser-created custom preset');

      await runBrowser(session, 'eval', `window.__presetImportPayload = { id:'importedopsdeck', label:'Imported Ops Deck', profile:'custom', description:'Imported through browser regression flow.', visualsMode:'lite', mapMode:'flat', displayMode:'desktop', densityMode:'dense', topbarMode:'compact', defaultRegion:'europe', activeLayer:'osint', panels:{ reviewQueue:{ collapsed:false, pinned:true, priority:2, size:'wide' } } }; const originalCreateElement = document.createElement.bind(document); document.createElement = function(tag){ const el = originalCreateElement(tag); if (String(tag).toLowerCase() === 'input') { const file = new File([JSON.stringify(window.__presetImportPayload)], 'imported-ops-deck.json', { type:'application/json' }); Object.defineProperty(el, 'files', { configurable:true, value:[file] }); el.click = () => setTimeout(() => el.dispatchEvent(new Event('change')), 0); } return el; }; 'ok'`);
      await runBrowser(session, 'click', '#importPresetBtn');
      await waitForStatus(session, /Imported custom preset Imported Ops Deck/i);
      assert.equal(await runBrowser(session, 'get', 'value', '#workspacePreset'), 'importedopsdeck');

      await runBrowser(session, 'click', '#saveBtn');
      settings = await waitFor(`${baseUrl}/api/settings`, payload => payload?.layout?.controls?.customPresets?.importedopsdeck?.label === 'Imported Ops Deck', 30000);
      assert.equal(settings.layout.controls.customPresets.importedopsdeck.activeLayer, 'osint');
      assert.equal(settings.layout.controls.customPresets.importedopsdeck.densityMode, 'dense');
      assert.equal(settings.layout.controls.customPresets.importedopsdeck.topbarMode, 'compact');
      assert.equal(settings.layout.controls.customPresets.importedopsdeck.panels.reviewQueue.priority, 2);

      await runBrowser(session, 'eval', `window.confirm = () => true; 'ok'`);
      await runBrowser(session, 'click', '#deleteCustomPresetBtn');
      await runBrowser(session, 'wait', '750');
      const localDeleteState = await browserJson(session, `({
        selectedPreset: document.getElementById('workspacePreset')?.value || null,
        customPresetKeys: Object.keys(window.__CRUCIX_CUSTOM_PRESETS__ || {})
      })`);
      assert.equal(localDeleteState.selectedPreset, 'importedopsdeck');
      assert.equal(localDeleteState.customPresetKeys.includes('importedopsdeck'), false);
      await runBrowser(session, 'click', '#saveBtn');
      await runBrowser(session, 'wait', '2500');
      settings = await fetchJson(`${baseUrl}/api/settings`);
      assert.equal(Object.hasOwn(settings.layout.controls.customPresets, 'importedopsdeck'), false);
      assert.equal(settings.layout.controls.customPresets.focusdeckbrowser.label, 'Focus Deck Browser');

      const summary = await browserJson(session, `({
        selectedPreset: document.getElementById('workspacePreset')?.value || null,
        optionValues: Array.from(document.querySelectorAll('#workspacePreset option')).map(option => option.value),
        status: document.getElementById('shellStatus')?.textContent?.trim() || null
      })`);
      assert.equal(summary.optionValues.includes('focusdeckbrowser'), true);
      assert.equal(summary.optionValues.includes('importedopsdeck'), false);
      assert.ok(summary.status);
    });
  } finally {
    try {
      await runBrowser(session, 'close');
    } catch {}
  }
});
