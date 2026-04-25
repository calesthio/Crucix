import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadExampleLifecycleEvaluation, loadExampleLifecycleBatch } from './source-lifecycle-policy.mjs';
import { summarizeSourceFusionRoles } from './source-registry.mjs';
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

function normalizeAttributionName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function measurementTargets(snapshot = {}) {
  const clusters = Array.isArray(snapshot?.newsClusters) ? snapshot.newsClusters : [];
  const quality = snapshot?.newsClusterQuality || null;
  const reviewMetrics = quality?.reviewMetrics || null;
  return {
    clusterQuality: quality ? {
      high: quality.high || 0,
      medium: quality.medium || 0,
      low: quality.low || 0,
      heuristicOnly: quality.heuristicOnly || 0,
      singleSource: quality.singleSource || 0,
    } : {
      high: clusters.filter(item => item?.quality === 'high').length,
      medium: clusters.filter(item => item?.quality === 'medium').length,
      low: clusters.filter(item => item?.quality === 'low').length,
      heuristicOnly: clusters.filter(item => (item?.qualityFlags || []).includes('heuristic-only')).length,
      singleSource: clusters.filter(item => (item?.qualityFlags || []).includes('single-source')).length,
    },
    reviewPressure: reviewMetrics ? {
      lowConfidenceCount: reviewMetrics.lowConfidenceCount || 0,
      mergeCandidateCount: reviewMetrics.mergeCandidateCount || 0,
      splitCandidateCount: reviewMetrics.splitCandidateCount || 0,
      suspiciousNearDuplicateCount: reviewMetrics.suspiciousNearDuplicateCount || 0,
    } : null,
    tippingPointCount: Array.isArray(snapshot?.agentAnalysis?.tippingPoints) ? snapshot.agentAnalysis.tippingPoints.length : 0,
  };
}

function summarizeSourcePerformance(items = [], snapshot = {}) {
  const sourceNames = new Map(items.map(item => [normalizeAttributionName(item.name), item.name]));
  const aliases = new Map([
    ['adsb', 'ADS-B'],
    ['opensky', 'OpenSky'],
    ['opensanctions', 'OpenSanctions'],
    ['cloudflareradar', 'Cloudflare-Radar'],
    ['cisakev', 'CISA-KEV'],
    ['kiwisdr', 'KiwiSDR'],
    ['gdelt', 'GDELT'],
    ['rss', 'GDELT'],
    ['news', 'GDELT'],
    ['telegram', 'Telegram'],
    ['reddit', 'Reddit'],
    ['bluesky', 'Bluesky'],
    ['yfinance', 'YFinance'],
  ]);
  const counters = new Map(items.map(item => [item.name, {
    feedItems: 0,
    clusteredItems: 0,
    clusteredStories: 0,
    suspectSignals: 0,
    corroboratedSignals: 0,
    degradationSignals: 0,
    citedByTippingPoints: 0,
  }]));

  const resolveNames = (...values) => {
    const resolved = new Set();
    for (const value of values) {
      const normalized = normalizeAttributionName(value);
      if (!normalized || normalized === 'mixed') continue;
      if (sourceNames.has(normalized)) resolved.add(sourceNames.get(normalized));
      if (aliases.has(normalized)) resolved.add(aliases.get(normalized));
    }
    return Array.from(resolved).filter(name => counters.has(name));
  };

  for (const item of Array.isArray(snapshot?.newsFeed) ? snapshot.newsFeed : []) {
    for (const name of resolveNames(item?.type, item?.evidenceSource, item?.source)) {
      counters.get(name).feedItems += 1;
    }
  }

  for (const cluster of Array.isArray(snapshot?.newsClusters) ? snapshot.newsClusters : []) {
    const entries = Array.isArray(cluster?.sourceProvenance?.entries) ? cluster.sourceProvenance.entries : [];
    const storyNames = new Set();
    for (const entry of entries) {
      for (const name of resolveNames(entry?.runtimeSource, entry?.source, entry?.type)) {
        counters.get(name).clusteredItems += Number(entry?.count) || 0;
        storyNames.add(name);
      }
    }
    for (const name of storyNames) {
      counters.get(name).clusteredStories += 1;
    }
  }

  for (const signal of Array.isArray(snapshot?.suspectSignals) ? snapshot.suspectSignals : []) {
    for (const name of resolveNames(signal?.evidenceSource, signal?.source)) {
      counters.get(name).suspectSignals += 1;
      if (signal?.category === 'source' || /degrad/i.test(String(signal?.reason || ''))) counters.get(name).degradationSignals += 1;
    }
  }

  for (const signal of Array.isArray(snapshot?.corroboratedSignals) ? snapshot.corroboratedSignals : []) {
    for (const name of resolveNames(signal?.evidenceSource, signal?.source)) {
      counters.get(name).corroboratedSignals += 1;
    }
  }

  for (const point of Array.isArray(snapshot?.agentAnalysis?.tippingPoints) ? snapshot.agentAnalysis.tippingPoints : []) {
    for (const ref of Array.isArray(point?.evidenceRefs) ? point.evidenceRefs : []) {
      for (const name of resolveNames(ref?.label, ref?.id)) {
        counters.get(name).citedByTippingPoints += 1;
      }
    }
  }

  const targets = measurementTargets(snapshot);
  const byTrustOutcome = { supportive: 0, mixed: 0, degraded: 0, none: 0 };
  const measuredItems = items.map(item => {
    const counts = counters.get(item.name) || { feedItems: 0, clusteredItems: 0, clusteredStories: 0, suspectSignals: 0, corroboratedSignals: 0, degradationSignals: 0, citedByTippingPoints: 0 };
    const livePenalty = item.liveState === 'failed' ? 2 : item.liveState === 'degraded' ? 1 : item.liveState === 'stale' ? 1 : 0;
    const signalCount = counts.suspectSignals + counts.corroboratedSignals + counts.degradationSignals;
    const attentionScore = counts.corroboratedSignals * 3 + counts.suspectSignals * 2 + counts.degradationSignals * 2 + counts.citedByTippingPoints * 2 + Math.min(counts.clusteredItems, 3) + Math.min(counts.clusteredStories, 2) + livePenalty;
    const noiseScore = counts.suspectSignals + counts.degradationSignals + (item.operatorRole === 'exploratory' ? 1 : 0) + (item.trustClass === 'low' ? 1 : 0);
    const trustOutcome = counts.corroboratedSignals > counts.suspectSignals && counts.corroboratedSignals > 0
      ? 'supportive'
      : counts.degradationSignals > 0 || item.liveState === 'failed'
        ? 'degraded'
        : signalCount > 0
          ? 'mixed'
          : 'none';
    byTrustOutcome[trustOutcome] += 1;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      trustClass: item.trustClass,
      operatorRole: item.operatorRole,
      liveState: item.liveState,
      contribution: {
        feedItems: counts.feedItems,
        clusteredItems: counts.clusteredItems,
        clusteredStories: counts.clusteredStories,
        suspectSignals: counts.suspectSignals,
        corroboratedSignals: counts.corroboratedSignals,
        degradationSignals: counts.degradationSignals,
        citedByTippingPoints: counts.citedByTippingPoints,
        totalSignals: signalCount,
      },
      noiseScore,
      attentionScore,
      trustOutcome,
      impactLabel: attentionScore >= 6 ? 'high' : attentionScore >= 3 ? 'medium' : attentionScore >= 1 ? 'low' : 'none',
      measurementBasis: {
        feedCoverage: true,
        signalCoverage: true,
        tippingPointCoverage: true,
        directClusterAttribution: true,
      },
    };
  }).sort((a, b) => b.attentionScore - a.attentionScore || a.name.localeCompare(b.name));

  return {
    totalMeasuredSources: measuredItems.length,
    withFeedContribution: measuredItems.filter(item => item.contribution.feedItems > 0).length,
    withClusterAttribution: measuredItems.filter(item => item.contribution.clusteredItems > 0).length,
    withSignalContribution: measuredItems.filter(item => item.contribution.totalSignals > 0).length,
    withTippingPointCitation: measuredItems.filter(item => item.contribution.citedByTippingPoints > 0).length,
    degradedOrFailing: measuredItems.filter(item => ['failed', 'degraded', 'stale'].includes(item.liveState)).length,
    byTrustOutcome,
    targets,
    topImpactSources: measuredItems.filter(item => item.attentionScore > 0).slice(0, 8).map(item => ({
      name: item.name,
      attentionScore: item.attentionScore,
      impactLabel: item.impactLabel,
      trustOutcome: item.trustOutcome,
      contribution: item.contribution,
    })),
    items: measuredItems,
    measurementNotes: {
      directClusterAttribution: 'available from per-cluster source provenance summaries derived from clustered item sources and types',
      intendedValidationTargets: ['cluster quality', 'review pressure', 'tipping-point quality', 'trust outcomes'],
    },
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
  const exampleLifecycleBatch = readJsonIfPresent(join(rootDir, 'source-ops', 'results', 'onboarding-prep', 'example-lifecycle-batch.json'), null);
  return { profile, registry, needs, rubric, overlapRubric, pruningRubric, actionTaxonomy, lifecycleTransitionPolicy, exampleScorecard, exampleOverlap, examplePruning, exampleLifecycleEvaluation, exampleLifecycleBatch };
}

export function buildSourceOpsSurface({ rootDir, snapshot = null } = {}) {
  const { profile, registry, needs, rubric, overlapRubric, pruningRubric, actionTaxonomy, lifecycleTransitionPolicy, exampleScorecard, exampleOverlap, examplePruning, exampleLifecycleEvaluation, exampleLifecycleBatch } = loadSourceOpsWorkspace(rootDir);
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
  const fusionRoles = summarizeSourceFusionRoles(inventoryItems);
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
  const performance = summarizeSourcePerformance(inventoryItems, snapshot || {});
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
    fusionRoles,
    performance,
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
    lifecycleBatchEvaluation: lifecycleTransitionPolicy ? loadExampleLifecycleBatch(rootDir) : (exampleLifecycleBatch || null),
  };
}
