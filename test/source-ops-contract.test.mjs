import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const profile = JSON.parse(readFileSync(new URL('../source-ops/profile.json', import.meta.url), 'utf8'));
const registry = JSON.parse(readFileSync(new URL('../source-ops/source-registry.seed.json', import.meta.url), 'utf8'));
const taskSchema = JSON.parse(readFileSync(new URL('../source-ops/schemas/task-packet.schema.json', import.meta.url), 'utf8'));
const resultSchema = JSON.parse(readFileSync(new URL('../source-ops/schemas/result-envelope.schema.json', import.meta.url), 'utf8'));
const scorecardSchema = JSON.parse(readFileSync(new URL('../source-ops/schemas/scorecard.schema.json', import.meta.url), 'utf8'));
const overlapSchema = JSON.parse(readFileSync(new URL('../source-ops/schemas/overlap-assessment.schema.json', import.meta.url), 'utf8'));
const pruningSchema = JSON.parse(readFileSync(new URL('../source-ops/schemas/pruning-assessment.schema.json', import.meta.url), 'utf8'));
const gradingRubric = JSON.parse(readFileSync(new URL('../source-ops/grading-rubric.json', import.meta.url), 'utf8'));
const overlapRubric = JSON.parse(readFileSync(new URL('../source-ops/overlap-rubric.json', import.meta.url), 'utf8'));
const pruningRubric = JSON.parse(readFileSync(new URL('../source-ops/pruning-rubric.json', import.meta.url), 'utf8'));
const actionTaxonomy = JSON.parse(readFileSync(new URL('../source-ops/action-taxonomy.json', import.meta.url), 'utf8'));
const exampleTask = JSON.parse(readFileSync(new URL('../source-ops/tasks/example-discovery-task.json', import.meta.url), 'utf8'));
const exampleGradingTask = JSON.parse(readFileSync(new URL('../source-ops/tasks/example-grading-task.json', import.meta.url), 'utf8'));
const exampleOverlapTask = JSON.parse(readFileSync(new URL('../source-ops/tasks/example-overlap-task.json', import.meta.url), 'utf8'));
const examplePruningTask = JSON.parse(readFileSync(new URL('../source-ops/tasks/example-pruning-task.json', import.meta.url), 'utf8'));
const exampleGradingScorecard = JSON.parse(readFileSync(new URL('../source-ops/results/grading/example-grading-scorecard.json', import.meta.url), 'utf8'));
const exampleOverlapAssessment = JSON.parse(readFileSync(new URL('../source-ops/results/overlap/example-overlap-maritime-001.json', import.meta.url), 'utf8'));
const examplePruningAssessment = JSON.parse(readFileSync(new URL('../source-ops/results/pruning/example-pruning-social-001.json', import.meta.url), 'utf8'));
const exampleLifecycleEvaluation = JSON.parse(readFileSync(new URL('../source-ops/results/onboarding-prep/example-lifecycle-evaluation-maritime-001.json', import.meta.url), 'utf8'));
const pendingQueue = JSON.parse(readFileSync(new URL('../source-ops/queue/pending.json', import.meta.url), 'utf8'));
const reviewedQueue = JSON.parse(readFileSync(new URL('../source-ops/queue/reviewed.json', import.meta.url), 'utf8'));

const roleFiles = {
  discovery: '../source-ops/roles/discovery.md',
  validation: '../source-ops/roles/validation.md',
  grading: '../source-ops/roles/grading.md',
  overlap: '../source-ops/roles/overlap.md',
  pruning: '../source-ops/roles/pruning.md',
  'onboarding-prep': '../source-ops/roles/onboarding-prep.md',
};

const taskTemplates = {
  discovery: '../source-ops/tasks/example-discovery-task.json',
  validation: '../source-ops/tasks/example-validation-task.json',
  grading: '../source-ops/tasks/example-grading-task.json',
  overlap: '../source-ops/tasks/example-overlap-task.json',
  pruning: '../source-ops/tasks/example-pruning-task.json',
  'onboarding-prep': '../source-ops/tasks/example-onboarding-prep-task.json',
};

function hasRequiredKeys(obj, required) {
  for (const key of required) assert.ok(key in obj, `missing required key ${key}`);
}

test('source ops profile aligns with the chosen file-first and human-gated promotion policy', () => {
  assert.equal(profile.version, 'source-ops-profile-v1');
  assert.equal(profile.approvalPolicy.contractMode, 'file-first');
  assert.equal(profile.approvalPolicy.preProductionAutoAdvanceMax, 'shadow');
  assert.equal(profile.approvalPolicy.activePromotionRequiresHumanApproval, true);
  assert.equal(profile.transitionPolicy.defaultEntryState, 'candidate');
  assert.equal(profile.transitionPolicy.policySource, 'source-ops/lifecycle-transition-policy.json');
  assert.deepEqual(profile.transitionPolicy.agentMayAutoAdvanceTo, ['researched', 'graded', 'shadow']);
  assert.equal(profile.shadowPolicy.productionInfluenceBlocked, true);
  assert.equal(profile.shadowPolicy.minimumPromotionReadiness, 'shadow-ready');
  assert.equal(profile.actionTaxonomyPath, 'source-ops/action-taxonomy.json');
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
  assert.equal(exampleTask.policy.preProductionAutoAdvanceMax, 'shadow');
  assert.equal(exampleTask.policy.lifecycleTransitionPolicyPath, profile.lifecycleTransitionPolicyPath);
  assert.equal(exampleTask.io.registryPath, profile.registryPath);
});

test('grading contract includes shared rubric and scorecard artifacts', () => {
  assert.equal(profile.scorecardSchemaPath, 'source-ops/schemas/scorecard.schema.json');
  assert.equal(profile.gradingRubricPath, 'source-ops/grading-rubric.json');
  assert.equal(exampleGradingTask.grading.scorecardSchemaPath, profile.scorecardSchemaPath);
  assert.equal(exampleGradingTask.grading.rubricPath, profile.gradingRubricPath);
  assert.equal(scorecardSchema.properties.version.const, 'source-scorecard-v1');
  assert.equal(gradingRubric.version, 'source-grading-rubric-v1');
  assert.equal(gradingRubric.dimensions.length, 6);
  assert.equal(Number(gradingRubric.dimensions.reduce((sum, item) => sum + item.weight, 0).toFixed(4)), 1);
  assert.equal(exampleGradingScorecard.version, 'source-scorecard-v1');
  assert.equal(exampleGradingScorecard.dimensionScores.length, gradingRubric.dimensions.length);
  assert.equal(exampleGradingScorecard.recommendation, 'shadow');
});

test('overlap contract includes structured assessment artifacts and explainable rubric', () => {
  assert.equal(profile.overlapSchemaPath, 'source-ops/schemas/overlap-assessment.schema.json');
  assert.equal(profile.overlapRubricPath, 'source-ops/overlap-rubric.json');
  assert.equal(exampleOverlapTask.overlap.schemaPath, profile.overlapSchemaPath);
  assert.equal(exampleOverlapTask.overlap.rubricPath, profile.overlapRubricPath);
  assert.equal(overlapSchema.properties.version.const, 'source-overlap-v1');
  assert.equal(overlapRubric.version, 'source-overlap-rubric-v1');
  assert.equal(overlapRubric.dimensions.length, 4);
  assert.equal(Number(overlapRubric.dimensions.reduce((sum, item) => sum + item.weight, 0).toFixed(4)), 1);
  assert.equal(exampleOverlapAssessment.version, 'source-overlap-v1');
  assert.equal(exampleOverlapAssessment.dimensionScores.length, overlapRubric.dimensions.length);
  assert.equal(exampleOverlapAssessment.overlap.incrementalCoverage, 'high');
  assert.equal(exampleOverlapAssessment.recommendation, 'shadow');
});

test('pruning contract includes structured assessment artifacts and active-source guardrails', () => {
  assert.equal(profile.pruningSchemaPath, 'source-ops/schemas/pruning-assessment.schema.json');
  assert.equal(profile.pruningRubricPath, 'source-ops/pruning-rubric.json');
  assert.equal(examplePruningTask.pruning.schemaPath, profile.pruningSchemaPath);
  assert.equal(examplePruningTask.pruning.rubricPath, profile.pruningRubricPath);
  assert.equal(pruningSchema.properties.version.const, 'source-pruning-v1');
  assert.equal(pruningRubric.version, 'source-pruning-rubric-v1');
  assert.equal(pruningRubric.dimensions.length, 5);
  assert.equal(Number(pruningRubric.dimensions.reduce((sum, item) => sum + item.weight, 0).toFixed(4)), 1);
  assert.equal(examplePruningAssessment.version, 'source-pruning-v1');
  assert.equal(examplePruningAssessment.dimensionScores.length, pruningRubric.dimensions.length);
  assert.equal(examplePruningAssessment.recommendation, 'human-review');
  assert.equal(examplePruningAssessment.recommendedAction, 'human-review');
  assert.equal(examplePruningAssessment.productionGuardrails.productionMutationProposed, false);
  assert.equal(examplePruningAssessment.productionGuardrails.autoRemovalAllowed, false);
});

test('shared action taxonomy covers source-ops recommendation labels', () => {
  const ids = actionTaxonomy.actions.map(item => item.id);
  assert.equal(actionTaxonomy.version, 'source-action-taxonomy-v1');
  assert.ok(ids.includes('shadow'));
  assert.ok(ids.includes('human-review'));
  assert.ok(ids.includes('approve'));
  assert.ok(ids.includes('deprecate-review'));
  assert.ok(resultSchema.properties.recommendations.items.properties.action.enum.includes('human-review'));
  assert.ok(resultSchema.properties.recommendations.items.properties.action.enum.includes('approve'));
});

test('result schema and queue scaffolding exist for bounded subagent workflows', () => {
  assert.equal(resultSchema.properties.version.const, 'source-ops-result-v1');
  assert.equal(pendingQueue.version, 'source-ops-queue-v1');
  assert.equal(reviewedQueue.version, 'source-ops-queue-v1');
  assert.ok(Array.isArray(pendingQueue.tasks));
  assert.ok(Array.isArray(reviewedQueue.tasks));
});

test('shadow registry entries stay pre-production and retain explicit score references', () => {
  const shadowSources = registry.sources.filter(source => source.lifecycle === 'shadow');
  assert.ok(shadowSources.length >= 1);
  for (const source of shadowSources) {
    assert.equal(source.enabledByDefault, false);
    assert.equal(source.shadow.productionInfluenceBlocked, true);
    assert.ok(source.shadow.scorecardRef);
    assert.ok(source.shadow.overlapRef);
    assert.equal(source.shadow.promotionReadiness, 'shadow-ready');
    assert.deepEqual(source.shadow.eligibleNextStates, ['approved', 'rejected', 'deprecated']);
  }
});

test('every allowed role has a bounded role definition and task template', () => {
  for (const role of profile.allowedRoles) {
    const rolePath = new URL(roleFiles[role], import.meta.url);
    const taskPath = new URL(taskTemplates[role], import.meta.url);
    assert.ok(existsSync(rolePath), `missing role definition for ${role}`);
    assert.ok(existsSync(taskPath), `missing task template for ${role}`);
    const roleDoc = readFileSync(rolePath, 'utf8');
    const task = JSON.parse(readFileSync(taskPath, 'utf8'));
    assert.match(roleDoc, /## Mission/);
    assert.match(roleDoc, /## Must do/);
    assert.match(roleDoc, /## Must not do/);
    assert.equal(task.version, 'source-ops-task-v1');
    assert.equal(task.role, role);
    hasRequiredKeys(task, taskSchema.required);
    assert.equal(task.io.registryPath, profile.registryPath);
    assert.equal(task.policy.contractMode, 'file-first');
    assert.equal(task.policy.productionMutationsAllowed, false);
    assert.equal(task.policy.activePromotionRequiresHumanApproval, true);
    assert.equal(task.policy.preProductionAutoAdvanceMax, 'shadow');
    assert.equal(task.policy.lifecycleTransitionPolicyPath, profile.lifecycleTransitionPolicyPath);
  }
});

test('registry lifecycle policy and profile lifecycle policy agree on human approval boundary', () => {
  const lifecycleStates = new Set(profile.lifecyclePolicy.states);
  const transitionPolicy = JSON.parse(readFileSync(new URL('../source-ops/lifecycle-transition-policy.json', import.meta.url), 'utf8'));
  for (const source of registry.sources) {
    assert.ok(lifecycleStates.has(source.lifecycle), `unknown lifecycle state ${source.lifecycle}`);
  }
  assert.ok(profile.lifecyclePolicy.agentWritableStates.includes('shadow'));
  assert.ok(profile.lifecyclePolicy.humanApprovalRequiredFor.includes('active'));
  assert.ok(registry.sources.some(source => source.lifecycle === 'shadow'));
  assert.equal(transitionPolicy.version, 'source-lifecycle-transition-policy-v1');
  assert.equal(transitionPolicy.preProductionAutoAdvanceMax, 'shadow');
  assert.equal(transitionPolicy.activePromotionRequiresHumanApproval, true);
  assert.equal(transitionPolicy.states.shadow.agentMayAdvance, false);
  assert.deepEqual(transitionPolicy.states.graded.allowedNextStates, ['shadow', 'rejected', 'deprecated']);
  assert.deepEqual(transitionPolicy.promotionReadinessGuards.active, ['human-review-required']);
  assert.equal(exampleLifecycleEvaluation.version, 'source-lifecycle-evaluation-v1');
  assert.equal(exampleLifecycleEvaluation.currentState, 'shadow');
  assert.equal(exampleLifecycleEvaluation.nextAllowedState, 'approved');
  assert.equal(exampleLifecycleEvaluation.recommendedAction, 'human-review');
  assert.equal(exampleLifecycleEvaluation.blocked, true);
});
