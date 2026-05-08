import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync(new URL('../local-fork/plan.json', import.meta.url), 'utf8'));
const backlog = readFileSync(new URL('../local-fork/BACKLOG.md', import.meta.url), 'utf8');

function getCompletedEffortTitles() {
  return (plan.roadmap?.epics || [])
    .flatMap(epic => epic.efforts || [])
    .filter(effort => effort.status === 'completed')
    .map(effort => effort.title);
}

test('backlog does not repeat already-completed roadmap effort titles', () => {
  const completedTitles = getCompletedEffortTitles();
  const repeated = completedTitles.filter(title => backlog.includes(title));
  assert.deepEqual(repeated, []);
});

test('backlog integrated marker does not coexist with candidate recommendation bullets', () => {
  const saysIntegrated = backlog.includes('All current backlog items were integrated into `local-fork/plan.json`');
  const candidateSection = backlog.split('## Candidate backlog items')[1] || '';
  const bulletLines = candidateSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '));

  if (saysIntegrated) {
    assert.deepEqual(bulletLines, []);
  }
});
