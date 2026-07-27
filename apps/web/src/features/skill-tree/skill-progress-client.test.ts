import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { fetchClassLearningProgress, fetchLearningProgress, projectStudentLearningSnapshot, recordLearningEvent, recordSkillEvent } from './skill-progress-client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('reads only the authenticated student snapshot from /api/learning/me', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({
      version: 4,
      globalVersion: 12,
      studentId: 'stu-02',
      nodes: [{
        nodeId: 'P1T1-N02',
        state: 'formal-test-passed',
        stateTrail: ['learning', 'micro-practice-passed', 'formal-test-passed'],
        completedSections: ['problem', 'figure', 'steps', 'correction', 'practice', 'output'],
        attempts: [{
          attemptId: 'attempt-1',
          nodeId: 'P1T1-N02',
          gameId: 'P1T1-N02-test',
          score: 88,
          durationSeconds: 42,
          mistakeKnowledgePointIds: ['kp-direction'],
          completedAt: '2026-07-15T10:00:00.000Z',
        }],
        prerequisites: [],
        bestFormalScore: 88,
        nextRequirement: '进入下一节点',
      }],
      tasks: [{ taskId: 'P01', nodeTestHighestScore: 88 }],
    });
  };

  const snapshot = await fetchLearningProgress();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, '/api/learning/me');
  assert.deepEqual(requests[0]?.init, { cache: 'no-store' });
  assert.equal(snapshot.version, 4);
  assert.equal(snapshot.globalVersion, 12);
  assert.equal(snapshot.studentId, 'stu-02');
  assert.equal(snapshot.progress[0]?.nodeId, 'P1T1-N02');
  assert.equal(snapshot.progress[0]?.bestGameScore, 88);
  assert.equal(snapshot.tasks[0]?.taskId, 'P01');
  assert.equal(snapshot.tasks[0]?.gameScore, 88);
});

test('teacher reads an authorized class snapshot without requesting students individually', async () => {
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({
      classId: 'demo class',
      version: 21,
      students: [{
        version: 3,
        globalVersion: 21,
        studentId: 'stu-03',
        nodes: [],
        tasks: [],
      }],
    });
  };

  const snapshot = await fetchClassLearningProgress('demo class');

  assert.deepEqual(requests, ['/api/learning/class/demo%20class']);
  assert.equal(snapshot.classId, 'demo class');
  assert.equal(snapshot.version, 21);
  assert.equal(snapshot.students[0]?.studentId, 'stu-03');
  assert.deepEqual(snapshot.students[0]?.progress, []);
});

test('compatibility projection keeps an untested node and unformed task score absent', () => {
  const projected = projectStudentLearningSnapshot({
    version: 1,
    globalVersion: 1,
    studentId: 'stu-01',
    nodes: [{
      nodeId: 'P1T1-N02',
      state: 'available',
      stateTrail: ['available'],
      completedSections: [],
      classroomSubmitted: false,
      attempts: [],
      prerequisites: [],
      nextRequirement: '开始学习',
    }],
    tasks: [{ taskId: 'P01', realTaskCertified: false, demoTaskCertified: false }],
  });

  assert.equal(projected.progress[0]?.gameScore, undefined);
  assert.equal(projected.progress[0]?.firstGameScore, undefined);
  assert.equal(projected.progress[0]?.bestGameScore, undefined);
  assert.equal(projected.progress[0]?.latestGameScore, undefined);
  assert.equal(projected.tasks[0]?.gameScore, undefined);
  assert.equal(projected.tasks[0]?.taskScore, undefined);
});

test('compatibility projection preserves persisted origins for node, attempts, task, and project', () => {
  const projected = projectStudentLearningSnapshot({
    version: 7,
    globalVersion: 17,
    studentId: 'stu-03',
    nodes: [{
      nodeId: 'P1T1-N02',
      state: 'formal-test-passed',
      stateTrail: ['learning', 'micro-practice-passed', 'formal-test-passed'],
      completedSections: ['problem', 'figure', 'steps', 'correction', 'practice', 'output'],
      classroomSubmitted: false,
      attempts: [{
        attemptId: 'demo-formal-attempt',
        nodeId: 'P1T1-N02',
        gameId: 'P1T1-N02-formal',
        score: 93,
        mistakeKnowledgePointIds: ['kp-direction'],
        completedAt: '2026-07-16T08:00:00.000Z',
        origin: 'demo',
      }],
      prerequisites: [],
      bestFormalScore: 93,
      nextRequirement: '继续学习',
      origin: 'demo',
    }],
    tasks: [{
      taskId: 'P01',
      nodeTestHighestScore: 93,
      taskCompositeScore: 94,
      origin: 'demo',
      realTaskCertified: false,
      demoTaskCertified: true,
    }],
    projectCompositeScore: 94,
    projectCompositeOrigin: 'demo',
  });

  assert.equal(projected.progress[0]?.origin, 'demo');
  assert.equal(projected.progress[0]?.gameAttempts?.[0]?.origin, 'demo');
  assert.equal(projected.tasks[0]?.origin, 'demo');
  assert.equal(projected.projectCompositeOrigin, 'demo');
});

test('compatibility projection preserves a real zero score while workflow completion follows canonical state', () => {
  const projected = projectStudentLearningSnapshot({
    version: 2,
    globalVersion: 2,
    studentId: 'stu-01',
    nodes: [{
      nodeId: 'P1T1-N02',
      state: 'formal-test-passed',
      stateTrail: ['learning', 'micro-practice-passed', 'formal-test-passed'],
      completedSections: [],
      classroomSubmitted: false,
      attempts: [{
        attemptId: 'zero-attempt',
        nodeId: 'P1T1-N02',
        gameId: 'node-test',
        score: 0,
        mistakeKnowledgePointIds: [],
        completedAt: '2026-07-16T02:00:00.000Z',
      }],
      prerequisites: [],
      bestFormalScore: 0,
      nextRequirement: '继续学习',
    }],
    tasks: [{
      taskId: 'P01', nodeTestHighestScore: 0,
      realTaskCertified: false, demoTaskCertified: false,
    }],
  });

  assert.equal(projected.progress[0]?.gameScore, 0);
  assert.equal(projected.progress[0]?.firstGameScore, 0);
  assert.equal(projected.progress[0]?.bestGameScore, 0);
  assert.equal(projected.progress[0]?.latestGameScore, 0);
  assert.equal(projected.progress[0]?.gameAttempts?.[0]?.durationSeconds, undefined);
  assert.equal(projected.progress[0]?.masteryPercent, 60);
  assert.equal(projected.tasks[0]?.gameScore, 0);
  assert.equal(projected.tasks[0]?.masteryPercent, 15);
});

test('records a formal attempt through the actor-scoped node attempts command', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({
      version: 5,
      globalVersion: 13,
      studentId: 'stu-02',
      nodes: [],
      tasks: [],
    });
  };

  await recordSkillEvent({
    nodeId: 'P1T1-N02',
    channel: 'game',
    type: 'game_completed',
    score: 91,
    completed: true,
    attemptId: 'attempt-2',
    gameId: 'P1T1-N02-test',
    durationSeconds: 38,
    mistakeKnowledgePointIds: ['kp-identity'],
  }, 4);

  assert.equal(requests[0]?.input, '/api/learning/nodes/P1T1-N02/attempts');
  assert.equal(requests[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    attemptId: 'attempt-2',
    gameId: 'P1T1-N02-test',
    score: 91,
    durationSeconds: 38,
    mistakeKnowledgePointIds: ['kp-identity'],
    expectedVersion: 4,
  });
});

test('records a learning event with optimistic version through the node events command', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({
      version: 8,
      globalVersion: 18,
      studentId: 'stu-01',
      nodes: [],
      tasks: [],
    });
  };

  const next = await recordLearningEvent({
    eventId: 'event-section-1',
    nodeId: 'P1T1-N01',
    channel: 'self-study',
    type: 'section_completed',
    sectionId: 'problem',
    completed: true,
    at: '2026-07-15T11:00:00.000Z',
  }, 7);

  assert.equal(requests[0]?.input, '/api/learning/nodes/P1T1-N01/events');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    eventId: 'event-section-1',
    channel: 'self-study',
    eventType: 'section_completed',
    payload: { sectionId: 'problem', completed: true },
    occurredAt: '2026-07-15T11:00:00.000Z',
    expectedVersion: 7,
  });
  assert.equal(next.version, 8);
});

test('keeps non-formal game completion as a learning event instead of a formal attempt', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({ version: 2, globalVersion: 9, studentId: 'stu-01', nodes: [], tasks: [] });
  };

  await recordLearningEvent({
    eventId: 'micro-game-1',
    nodeId: 'P1T1-N01',
    channel: 'game',
    type: 'game_completed',
    formal: false,
    score: 75,
    stars: 2,
    completed: true,
    gameId: 'micro-position',
    attemptId: 'micro-attempt-1',
    durationSeconds: 18,
    mistakeKnowledgePointIds: ['kp-position'],
  }, 1);

  assert.equal(requests[0]?.input, '/api/learning/nodes/P1T1-N01/events');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)).payload, {
    score: 75,
    stars: 2,
    completed: true,
    mistakeKnowledgePointIds: ['kp-position'],
    gameId: 'micro-position',
    attemptId: 'micro-attempt-1',
    durationSeconds: 18,
    formal: false,
  });
});

test('does not invent a passed formal test for an achieved node without a formal-test policy', () => {
  const projected = projectStudentLearningSnapshot({
    version: 9,
    globalVersion: 19,
    studentId: 'stu-01',
    nodes: [{
      nodeId: 'P1T1-N04',
      state: 'achieved',
      stateTrail: ['learning', 'micro-practice-passed', 'evidence-submitted', 'awaiting-review', 'teacher-verified', 'achieved'],
      completedSections: ['problem', 'figure', 'steps', 'correction', 'practice', 'output'],
      classroomSubmitted: false,
      attempts: [],
      prerequisites: [{ nodeId: 'P1T1-N03', condition: 'achieved', state: 'achieved', met: true }],
      evidence: {
        outputId: 'output-1',
        taskId: 'P01',
        nodeId: 'P1T1-N04',
        status: 'verified',
        content: { evidenceText: 'verified evidence' },
        submittedAt: '2026-07-15T10:00:00.000Z',
        createdAt: '2026-07-15T09:00:00.000Z',
        updatedAt: '2026-07-15T11:00:00.000Z',
      },
      nextRequirement: '进入下一任务',
    }],
    tasks: [{
      taskId: 'P01', nodeTestHighestScore: 88, outputRubricScore: 90, taskCompositeScore: 89,
      realTaskCertified: true, demoTaskCertified: false,
    }],
  });

  assert.equal(projected.progress[0]?.requiresFormalTest, false);
  assert.equal(projected.progress[0]?.formalTestPassed, false);
  assert.deepEqual(projected.tasks[0]?.requiredNodeIds, [
    'P1T1-N01', 'P1T1-N02', 'P1T1-N03', 'P1T1-N04',
  ]);
  assert.deepEqual(projected.tasks[0]?.masteredNodeIds, ['P1T1-N04']);
  assert.equal(projected.tasks[0]?.officialScore, 89);
});

test('does not certify a task when an output row says verified but verified review facts are absent', () => {
  const projected = projectStudentLearningSnapshot({
    version: 11,
    globalVersion: 20,
    studentId: 'stu-01',
    nodes: [{
      nodeId: 'P1T1-N04',
      state: 'awaiting-review',
      stateTrail: ['learning', 'micro-practice-passed', 'evidence-submitted', 'awaiting-review'],
      completedSections: [],
      classroomSubmitted: false,
      attempts: [],
      prerequisites: [{ nodeId: 'P1T1-N03', condition: 'achieved', state: 'achieved', met: true }],
      evidence: {
        outputId: 'inconsistent-output',
        taskId: 'P01',
        nodeId: 'P1T1-N04',
        status: 'verified',
        content: { evidenceText: 'output without a verified review' },
        createdAt: '2026-07-15T09:00:00.000Z',
        updatedAt: '2026-07-15T11:00:00.000Z',
      },
      nextRequirement: '等待教师复核',
    }],
    tasks: [{
      taskId: 'P01', nodeTestHighestScore: 88,
      realTaskCertified: false, demoTaskCertified: false,
    }],
  });

  assert.equal(projected.progress[0]?.teacherVerified, false);
  assert.equal(projected.tasks[0]?.teacherVerified, false);
  assert.notEqual(projected.tasks[0]?.state, 'verified');
  assert.equal(projected.tasks[0]?.officialScore, undefined);
});
