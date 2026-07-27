import assert from 'node:assert/strict';
import test from 'node:test';
import {
  demoAudienceLabel,
  demoControlSteps,
  demoTotalDurationSeconds,
} from './demo-control-model.ts';

test('demo control defines one bounded nine-step narrative over real product routes', () => {
  assert.equal(demoControlSteps.length, 9);
  assert.deepEqual(demoControlSteps.map(({ order }) => order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(new Set(demoControlSteps.map(({ id }) => id)).size, 9);
  assert.equal(new Set(demoControlSteps.map(({ route }) => route)).size, 9);
  assert.equal(demoTotalDurationSeconds, 570);
  assert.ok(demoTotalDurationSeconds <= 600);
  assert.deepEqual(
    demoControlSteps.map(({ route }) => route),
    [
      '/platform',
      '/student/home',
      '/student/projects/p1',
      '/course',
      '/learn/P1T1-N02',
      '/teacher/sessions/demo-class',
      '/present/demo-class',
      '/classroom/demo-class',
      '/student/projects/p1/portfolio',
    ],
  );
});

test('classroom demonstration steps prepare the same golden capability node', () => {
  const prepared = demoControlSteps.filter(({ prepareNodeId }) => prepareNodeId);
  assert.ok(prepared.length >= 5);
  assert.deepEqual(new Set(prepared.map(({ prepareNodeId }) => prepareNodeId)), new Set(['P1T1-N02']));
  assert.equal(demoControlSteps.find(({ id }) => id === 'teacher')?.audience, 'teacher');
  assert.equal(demoControlSteps.find(({ id }) => id === 'student-follow')?.audience, 'student03');
  assert.equal(demoAudienceLabel('projector'), '投屏窗口');
});
