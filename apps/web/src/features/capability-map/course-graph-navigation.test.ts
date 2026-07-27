import assert from 'node:assert/strict';
import test from 'node:test';
import { curriculumGraphNodes } from '../../platform/fixtures/curriculum-graph-fixtures.ts';
import type { CurriculumGraphNode } from '../../platform/models.ts';
import {
  activateTeacherGraphNode,
  dispatchCurriculumGraphNode,
  navigateStudentGraphNode,
} from './course-graph-navigation.ts';

test('all six P1 activity nodes route to their real formal-test or professional-output surface', () => {
  const contracts = [
    ['game-topology', 'P1T1-N02', 'formal-test', '/learn/P1T1-N02/test'],
    ['game-beam', 'P1T2-N02', 'formal-test', '/learn/P1T2-N02/test'],
    ['game-complaint', 'P1T3-N02', 'formal-test', '/learn/P1T3-N02/test'],
    ['game-evidence', 'P1T1-N04', 'professional-output', '/learn/P1T1-N04?mode=challenge'],
    ['game-route', 'P1T2-N04', 'professional-output', '/learn/P1T2-N04?mode=challenge'],
    ['evidence-p03', 'P1T3-N04', 'professional-output', '/learn/P1T3-N04?mode=challenge'],
  ] as const;

  const actual = contracts.map(([id]) => {
    const activity = curriculumGraphNodes.find((node) => node.id === id);
    assert.ok(activity, `${id} must be a real graph activity`);
    const pushed: string[] = [];

    dispatchCurriculumGraphNode(activity, {
      onNodeSelect(nodeId, action) {
        navigateStudentGraphNode((href) => pushed.push(href), nodeId, action);
      },
      onTaskSelect() {
        assert.fail(`${id} must not dispatch as a task`);
      },
    });

    assert.equal(pushed.length, 1, `${id} must have exactly one destination`);
    return [activity.id, activity.nodeId, activity.action, pushed[0]];
  });

  assert.deepEqual(actual, contracts);
});

test('keeps an ordinary capability node on the self-study route', () => {
  const capability = curriculumGraphNodes.find(({ id }) => id === 'P1T1-N02');
  assert.ok(capability);
  const pushed: string[] = [];
  dispatchCurriculumGraphNode(capability, {
    onNodeSelect(nodeId, action) {
      navigateStudentGraphNode((href) => pushed.push(href), nodeId, action);
    },
    onTaskSelect() {},
  });
  assert.deepEqual(pushed, ['/learn/P1T1-N02']);
});

test('teacher graph activation retries once with the refreshed classroom revision', async () => {
  const revisions: number[] = [];
  let refreshCount = 0;

  await activateTeacherGraphNode({
    initialRevision: 4,
    start: async (revision) => {
      revisions.push(revision);
      return revision === 4
        ? { status: 'conflict', currentRevision: 5 }
        : { status: 'started' };
    },
    refreshRevision: async () => {
      refreshCount += 1;
      return 6;
    },
  });

  assert.deepEqual(revisions, [4, 6]);
  assert.equal(refreshCount, 1);
});

test('teacher graph activation fails closed after a second revision conflict', async () => {
  await assert.rejects(
    activateTeacherGraphNode({
      initialRevision: 4,
      start: async () => ({ status: 'conflict', currentRevision: 5 }),
      refreshRevision: async () => 6,
    }),
    /课堂状态刚刚发生变化/,
  );
});

test('unknown and not-open graph entries never fall back to another learning node', () => {
  const notOpen = curriculumGraphNodes.find(({ id }) => id === 'P04');
  assert.ok(notOpen);
  const unknown = {
    id: 'missing-activity',
    kind: 'activity',
    title: '不存在的活动',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    revealAt: 'route',
  } satisfies CurriculumGraphNode;
  const destinations: string[] = [];
  const callbacks = {
    onNodeSelect(nodeId: string) {
      destinations.push(`/learn/${nodeId}`);
    },
    onTaskSelect(taskId: 'P01' | 'P02' | 'P03') {
      destinations.push(`/task/${taskId}`);
    },
  };

  dispatchCurriculumGraphNode(notOpen, callbacks);
  dispatchCurriculumGraphNode(unknown, callbacks);

  assert.equal(destinations.length, 0);
  assert.throws(
    () => navigateStudentGraphNode(
      (href) => destinations.push(href),
      'does-not-exist',
      'unsupported' as never,
    ),
    /Unsupported course graph action/,
  );
  assert.equal(destinations.length, 0);
});
