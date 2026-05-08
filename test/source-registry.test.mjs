import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildCanonicalSourceRegistry, SOURCE_REGISTRY_VERSION, summarizeSourceFusionRoles } from '../lib/source-registry.mjs';
import { DEFAULT_SOURCE_POLICY } from '../lib/freshness-policy.mjs';

const schema = JSON.parse(readFileSync(new URL('../source-ops/source-registry.schema.json', import.meta.url), 'utf8'));

function validateRegistryShape(registry) {
  assert.equal(registry.version, SOURCE_REGISTRY_VERSION);
  assert.match(registry.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(registry.sources));
  assert.ok(registry.sources.length > 0);
  const sourceItemSchema = schema.properties.sources.items;
  for (const source of registry.sources) {
    for (const key of sourceItemSchema.required) {
      assert.ok(key in source, `missing required key ${key}`);
    }
    assert.ok(source.id);
    assert.ok(source.name);
    assert.ok(source.module.endsWith('.mjs'));
    assert.ok(sourceItemSchema.properties.category.enum.includes(source.category));
    assert.ok(sourceItemSchema.properties.trustClass.enum.includes(source.trustClass));
    assert.ok(sourceItemSchema.properties.lifecycle.enum.includes(source.lifecycle));
    assert.ok(sourceItemSchema.properties.operatorRole.enum.includes(source.operatorRole));
    assert.equal(typeof source.enabledByDefault, 'boolean');
    assert.ok(source.runtimeBucket);
    assert.ok(sourceItemSchema.properties.runtimeBucket.properties.kind.enum.includes(source.runtimeBucket.kind));
    assert.ok(Array.isArray(source.runtimeBucket.attributionAliases));
    assert.ok(source.runtimeBucket.attributionAliases.length >= 1);
    assert.ok(source.review);
    assert.ok(source.review.status);
    assert.ok(source.review.provenance);
  }
}

test('canonical source registry schema covers current runtime source policy set', () => {
  const registry = buildCanonicalSourceRegistry();
  validateRegistryShape(registry);
  assert.equal(registry.sources.length, Object.keys(DEFAULT_SOURCE_POLICY).length);
  assert.equal(new Set(registry.sources.map(source => source.name)).size, registry.sources.length);
  assert.equal(new Set(registry.sources.map(source => source.id)).size, registry.sources.length);
});

test('source fusion-role summary stays aligned with canonical registry roles', () => {
  const registry = buildCanonicalSourceRegistry();
  const summary = summarizeSourceFusionRoles(registry.sources);
  assert.equal(summary.total, registry.sources.length);
  assert.equal(summary.byRole.anchor >= 1, true);
  assert.equal(summary.byRole.exploratory >= 1, true);
  assert.equal(summary.roles.find(item => item.role === 'anchor')?.sourceIds.includes('opensky'), true);
});

test('canonical source registry maps current source policy entries to real source modules', () => {
  const registry = buildCanonicalSourceRegistry();
  const apiSourceFiles = new Set(readdirSync(new URL('../apis/sources/', import.meta.url)).filter(name => name.endsWith('.mjs')));
  for (const source of registry.sources) {
    const filename = source.module.split('/').pop();
    assert.ok(apiSourceFiles.has(filename), `missing source module for ${source.name}: ${filename}`);
  }
});


test('canonical source registry exposes explicit runtime-bucket metadata for expected multi-publisher aggregators', () => {
  const registry = buildCanonicalSourceRegistry();
  const gdelt = registry.sources.find(source => source.name === 'GDELT');
  const opensky = registry.sources.find(source => source.name === 'OpenSky');
  assert.ok(gdelt);
  assert.equal(gdelt.runtimeBucket.kind, 'expected-multi-publisher');
  assert.deepEqual(gdelt.runtimeBucket.attributionAliases, ['GDELT', 'RSS', 'news']);
  assert.match(gdelt.runtimeBucket.rationale, /aggregates many upstream publishers/i);
  assert.ok(opensky);
  assert.equal(opensky.runtimeBucket.kind, 'single-publisher');
});
