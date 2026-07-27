import assert from 'node:assert/strict';
import test from 'node:test';
import { getNodeLearningPolicy } from './learning-policy.ts';
import {
  arePrerequisitesMet,
  deriveNodeLearningProjection,
  type LearningFacts,
  type PrerequisiteProgress,
} from './learning-projection.ts';
import { nodeLearningStateLabel } from './learning-status.ts';

const inactiveFacts: LearningFacts = {
  hasActivity: false,
  selfStudyComplete: false,
  microPracticePassed: false,
  evidenceReviewStatus: 'not-submitted',
};

test('all learning states expose precise Chinese labels', () => {
  assert.equal(nodeLearningStateLabel.locked, '未解锁');
  assert.equal(nodeLearningStateLabel['formal-test-passed'], '正式测试达标');
  assert.equal(nodeLearningStateLabel['awaiting-review'], '待教师复核');
  assert.equal(nodeLearningStateLabel.achieved, '能力达成');
});

test('same-task and cross-task prerequisites require the preceding node to be achieved', () => {
  const sameTask = getNodeLearningPolicy('P1T1-N02')!;
  const crossTask = getNodeLearningPolicy('P1T2-N01')!;

  assert.equal(arePrerequisitesMet(sameTask.prerequisites, [progress('P1T1-N01', { achieved: false })]), false);
  assert.equal(arePrerequisitesMet(sameTask.prerequisites, [progress('P1T1-N01', { achieved: true })]), true);

  assert.equal(arePrerequisitesMet(crossTask.prerequisites, [progress('P1T1-N04', {
    professionalOutputSubmitted: true,
    achieved: false,
  })]), false);
  assert.equal(arePrerequisitesMet(crossTask.prerequisites, [progress('P1T1-N04', {
    achieved: true,
  })]), true);
});

test('task output ignores formal scores and waits for the professional output', () => {
  const policy = getNodeLearningPolicy('P1T1-N04')!;
  const projection = deriveNodeLearningProjection(policy, {
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
    bestFormalTestScore: 100,
    evidenceReviewStatus: 'not-submitted',
  }, [progress('P1T1-N03', { achieved: true })]);

  assert.equal(projection.state, 'micro-practice-passed');
  assert.equal(projection.achieved, false);
  assert.equal(projection.stateTrail.includes('formal-test-passed'), false);
  assert.equal(projection.nextRequirement, '提交《室内设备与链路证据表》');
});

test('returned output keeps submission history and returns to review after resubmission', () => {
  const policy = getNodeLearningPolicy('P1T1-N04')!;
  const prerequisite = [progress('P1T1-N03', { achieved: true })];
  const facts = {
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
    bestFormalTestScore: 86,
  } as const;

  const returned = deriveNodeLearningProjection(policy, {
    ...facts,
    evidenceReviewStatus: 'returned',
  }, prerequisite);
  assert.equal(returned.state, 'returned');
  assert.deepEqual(returned.stateTrail.slice(-3), ['evidence-submitted', 'awaiting-review', 'returned']);

  const resubmitted = deriveNodeLearningProjection(policy, {
    ...facts,
    evidenceReviewStatus: 'submitted',
  }, prerequisite);
  assert.equal(resubmitted.state, 'awaiting-review');
  assert.equal(resubmitted.nextRequirement, '等待教师按量规复核');
});

test('ordinary nodes skip stages only because policy explicitly disables them', () => {
  const policy = getNodeLearningPolicy('P1T1-N01')!;
  assert.equal(policy.assessmentRole, 'none');
  assert.equal(policy.requiresProfessionalOutput, false);
  assert.equal(policy.requiresTeacherVerification, false);

  const available = deriveNodeLearningProjection(policy, inactiveFacts, []);
  assert.equal(available.state, 'available');

  const practiced = deriveNodeLearningProjection(policy, {
    ...inactiveFacts,
    hasActivity: true,
    microPracticePassed: true,
  }, []);
  assert.equal(practiced.state, 'micro-practice-passed');
  assert.equal(practiced.nextRequirement, '保存本节点学习记录');

  const achieved = deriveNodeLearningProjection(policy, {
    ...inactiveFacts,
    hasActivity: true,
    selfStudyComplete: true,
    microPracticePassed: true,
  }, []);
  assert.equal(achieved.state, 'achieved');
  assert.deepEqual(achieved.stateTrail, ['learning', 'micro-practice-passed', 'achieved']);
});

function progress(nodeId: string, overrides: Partial<PrerequisiteProgress>): PrerequisiteProgress {
  return {
    nodeId,
    achieved: false,
    formalTestPassed: false,
    professionalOutputSubmitted: false,
    ...overrides,
  };
}
