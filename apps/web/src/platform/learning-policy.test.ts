import assert from 'node:assert/strict';
import test from 'node:test';
import { loadP1DemoContent } from '../features/platform/p1-content.ts';
import {
  deriveNodeLearningProjection,
  getNodeLearningPolicy,
  nodeLearningPolicies,
} from './learning-policy.ts';

test('P1 exposes twelve policies with N02 tests and N04 output review gates', () => {
  assert.equal(nodeLearningPolicies.length, 12);
  assert.equal(nodeLearningPolicies.every((item) => item.publicationStatus === 'published'), true);
  assert.deepEqual(nodeLearningPolicies.filter((item) => item.assessmentRole === 'node-test').map((item) => item.nodeId), [
    'P1T1-N02',
    'P1T2-N02',
    'P1T3-N02',
  ]);
  assert.deepEqual(nodeLearningPolicies.filter((item) => item.assessmentRole === 'task-pixi').map((item) => item.nodeId), []);
  assert.deepEqual(nodeLearningPolicies.filter((item) => item.requiresTeacherVerification).map((item) => item.nodeId), [
    'P1T1-N04',
    'P1T2-N04',
    'P1T3-N04',
  ]);
  for (const prefix of ['P1T1', 'P1T2', 'P1T3']) {
    const testPolicy = getNodeLearningPolicy(`${prefix}-N02`)!;
    assert.equal(testPolicy.assessmentRole, 'node-test');
    assert.equal(testPolicy.requiresFormalTest, true);
    assert.equal(testPolicy.formalPassScore, 80);

    const outputPolicy = getNodeLearningPolicy(`${prefix}-N04`)!;
    assert.equal(outputPolicy.sourceKnowledgeUnitId, `${outputPolicy.taskId}-ku-06`);
    assert.equal(outputPolicy.assessmentRole, 'none');
    assert.equal(outputPolicy.requiresFormalTest, false);
    assert.equal(outputPolicy.formalPassScore, undefined);
    assert.equal(outputPolicy.requiresProfessionalOutput, true);
    assert.equal(outputPolicy.requiresTeacherVerification, true);
  }
  assert.deepEqual(getNodeLearningPolicy('P1T3-N01')?.prerequisiteNodeIds, ['P1T2-N04']);
  assert.deepEqual(getNodeLearningPolicy('P1T3-N01')?.prerequisites, [{
    nodeId: 'P1T2-N04',
    condition: 'achieved',
  }]);
});

test('task-end state records output submission and certification without a second formal test', () => {
  const policy = getNodeLearningPolicy('P1T1-N04')!;

  const tested = deriveNodeLearningProjection(policy, {
    prerequisiteMet: true,
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
    evidenceReviewStatus: 'not-submitted',
  });
  assert.equal(tested.state, 'micro-practice-passed');
  assert.equal(tested.achieved, false);
  assert.equal(tested.stateTrail.includes('formal-test-passed'), false);

  const submitted = deriveNodeLearningProjection(policy, {
    prerequisiteMet: true,
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
    evidenceReviewStatus: 'submitted',
  });
  assert.equal(submitted.state, 'awaiting-review');
  assert.deepEqual(submitted.stateTrail.slice(-2), ['evidence-submitted', 'awaiting-review']);

  const returned = deriveNodeLearningProjection(policy, {
    prerequisiteMet: true,
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
    evidenceReviewStatus: 'returned',
  });
  assert.equal(returned.state, 'returned');

  const verified = deriveNodeLearningProjection(policy, {
    prerequisiteMet: true,
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
    evidenceReviewStatus: 'verified',
  });
  assert.equal(verified.state, 'achieved');
  assert.deepEqual(verified.stateTrail.slice(-2), ['teacher-verified', 'achieved']);
});

test('ordinary node skips output review only because its policy says so', () => {
  const policy = getNodeLearningPolicy('P1T1-N01')!;
  const projection = deriveNodeLearningProjection(policy, {
    prerequisiteMet: true,
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
    evidenceReviewStatus: 'not-submitted',
  });
  assert.equal(projection.state, 'achieved');
  assert.equal(projection.achieved, true);
});

test('every published P1 node requires exactly its generated base activities', () => {
  const expected: Record<string, readonly string[]> = {
    'P1T1-N01': ['P1T1-N01-micro-01'],
    'P1T1-N02': ['P1T1-N02-foundation-01', 'P1T1-N02-application-01', 'P1T1-N02-transfer-01'],
    'P1T1-N03': ['P1T1-N03-micro-01'],
    'P1T1-N04': ['P1T1-N04-micro-01'],
    'P1T2-N01': ['P1T2-N01-micro-01'],
    'P1T2-N02': ['P1T2-N02-foundation-01', 'P1T2-N02-application-01', 'P1T2-N02-transfer-01'],
    'P1T2-N03': ['P1T2-N03-micro-01'],
    'P1T2-N04': ['P1T2-N04-micro-01'],
    'P1T3-N01': ['P1T3-N01-micro-01'],
    'P1T3-N02': ['P1T3-N02-foundation-01', 'P1T3-N02-application-01', 'P1T3-N02-transfer-01'],
    'P1T3-N03': ['P1T3-N03-micro-01'],
    'P1T3-N04': ['P1T3-N04-micro-01'],
  };

  for (const policy of nodeLearningPolicies) {
    assert.equal(policy.publicationStatus, 'published');
    assert.ok(policy.requiredActivityIds.length > 0, policy.nodeId);
    assert.deepEqual(policy.requiredActivityIds, expected[policy.nodeId], policy.nodeId);
  }

  const generatedBaseActivities = new Map(loadP1DemoContent().tasks.flatMap((task) => (
    task.nodes.map((node) => {
      const practices = node.selfStudy.kind === 'standard'
        ? node.selfStudy.microPractice
        : [
            node.selfStudy.practices.foundation[0]!,
            node.selfStudy.practices.application[0]!,
            node.selfStudy.practices.transfer[0]!,
          ];
      return [node.id, practices.map(({ id }) => id)] as const;
    })
  )));
  for (const policy of nodeLearningPolicies) {
    assert.deepEqual(policy.requiredActivityIds, generatedBaseActivities.get(policy.nodeId), policy.nodeId);
  }
});
