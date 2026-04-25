import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('/Users/rightclaw/services/crucix/server.mjs', 'utf8');

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  if (start === -1 || end === -1 || end <= start) throw new Error(`could not extract ${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

const code = [
  between('function buildIMessengerBrief', 'function buildBriefSections'),
  between('function buildBriefSections', '// === Delta/Memory'),
  'module.exports = { buildBriefSections };',
].join('\n');

const context = {
  module: { exports: {} },
  exports: {},
  console,
  memory: { getLastDelta: () => null },
};
vm.createContext(context);
vm.runInContext(code, context);
const { buildBriefSections } = context.module.exports;

test('compact brief macro section uses safe placeholders when macro fields are absent', () => {
  const text = buildBriefSections({
    fred: [{ id: 'VIXCLS', value: Number.NaN }],
    energy: {},
    metals: {},
    tg: {},
    ideas: [],
  }, { markdown: false });

  assert.match(text, /📊 VIX: -- \| WTI: \$-- \| Brent: \$--/);
  assert.match(text, /Gold: \$-- \| Silver: \$--/);
  assert.match(text, /NatGas: \$--/);
  assert.doesNotMatch(text, /NaN|NaNT|undefined|null/);
});
