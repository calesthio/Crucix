import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadExampleLifecycleEvaluation } from './source-lifecycle-policy.mjs';
import {
  summarizeSourceGradingRubric,
  summarizeSourceScorecard,
  summarizeSourceOverlapRubric,
  summarizeSourceOverlapAssessment,
  summarizeSourcePruningRubric,
  summarizeSourcePruningAssessment,
} from './source-scorecard.mjs';

function readJsonIfPresent(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function countBy(items = [], key) {
  return Object.fromEntries(
    Array.from(new Set(items.map(item => item?.[key] || 'unknown')))
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map(value => [value, items.filter(item => (item?.[key] || 'unknown') === value).length])
  );
}

function summarizeNeeds(needs = {}) {
  const gaps = Array.isArray(needs?.gaps) ? needs.gaps : [];
  return {
    total: gaps.length,
    highPriority: gaps.filter(gap => gap?.priority === 'high').length,
    byCategory: countBy(gaps, 'category'),
    byKind: countBy(gaps, 'kind'),
    items: gaps.map(gap => ({
      id: gap.id || null,
      kind: gap.kind || 'unknown',
      category: gap.category || 'other',
      priority: gap.priority || 'unknown',
      summary: gap.summary || null,
    })),
    runtimeSignals: needs?.runtimeSignals || null,
  };
}

function summarizeShadowCandidates(items = []) {
  const shadowItems = items.filter(item => item.lifecycle === 'shadow');
  return {
    total: shadowItems.length,
    readyForHumanReview: shadowItems.filter(item => item.shadow?.promotionReadiness === 'shadow-ready').length,
    blockedFromProduction: shadowItems.filter(item => item.shadow?.productionInfluenceBlocked).length,
    byCategory: countBy(shadowItems, 'category'),
    byOperatorRole: countBy(shadowItems, 'operatorRole'),
    items: shadowItems.map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      operatorRole: item.operatorRole,
      trustClass: item.trustClass,
      productionInfluenceBlocked: Boolean(item.shadow?.productionInfluenceBlocked),
      observationMode: item.shadow?.observationMode || null,
      promotionReadiness: item.shadow?.promotionReadiness || null,
      eligibleNextStates: Array.isArray(item.shadow?.eligibleNextStates) ? item.shadow.eligibleNextStates : [],
      scorecardRef: item.shadow?.scorecardRef || null,
      overlapRef: item.shadow?.overlapRef || null,
      lastObservedAt: item.shadow?.lastObservedAt || null,
      review: item.review || null,
    })),
  };
}

function summarizeLifecycleTransitionPolicy(policy = null) {
  const states = policy?.states && typeof policy.states === 'object' ? policy.states : {};
  const orderedStates = Object.entries(states).map(([state, value]) => ({
    state,
    allowedNextStates: Array.isArray(value?.allowedNextStates) ? value.allowedNextStates : [],
    agentMayAdvance: Boolean(value?.agentMayAdvance),
    requirementCount: Array.isArray(value?.requirements) ? value.requirements.length : 0,
  }));
  return {
    version: policy?.version || null,
    generatedAt: policy?.generatedAt || null,
    contractMode: policy?.contractMode || null,
    defaultEntryState: policy?.defaultEntryState || null,
    preProductionAutoAdvanceMax: policy?.preProductionAutoAdvanceMax || null,
    activePromotionRequiresHumanApproval: Boolean(policy?.activePromotionRequiresHumanApproval),
    autoAdvanceStates: orderedStates.filter(item => item.agentMayAdvance).map(item => item.state),
    humanApprovalBoundaryStates: orderedStates.filter(item => !item.agentMayAdvance && item.allowedNextStates.length > 0).map(item => item.state),
    stateCount: orderedStates.length,
    states: orderedStates,
    promotionReadinessGuards: policy?.promotionReadinessGuards || null,
    operatorExpectations: policy?.operatorExpectations || null,
  };
}

export function loadSourceOpsWorkspace(rootDir) {
  const profile = readJsonIfPresent(join(rootDir, 'source-ops', 'profile.json'), null);
  const registry = readJsonIfPresent(join(rootDir, 'source-ops', 'source-registry.seed.json'), { version: null, sources: [] });
  const needs = readJsonIfPresent(join(rootDir, 'source-ops', 'runtime-needs.json'), { version: null, gaps: [] });
  const rubric = readJsonIfPresent(join(rootDir, 'source-ops', 'grading-rubric.json'), null);
  const overlapRubric = readJsonIfPresent(join(rootDir, 'source-ops', 'overlap-rubric.json'), null);
  const pruningRubric = readJsonIfPresent(join(rootDir, 'source-ops', 'pruning-rubric.json'), null);
  const actionTaxonomy = readJsonIfPresent(join(rootDir, 'source-ops', 'action-taxonomy.json'), null);
  const lifecycleTransitionPolicy = readJsonIfPresent(join(rootDir, 'source-ops', 'lifecycle-transition-policy.json'), null);
  const exampleScorecard = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'grading', 'example-grading-scorecard.json'), null);
  const exampleOverlap = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'overlap', 'example-overlap-maritime-001.json'), null);
  const examplePruning = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'pruning', 'example-pruning-social-001.json'), null);
  const exampleLifecycleEvaluation = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'onboarding-prep', 'example-lifecycle-evaluation-maritime-001.json'), null);
  return { profile, registry, needs, rubric, overlapRubric, pruningRubric, actionTaxonomy, lifecycleTransitionPolicy, exampleScorecard, exampleOverlap, examplePruning, exampleLifecycleEvaluation };
}

export function buildSourceOpsSurface({ rootDir, snapshot = null } = {}) {
  const { profile, registry, needs, rubric, overlapRubric, pruningRubric, actionTaxonomy, lifecycleTransitionPolicy, exampleScorecard, exampleOverlap, examplePruning, exampleLifecycleEvaluation } = loadSourceOpsWorkspace(rootDir);
  const sources = Array.isArray(registry?.sources) ? registry.sources : [];
  const sourceHealthEntries = Array.isArray(snapshot?.healthSummary?.entries) ? snapshot.healthSummary.entries : [];
  const healthByName = new Map(sourceHealthEntries.map(entry => [entry.name, entry]));
  const inventoryItems = sources.map(source => {
    const live = healthByName.get(source.name) || null;
    return {
      id: source.id,
      name: source.name,
      module: source.module,
      category: source.category,
      trustClass: source.trustClass,
      evidenceMode: source.evidenceMode,
      lifecycle: source.lifecycle,
      operatorRole: source.operatorRole,
      enabledByDefault: Boolean(source.enabledByDefault),
      freshnessTargetMinutes: source.freshnessTargetMinutes,
      review: source.review || null,
      shadow: source.shadow || null,
      liveState: live?.state || null,
      liveAgeMinutes: live?.ageMinutes ?? null,
      liveFailureClass: live?.failure?.class || null,
    };
  });
  const inventory = {
    version: registry?.version || null,
    generatedAt: registry?.generatedAt || null,
    total: inventoryItems.length,
    active: inventoryItems.filter(item => item.lifecycle === 'active').length,
    productionActive: inventoryItems.filter(item => item.lifecycle === 'active' && item.enabledByDefault).length,
    preProduction: inventoryItems.filter(item => ['candidate', 'researched', 'graded', 'shadow', 'approved'].includes(item.lifecycle)).length,
    byLifecycle: countBy(inventoryItems, 'lifecycle'),
    byCategory: countBy(inventoryItems, 'category'),
    byTrustClass: countBy(inventoryItems, 'trustClass'),
    byOperatorRole: countBy(inventoryItems, 'operatorRole'),
    liveStateSummary: countBy(inventoryItems.filter(item => item.liveState), 'liveState'),
    items: inventoryItems,
  };
  return {
    contract: profile ? {
      version: profile.version || null,
      generatedAt: profile.generatedAt || null,
      contractMode: profile?.approvalPolicy?.contractMode || null,
      preProductionAutoAdvanceMax: profile?.approvalPolicy?.preProductionAutoAdvanceMax || null,
      activePromotionRequiresHumanApproval: Boolean(profile?.approvalPolicy?.activePromotionRequiresHumanApproval),
      allowedRoles: Array.isArray(profile?.allowedRoles) ? profile.allowedRoles : [],
      workspace: profile?.workspace || null,
      overlapSchemaPath: profile?.overlapSchemaPath || null,
      overlapRubricPath: profile?.overlapRubricPath || null,
      pruningSchemaPath: profile?.pruningSchemaPath || null,
      pruningRubricPath: profile?.pruningRubricPath || null,
      actionTaxonomyPath: profile?.actionTaxonomyPath || null,
      lifecycleTransitionPolicyPath: profile?.lifecycleTransitionPolicyPath || null,
      shadowPolicy: profile?.shadowPolicy || null,
      transitionPolicy: profile?.transitionPolicy || null,
    } : null,
    inventory,
    shadow: summarizeShadowCandidates(inventoryItems),
    lifecycleTransitions: summarizeLifecycleTransitionPolicy(lifecycleTransitionPolicy),
    needs: summarizeNeeds(needs),
    grading: rubric ? summarizeSourceGradingRubric(rubric) : null,
    overlap: overlapRubric ? summarizeSourceOverlapRubric(overlapRubric) : null,
    pruning: pruningRubric ? summarizeSourcePruningRubric(pruningRubric) : null,
    actionTaxonomy: actionTaxonomy ? {
      version: actionTaxonomy.version || null,
      actionCount: Array.isArray(actionTaxonomy.actions) ? actionTaxonomy.actions.length : 0,
      ids: Array.isArray(actionTaxonomy.actions) ? actionTaxonomy.actions.map(item => item.id) : [],
    } : null,
    exampleScorecard: exampleScorecard ? summarizeSourceScorecard(exampleScorecard) : null,
    exampleOverlap: exampleOverlap ? summarizeSourceOverlapAssessment(exampleOverlap) : null,
    examplePruning: examplePruning ? summarizeSourcePruningAssessment(examplePruning) : null,
    lifecycleEvaluation: lifecycleTransitionPolicy ? loadExampleLifecycleEvaluation(rootDir) : (exampleLifecycleEvaluation || null),
  };
}
