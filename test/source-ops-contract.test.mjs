import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profile = JSON.parse(readFileSync(new URL('../source-ops/profile.json', import.meta.url), 'utf8'));
const registry = JSON.parse(readFileSync(new URL('../source-ops/source-registry.seed.json', import.meta.url), 'utf8'));
const taskSchema = JSON.parse(readFileSync(new URL('../source-ops/schemas/task-packet.schema.json', import.meta.url), 'utf8'));
const resultSchema = JSON.parse(readFileSync(new URL('../source-ops/schemas/result-envelope.schema.json', import.meta.url), 'utf8'));
const exampleTask = JSON.parse(readFileSync(new URL('../source-ops/tasks/example-discovery-task.json', import.meta.url), 'utf8'));
const pendingQueue = JSON.parse(readFileSync(new URL('../source-ops/queue/pending.json', import.meta.url), 'utf8'));
const reviewedQueue = JSON.parse(readFileSync(new URL('../source-ops/queue/reviewed.json', import.meta.url), 'utf8'));

function hasRequiredKeys(obj, required) {
  for (const key of required) assert.ok(key in obj, `missing required key ${key}`);
}

test('source ops profile aligns with the chosen file-first and human-gated promotion policy', () => {
  assert.equal(profile.version, 'source-ops-profile-v1');
  assert.equal(profile.approvalPolicy.contractMode, 'file-first');
  assert.equal(profile.approvalPolicy.preProductionAutoAdvanceMax, 'shadow');
  assert.equal(profile.approvalPolicy.activePromotionRequiresHumanApproval, true);
  assert.equal(profile.discipline.productionMutationsAllowed, false);
  assert.ok(profile.allowedRoles.includes('discovery'));
  assert.ok(profile.allowedRoles.includes('grading'));
  assert.equal(registry.version, 'source-registry-v1');
});

test('example source ops task packet matches the workspace contract', () => {
  assert.equal(exampleTask.version, 'source-ops-task-v1');
  hasRequiredKeys(exampleTask, taskSchema.required);
  assert.ok(profile.allowedRoles.includes(exampleTask.role));
  assert.equal(exampleTask.policy.contractMode, 'file-first');
  assert.equal(exampleTask.policy.productionMutationsAllowed, false);
  assert.equal(exampleTask.policy.activePromotionRequiresHumanApproval, true);
  assert.equal(exampleTask.io.registryPath, profile.registryPath);
});

test('result schema and queue scaffolding exist for bounded subagent workflows', () => {
  assert.equal(resultSchema.properties.version.const, 'source-ops-result-v1');
  assert.equal(pendingQueue.version, 'source-ops-queue-v1');
  assert.equal(reviewedQueue.version, 'source-ops-queue-v1');
  assert.ok(Array.isArray(pendingQueue.tasks));
  assert.ok(Array.isArray(reviewedQueue.tasks));
});

test('registry lifecycle policy and profile lifecycle policy agree on human approval boundary', () => {
  const lifecycleStates = new Set(profile.lifecyclePolicy.states);
  for (const source of registry.sources) {
    assert.ok(lifecycleStates.has(source.lifecycle), `unknown lifecycle state ${source.lifecycle}`);
  }
  assert.ok(profile.lifecyclePolicy.agentWritableStates.includes('shadow'));
  assert.ok(profile.lifecyclePolicy.humanApprovalRequiredFor.includes('active'));
});
