import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE_PORT = 3244;

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
  const operatorSettingsDir = mkdtempSync(join(tmpdir(), 'crucix-cluster-repair-settings-'));
  const runsDir = mkdtempSync(join(tmpdir(), 'crucix-cluster-repair-runs-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      OPERATOR_SETTINGS_PATH: join(operatorSettingsDir, 'operator-settings.json'),
      RUNS_DIR: runsDir,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitFor(`${baseUrl}/api/health`, payload => payload?.lifecycle?.phase === 'serving' && payload?.lifecycle?.dataReady === true, 90000);
    return await fn({
      reviewUrl: `${baseUrl}/api/brief/news/review`,
      dataUrl: `${baseUrl}/api/data`,
      actionUrl: `${baseUrl}/api/review-workflow/action`,
      auditUrl: `${baseUrl}/api/review-workflow/audit`,
      adminUrl: `${baseUrl}/api/settings/admin`,
    });
  } finally {
    await stopChild(child);
  }
}

test('cluster-repair endpoints keep review and data contracts aligned after live repair actions', async () => {
  await withBootedServer({
    port: BASE_PORT,
    env: {
      DEBUG_ENDPOINT_EXPOSURE: 'local-only',
      LLM_PROVIDER: 'ollama',
      LLM_MODEL: 'llamacpp.gguf',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    },
  }, async ({ reviewUrl, dataUrl, actionUrl, auditUrl, adminUrl }) => {
    const reviewBefore = await waitFor(reviewUrl, payload => payload?.workflow?.clusterRepair?.version === 'cluster-repair-workflow-v1', 60000);
    const dataBefore = await waitFor(dataUrl, payload => payload?.reviewWorkflow?.clusterRepair?.version === 'cluster-repair-workflow-v1', 60000);
    const admin = await waitFor(adminUrl, payload => payload?.admin?.writeAuth?.token, 30000);
    const adminWriteToken = admin.admin.writeAuth.token;

    assert.equal(reviewBefore.workflow.clusterRepair.version, 'cluster-repair-workflow-v1');
    assert.equal(dataBefore.reviewWorkflow.clusterRepair.version, 'cluster-repair-workflow-v1');
    assert.equal(Array.isArray(reviewBefore.workflow.clusterRepair.supportedActions), true);
    assert.equal(reviewBefore.workflow.clusterRepair.supportedActions.includes('suppress-cluster'), true);
    assert.equal(typeof reviewBefore.workflow.clusterRepair.suppressedClusterCount, 'number');

    const weakCluster = (reviewBefore.workflow.clusterRepair.weakClusters || []).find(item => Array.isArray(item.actions) && item.actions.some(action => action.id === 'suppress-cluster'));
    if (!weakCluster) {
      assert.equal(reviewBefore.workflow.clusterRepair.weakClusters.length, 0);
      assert.equal(dataBefore.reviewWorkflow.clusterRepair.weakClusters.length, 0);
      return;
    }

    const initialSuppressedCount = reviewBefore.workflow.clusterRepair.suppressedClusterCount;
    const boundedAction = weakCluster.actions.find(action => action.id !== 'suppress-cluster') || null;
    if (boundedAction) {
      const boundedResult = await fetchJson(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
        body: JSON.stringify({
          action: boundedAction.id,
          clusterId: weakCluster.clusterId,
          targetClusterId: boundedAction.targetClusterId || undefined,
          note: 'cluster repair bounded regression action',
          localAdminNonce: adminWriteToken,
        }),
      });
      assert.equal(boundedResult.status, 200);
      assert.equal(boundedResult.body.ok, true);
      assert.equal(boundedResult.body.action, boundedAction.id);
      assert.equal(boundedResult.body.clusterId, weakCluster.clusterId);
      assert.equal(typeof boundedResult.body.decision.id, 'string');
      assert.equal(typeof boundedResult.body.audit.id, 'string');
    }

    const suppressResult = await fetchJson(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Crucix-Local-Admin-Nonce': adminWriteToken },
      body: JSON.stringify({
        action: 'suppress-cluster',
        clusterId: weakCluster.clusterId,
        note: 'cluster repair suppression regression action',
        localAdminNonce: adminWriteToken,
      }),
    });
    assert.equal(suppressResult.status, 200);
    assert.equal(suppressResult.body.ok, true);
    assert.equal(suppressResult.body.action, 'suppress-cluster');
    assert.equal(suppressResult.body.clusterId, weakCluster.clusterId);
    assert.equal(suppressResult.body.audit.status, 'applied');
    assert.equal(suppressResult.body.decision.action, 'suppress-cluster');

    const reviewAfter = await waitFor(reviewUrl, payload => {
      const clusterRepair = payload?.workflow?.clusterRepair;
      return clusterRepair?.suppressedClusterCount >= (initialSuppressedCount + 1)
        && !(clusterRepair?.weakClusters || []).some(item => item.clusterId === weakCluster.clusterId)
        && (clusterRepair?.recentDecisions || []).some(item => item.clusterId === weakCluster.clusterId && item.action === 'suppress-cluster');
    }, 30000);
    const dataAfter = await waitFor(dataUrl, payload => {
      const clusterRepair = payload?.reviewWorkflow?.clusterRepair;
      return clusterRepair?.suppressedClusterCount >= (initialSuppressedCount + 1)
        && !(clusterRepair?.weakClusters || []).some(item => item.clusterId === weakCluster.clusterId)
        && (clusterRepair?.recentDecisions || []).some(item => item.clusterId === weakCluster.clusterId && item.action === 'suppress-cluster');
    }, 30000);

    assert.equal(reviewAfter.workflow.clusterRepair.suppressedClusterCount, initialSuppressedCount + 1);
    assert.equal(dataAfter.reviewWorkflow.clusterRepair.suppressedClusterCount, initialSuppressedCount + 1);
    assert.equal(reviewAfter.workflow.clusterRepair.weakClusters.some(item => item.clusterId === weakCluster.clusterId), false);
    assert.equal(dataAfter.reviewWorkflow.clusterRepair.weakClusters.some(item => item.clusterId === weakCluster.clusterId), false);

    const audit = await waitFor(auditUrl, payload => Array.isArray(payload?.entries) && payload.entries.some(item => item.clusterId === weakCluster.clusterId && item.action === 'suppress-cluster'), 30000);
    assert.equal(audit.version, 'review-workflow-audit-v1');
    assert.equal(audit.entries.some(item => item.clusterId === weakCluster.clusterId && item.action === 'suppress-cluster' && item.status === 'applied'), true);
    if (boundedAction) {
      assert.equal(audit.entries.some(item => item.clusterId === weakCluster.clusterId && item.action === boundedAction.id), true);
    }
  });
});
