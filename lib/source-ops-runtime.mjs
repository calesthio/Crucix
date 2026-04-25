import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

export function loadSourceOpsWorkspace(rootDir) {
  const profile = readJsonIfPresent(join(rootDir, 'source-ops', 'profile.json'), null);
  const registry = readJsonIfPresent(join(rootDir, 'source-ops', 'source-registry.seed.json'), { version: null, sources: [] });
  const needs = readJsonIfPresent(join(rootDir, 'source-ops', 'runtime-needs.json'), { version: null, gaps: [] });
  return { profile, registry, needs };
}

export function buildSourceOpsSurface({ rootDir, snapshot = null } = {}) {
  const { profile, registry, needs } = loadSourceOpsWorkspace(rootDir);
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
    } : null,
    inventory,
    needs: summarizeNeeds(needs),
  };
}
