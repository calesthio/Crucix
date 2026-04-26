import { DEFAULT_SOURCE_POLICY } from './freshness-policy.mjs';

export const SOURCE_REGISTRY_VERSION = 'source-registry-v1';
export const SOURCE_LIFECYCLE_STATES = ['candidate', 'researched', 'graded', 'shadow', 'approved', 'active', 'degraded', 'deprecated', 'rejected'];
export const SOURCE_OPERATOR_ROLES = ['anchor', 'corroborator', 'anomaly-detector', 'context', 'exploratory'];
export const SOURCE_RUNTIME_BUCKET_KINDS = ['single-publisher', 'expected-multi-publisher'];

export const SOURCE_ROLE_DESCRIPTIONS = {
  'anchor': 'Primary high-trust evidence source suitable for direct operator grounding.',
  'corroborator': 'Secondary source that strengthens or cross-checks anchor evidence.',
  'anomaly-detector': 'Source best used to surface unusual signals that warrant confirmation.',
  'context': 'Background or situational source that adds framing more than decisive evidence.',
  'exploratory': 'Low-trust or noisy source useful for discovery, not direct grounding.',
};

function slugify(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function inferOperatorRole(policy = {}) {
  const mode = String(policy.evidenceMode || 'unknown');
  const trust = String(policy.trustClass || 'unknown');
  if (trust === 'high' && /official|sensor|provider|market|curated/.test(mode)) return 'anchor';
  if (trust === 'medium' && /sensor|event|market|space|database/.test(mode)) return 'corroborator';
  if (/social/.test(mode)) return 'exploratory';
  if (/satellite|space|telemetry/.test(mode)) return 'anomaly-detector';
  return trust === 'low' ? 'exploratory' : 'context';
}

function modulePathForSource(name = '') {
  const explicit = {
    'OpenSky': 'apis/sources/opensky.mjs',
    'ADS-B': 'apis/sources/adsb.mjs',
    'CISA-KEV': 'apis/sources/cisa-kev.mjs',
    'Cloudflare-Radar': 'apis/sources/cloudflare-radar.mjs',
    'KiwiSDR': 'apis/sources/kiwisdr.mjs',
    'Maritime': 'apis/sources/ships.mjs',
    'OpenSanctions': 'apis/sources/opensanctions.mjs',
    'USAspending': 'apis/sources/usaspending.mjs',
    'YFinance': 'apis/sources/yfinance.mjs',
  };
  if (explicit[name]) return explicit[name];
  return `apis/sources/${slugify(name)}.mjs`;
}

function runtimeBucketForSource(name = '', policy = {}) {
  if (name === 'GDELT') {
    return {
      kind: 'expected-multi-publisher',
      attributionAliases: ['GDELT', 'RSS', 'news'],
      rationale: 'Aggregates many upstream publishers into one runtime attribution bucket by design.',
    };
  }

  return {
    kind: 'single-publisher',
    attributionAliases: [name, policy.category].filter(Boolean),
    rationale: 'Runtime attribution is expected to represent one named source rather than a publisher bucket.',
  };
}

export function summarizeSourceFusionRoles(sources = []) {
  const items = Array.isArray(sources) ? sources : [];
  const byRole = Object.fromEntries(SOURCE_OPERATOR_ROLES.map(role => [role, 0]));
  const byRoleAndTrust = Object.fromEntries(SOURCE_OPERATOR_ROLES.map(role => [role, { high: 0, medium: 0, low: 0, unknown: 0 }]));
  for (const source of items) {
    const role = SOURCE_OPERATOR_ROLES.includes(source?.operatorRole) ? source.operatorRole : 'context';
    const trust = ['high', 'medium', 'low'].includes(source?.trustClass) ? source.trustClass : 'unknown';
    byRole[role] += 1;
    byRoleAndTrust[role][trust] += 1;
  }
  return {
    total: items.length,
    byRole,
    byRoleAndTrust,
    roles: SOURCE_OPERATOR_ROLES.map(role => ({
      role,
      description: SOURCE_ROLE_DESCRIPTIONS[role],
      count: byRole[role],
      trustMix: byRoleAndTrust[role],
      sourceIds: items.filter(source => source?.operatorRole === role).map(source => source.id),
    })),
  };
}

export function buildCanonicalSourceRegistry(sourcePolicy = DEFAULT_SOURCE_POLICY) {
  const generatedAt = new Date().toISOString();
  const sources = Object.entries(sourcePolicy)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([name, policy]) => ({
      id: slugify(name),
      name,
      module: modulePathForSource(name),
      category: policy.category || 'other',
      trustClass: policy.trustClass || 'unknown',
      evidenceMode: policy.evidenceMode || 'unknown',
      freshnessTargetMinutes: Number(policy.freshnessTargetMinutes) || 60,
      lifecycle: 'active',
      operatorRole: inferOperatorRole(policy),
      enabledByDefault: true,
      runtimeBucket: runtimeBucketForSource(name, policy),
      review: {
        status: 'seeded-from-runtime-policy',
        provenance: 'DEFAULT_SOURCE_POLICY',
        lastReviewedAt: null,
        notes: 'Seeded from current Crucix runtime source policy; pending richer source-ops review.',
      },
    }));

  return {
    version: SOURCE_REGISTRY_VERSION,
    generatedAt,
    sources,
  };
}
