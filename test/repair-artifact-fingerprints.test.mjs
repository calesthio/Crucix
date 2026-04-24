import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('/Users/rightclaw/services/crucix/dashboard/inject.mjs', 'utf8');

function extractChunk(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  if (start === -1 || end === -1 || end <= start) throw new Error(`could not extract ${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

const code = [
  extractChunk('function hashArtifactText(text = \'\') {', 'function compactArtifactSnippet(text = \'\', limit = 220) {'),
  extractChunk('function compactArtifactSnippet(text = \'\', limit = 220) {', 'function pushRepairArtifact(debug = {}, artifact = {}) {'),
  extractChunk('function buildRepairArtifact({ region = \'\'', 'function buildClusterFailureReview(debug = {}) {'),
  'module.exports = { hashArtifactText, compactArtifactSnippet, buildRepairArtifact };',
].join('\n');

const context = {
  module: { exports: {} },
  exports: {},
  console,
  createHash,
  JSON,
  String,
  Number,
  Boolean,
};
vm.createContext(context);
vm.runInContext(code, context);
const { buildRepairArtifact } = context.module.exports;

test('buildRepairArtifact stamps prompt, repair prompt, tuning, provider, and model fingerprints', () => {
  const artifact = buildRepairArtifact({
    region: 'Iran',
    itemCount: 3,
    stage: 'repair-failed',
    reason: 'shape-mismatch',
    rawText: '{bad json',
    repairText: '{still bad}',
    retried: true,
    repairAttempted: true,
    fragment: 'shape fragment',
    provider: 'ollama',
    model: 'llamacpp.gguf',
    promptSystem: 'system prompt',
    promptUser: 'user prompt',
    repairSystem: 'repair system',
    repairUser: 'repair user',
    tuning: { maxRetries: 1, repairTimeout: 60000, promptBias: 'be careful' },
  });

  assert.equal(artifact.provider, 'ollama');
  assert.equal(artifact.model, 'llamacpp.gguf');
  assert.equal(artifact.fingerprintVersion, 'cluster-repair-artifact-v1');
  assert.equal(typeof artifact.promptFingerprint, 'string');
  assert.equal(typeof artifact.repairPromptFingerprint, 'string');
  assert.equal(typeof artifact.tuningFingerprint, 'string');
  assert.equal(artifact.promptPreview, 'user prompt');
  assert.equal(artifact.repairPromptPreview, 'repair user');
  assert.deepEqual(artifact.tuning, { maxRetries: 1, repairTimeout: 60000, promptBias: 'be careful' });
});
