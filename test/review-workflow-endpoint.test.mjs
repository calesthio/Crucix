import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE_PORT = 3243;

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
      OPERATOR_SETTINGS_PATH: join(mkdtempSync(join(tmpdir(), 'crucix-review-workflow-')), 'operator-settings.json'),
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
      actionUrl: `${baseUrl}/api/review-workflow/action`,
      auditUrl: `${baseUrl}/api/review-workflow/audit`,
      adminUrl: `${baseUrl}/api/settings/admin`,
    });
  } finally {
    await stopChild(child);
  }
}

test('review workflow endpoints apply bounded actions and record audit entries', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      DEBUG_ENDPOINT_EXPOSURE: 'local-only',
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    },
  }, async ({ dataUrl, actionUrl, auditUrl, adminUrl }) => {
    const data = await waitFor(dataUrl, payload => payload?.reviewWorkflow?.version === 'review-workflow-v1' && Array.isArray(payload?.reviewQueue?.items), 60000);
    const admin = await waitFor(adminUrl, payload => payload?.admin?.writeAuth?.token, 30000);
    const adminWriteToken = admin.admin.writeAuth.token;
    assert.equal(data.reviewWorkflow.endpoint, '/api/review-workflow/action');
    assert.equal(data.reviewWorkflow.auditEndpoint, '/api/review-workflow/audit');
    assert.equal(Array.isArray(data.reviewWorkflow.supportedActions), true);

    const actionableItem = (data.reviewQueue.items || []).find(item => (item.actions || []).some(action => action.id === 'ack')) || { region: 'Regression Test Region', reason: 'endpoint-regression-reason' };
    const ackResult = await fetchJson(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
      body: JSON.stringify({ action: 'ack', region: actionableItem.region, reason: actionableItem.reason, note: 'endpoint regression ack', localAdminNonce: adminWriteToken }),
    });
    assert.equal(ackResult.status, 200);
    assert.equal(ackResult.body.ok, true);
    assert.equal(ackResult.body.action, 'ack');
    assert.equal(ackResult.body.entry.region, actionableItem.region);
    assert.equal(ackResult.body.entry.reason, actionableItem.reason);
    assert.equal(ackResult.body.audit.status, 'applied');

    const snoozeResult = await fetchJson(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
      body: JSON.stringify({ action: 'snooze', region: actionableItem.region, reason: actionableItem.reason, hours: 6, note: 'endpoint regression snooze', localAdminNonce: adminWriteToken }),
    });
    assert.equal(snoozeResult.status, 200);
    assert.equal(snoozeResult.body.ok, true);
    assert.equal(snoozeResult.body.action, 'snooze');
    assert.equal(typeof snoozeResult.body.entry.expiresAt, 'string');
    assert.equal(snoozeResult.body.entry.action, 'snooze');

    const pressureAction = await fetchJson(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
      body: JSON.stringify({ action: 'ack-noise-suppression-pressure', note: 'endpoint regression pressure ack', localAdminNonce: adminWriteToken }),
    });
    assert.equal(pressureAction.status, 200);
    assert.equal(pressureAction.body.ok, true);
    assert.equal(pressureAction.body.policyKey, 'noiseSuppressionPressure');
    assert.equal(typeof pressureAction.body.disposition.acknowledgedAt, 'string');

    const sourceActionItem = (data.reviewQueue.items || []).find(item => (item.actions || []).some(action => action.id === 'suppress-source' && action.sourceId));
    if (sourceActionItem) {
      const suppressAction = sourceActionItem.actions.find(action => action.id === 'suppress-source' && action.sourceId);
      const suppressResult = await fetchJson(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
        body: JSON.stringify({ action: 'suppress-source', sourceId: suppressAction.sourceId, note: 'endpoint regression suppress', localAdminNonce: adminWriteToken }),
      });
      assert.equal(suppressResult.status, 200);
      assert.equal(suppressResult.body.ok, true);
      assert.equal(suppressResult.body.after.suppressed, true);
      assert.equal(suppressResult.body.reviewWorkflowAudit.status, 'applied');
    }

    const clusterWorkflow = data.reviewWorkflow.clusterRepair;
    assert.equal(clusterWorkflow.version, 'cluster-repair-workflow-v1');
    const weakCluster = (clusterWorkflow.weakClusters || []).find(item => Array.isArray(item.actions) && item.actions.length > 0);
    if (weakCluster) {
      const chosen = weakCluster.actions.find(action => action.id === 'suppress-cluster') || weakCluster.actions[0];
      const clusterResult = await fetchJson(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
        body: JSON.stringify({
          action: chosen.id,
          clusterId: weakCluster.clusterId,
          targetClusterId: chosen.targetClusterId || undefined,
          note: 'endpoint regression cluster action',
          localAdminNonce: adminWriteToken,
        }),
      });
      assert.equal(clusterResult.status, 200);
      assert.equal(clusterResult.body.ok, true);
      assert.equal(clusterResult.body.action, chosen.id);
      assert.equal(clusterResult.body.clusterId, weakCluster.clusterId);
      assert.equal(typeof clusterResult.body.detail, 'string');
      assert.equal(typeof clusterResult.body.decision.id, 'string');
      assert.equal(typeof clusterResult.body.audit.id, 'string');
    }

    const promoteResult = await fetchJson(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
      body: JSON.stringify({ action: 'promote-shadow', candidateId: 'shadow-candidate-regression-001', note: 'endpoint regression promote shadow', localAdminNonce: adminWriteToken }),
    });
    assert.equal(promoteResult.status, 200);
    assert.equal(promoteResult.body.ok, true);
    assert.equal(promoteResult.body.status, 'recorded-human-review');
    assert.equal(promoteResult.body.candidateId, 'shadow-candidate-regression-001');

    const audit = await waitFor(auditUrl, payload => Array.isArray(payload?.entries) && payload.entries.length >= 4, 30000);
    assert.equal(audit.version, 'review-workflow-audit-v1');
    assert.equal(audit.entries.some(item => item.action === 'ack' && item.region === actionableItem.region && item.reason === actionableItem.reason), true);
    assert.equal(audit.entries.some(item => item.action === 'snooze' && item.region === actionableItem.region && item.reason === actionableItem.reason), true);
    assert.equal(audit.entries.some(item => item.action === 'ack-noise-suppression-pressure' && item.policyKey === 'noiseSuppressionPressure' && item.targetType === 'operational-alert'), true);
    assert.equal(audit.entries.some(item => item.action === 'promote-shadow' && item.candidateId === 'shadow-candidate-regression-001' && item.status === 'recorded-human-review'), true);
    if (weakCluster) {
      assert.equal(audit.entries.some(item => item.clusterId === weakCluster.clusterId), true);
    }
  });
});
