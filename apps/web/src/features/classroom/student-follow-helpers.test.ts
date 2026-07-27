import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillProgress, StudentProgress } from '@/platform/models';
import { buildFormalTestProgress } from './student-follow-helpers.ts';

const student: StudentProgress = {
  studentId: 'stu-01',
  name: 'Student One',
  group: 'A',
  mode: 'follow',
  currentSlideIndex: 2,
  selfStudyState: 'in_progress',
  submissionState: 'draft',
  evidenceCount: 0,
  lastAction: 'Waiting for the formal test.',
  risk: 'watch',
};

const nodeProgress: SkillProgress = {
  studentId: 'stu-01',
  nodeId: 'P1T1-N02',
  state: 'mastered',
  masteryPercent: 100,
  completedSectionIds: ['problem', 'figure', 'steps', 'correction', 'practice', 'output'],
  requiredSectionIds: ['problem', 'figure', 'steps', 'correction', 'practice', 'output'],
  classroomSubmitted: false,
  gameScore: 87,
  gameStars: 2,
  mistakeKnowledgePointIds: ['P1T1-N02-power'],
  gameAttempts: [{
    attemptId: 'formal-87',
    gameId: 'P1T1-N02',
    nodeId: 'P1T1-N02',
    score: 87,
    durationSeconds: 73,
    formal: true,
    completedAt: '2026-07-12T09:00:00.000Z',
    mistakeKnowledgePointIds: ['P1T1-N02-power'],
  }],
  firstGameScore: 87,
  bestGameScore: 87,
  latestGameScore: 87,
  attemptCount: 1,
  evidenceSubmitted: true,
  evidenceReviewStatus: 'returned',
  evidenceText: 'Cabinet 02 port evidence needs a clearer recovery judgment.',
  teacherFeedback: 'Name the power-path evidence before resubmitting.',
  teacherVerified: false,
};

test('maps live formal progress and returned evidence onto the current student', () => {
  const result = buildFormalTestProgress(student, nodeProgress, 'Formal test completed at 87 points.');

  assert.equal(result.activeNodeId, 'P1T1-N02');
  assert.equal(result.firstGameScore, 87);
  assert.equal(result.bestGameScore, 87);
  assert.equal(result.latestGameScore, 87);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.gameDurationSeconds, 73);
  assert.deepEqual(result.mistakeKnowledgePointIds, ['P1T1-N02-power']);
  assert.equal(result.evidenceReviewStatus, 'returned');
  assert.equal(result.teacherFeedback, 'Name the power-path evidence before resubmitting.');
  assert.equal(result.lastAction, 'Formal test completed at 87 points.');
});
