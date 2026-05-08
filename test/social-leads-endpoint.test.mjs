import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE_PORT = 3261;

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { status: response.status, body };
}

async function waitFor(url, predicate, timeoutMs = 90000) {
  const started = Date.now();
  let lastError = null;
  while ((Date.now() - started) < timeoutMs) {
    try {
      const response = await fetch(url);
      const json = await response.json();
      if (response.ok && (!predicate || predicate(json))) return json;
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
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-social-leads-settings-')), 'operator-settings.json'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitFor(`${baseUrl}/api/health`, payload => payload?.lifecycle?.phase === 'serving' && payload?.lifecycle?.dataReady === true, 90000);
    return await fn({
      baseUrl,
      dataUrl: `${baseUrl}/api/data`,
      socialLeadsUrl: `${baseUrl}/api/social-leads`,
      adminUrl: `${baseUrl}/api/settings/admin`,
      intakeUrl: `${baseUrl}/api/social-leads/intake`,
    });
  } finally {
    await stopChild(child);
  }
}

test('social lead endpoints accept bounded X intake and expose stored leads', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      DEBUG_ENDPOINT_EXPOSURE: 'local-only',
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    },
  }, async ({ dataUrl, socialLeadsUrl, adminUrl, intakeUrl }) => {
    const admin = await waitFor(adminUrl, payload => payload?.admin?.writeAuth?.token, 30000);
    const adminWriteToken = admin.admin.writeAuth.token;

    const dataBefore = await waitFor(dataUrl, payload => payload?.socialLeads?.version === 'social-leads-contract-v1', 30000);
    assert.equal(dataBefore.socialLeads.totalLeads, 0);
    assert.equal(dataBefore.socialLeads.capabilities.firstClassPlatforms.includes('x'), true);
    assert.equal(dataBefore.socialLeads.capabilities.acceptedAcquisitionTiers.includes('browser-assisted'), true);

    const intake = await fetchJson(intakeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Crucix-Local-Admin-Nonce': adminWriteToken,
      },
      body: JSON.stringify({
        platform: 'x',
        postUrl: 'https://x.com/example/status/2052512609719423370',
        authorHandle: 'marionawfal',
        authorDisplayName: 'Mario Nawfal',
        rawText: 'The Persian Gulf is on fire right now.',
        quotedThreadText: ['US struck Bandar Abbas', 'Iran fired back at US vessels off the UAE coast'],
        citedUrls: ['https://www.nbcnews.com/example'],
        operatorContext: 'Regression test intake',
        localAdminNonce: adminWriteToken,
      }),
    });
    assert.equal(intake.status, 201);
    assert.equal(intake.body.ok, true);
    assert.equal(intake.body.lead.version, 'social-lead-v1');
    assert.equal(intake.body.lead.source.platform, 'x');
    assert.equal(intake.body.lead.source.acquisitionTier, 'manual-url');
    assert.equal(intake.body.lead.rawEvidence.operatorContext, 'Regression test intake');

    const leads = await waitFor(socialLeadsUrl, payload => Array.isArray(payload?.leads) && payload.leads.length >= 1, 30000);
    assert.equal(leads.totalLeads >= 1, true);
    assert.equal(leads.leads[0].source.authorHandle, 'marionawfal');
    assert.equal(leads.leads[0].content.threadContext.length, 2);

    const detail = await fetchJson(`${socialLeadsUrl}/${encodeURIComponent(leads.leads[0].leadId)}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.ok, true);
    assert.equal(detail.body.lead.leadId, leads.leads[0].leadId);
    assert.equal(detail.body.lead.content.citedUrls[0], 'https://www.nbcnews.com/example');

    const degradedIntake = await fetchJson(intakeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Crucix-Local-Admin-Nonce': adminWriteToken,
      },
      body: JSON.stringify({
        platform: 'x',
        postUrl: 'https://x.com/example/status/2052512609719423372',
        authorHandle: 'gapcase',
        acquisitionTier: 'public-fetch',
        localAdminNonce: adminWriteToken,
      }),
    });
    assert.equal(degradedIntake.status, 201);
    assert.equal(degradedIntake.body.ok, true);
    assert.equal(degradedIntake.body.lead.status, 'captured-with-manual-gap');
    assert.equal(degradedIntake.body.lead.source.requestedAcquisitionTier, 'public-fetch');
    assert.equal(degradedIntake.body.lead.source.acquisitionDetail.retrievalStatus, 'manual-evidence-required');

    const dataAfter = await waitFor(dataUrl, payload => payload?.socialLeads?.totalLeads >= 2, 30000);
    assert.equal(dataAfter.socialLeads.totalLeads >= 2, true);
  });
});
