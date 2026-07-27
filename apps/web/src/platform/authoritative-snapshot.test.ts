import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedActor } from './auth/actor.ts';
import { ClassroomParticipationRepository } from './classroom-participation-repository.ts';
import { ClassroomSessionRepository } from './classroom-session-repository.ts';
import { seedDemo } from './db/demo-seed.ts';
import { migrateDatabase } from './db/migrations.ts';
import { createTestDatabase } from './db/test-database.ts';
import { LearningRepository } from './learning-repository.ts';
import { FormalAssessmentService, type AssessmentAnswers } from './formal-assessment-service.ts';
import {
  AuthoritativeSnapshotAuthorizationError,
  AuthoritativeSnapshotReader,
  type AuthoritativeSnapshot,
} from './authoritative-snapshot.ts';
import { REQUIRED_SELF_STUDY_SECTIONS } from './self-study-sections.ts';

const now = new Date('2026-07-16T01:20:00.000Z');

test('one authoritative transaction yields identical common facts and audience-safe cuts', () => {
  const restoreHelperMode = setStrictClassroomHelper(false);
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const reader = new AuthoritativeSnapshotReader(fixture.database);
    const student = reader.read(studentActor('stu-01'), 'student', { now });
    const teacher = reader.read(teacherActor(), 'teacher', { now });
    const projector = reader.read(teacherActor(), 'projector', { now });
    const studentGraph = reader.read(studentActor('stu-01'), 'graph', { now });
    const teacherGraph = reader.read(teacherActor(), 'graph', { now });

    const expectedVersion = fixture.database.prepare(`
      SELECT version FROM snapshot_versions WHERE topic = 'global'
    `).pluck().get();
    assert.equal(student.snapshotVersion, expectedVersion);
    assert.deepEqual(commonOf(student), commonOf(teacher));
    assert.deepEqual(commonOf(student), commonOf(projector));
    assert.deepEqual(commonOf(student), commonOf(studentGraph));
    assert.deepEqual(commonOf(student), commonOf(teacherGraph));
    assert.deepEqual(student.membership, { classSize: 3, joinedCount: 0, followingCount: 0 });
    assert.equal(student.classroom.sessionId, 'demo-class');
    assert.equal(student.classroom.activeNodeId, 'P1T1-N02');
    assert.deepEqual(student.helper, {
      status: 'online',
      observedAt: now.toISOString(),
      onlineStudentDeviceCount: 3,
      commandDelivery: { applied: 0, pending: 0, failed: 0 },
      canPush: true,
    });

    assert.equal(student.audience, 'student');
    assert.equal(student.me.studentId, 'stu-01');
    assert.equal(student.me.learning.studentId, 'stu-01');
    assert.equal(student.me.learning.version, student.me.studentVersion);
    assert.equal(
      student.me.learning.nodes.find(({ nodeId }) => nodeId === 'P1T1-N02')?.bestFormalScore,
      undefined,
    );
    assert.equal(student.me.nodes.find(({ nodeId }) => nodeId === 'P1T1-N02')?.nodeTestHighestScore, undefined);
    assert.equal('students' in student, false);

    assert.equal(teacher.audience, 'teacher');
    assert.deepEqual(teacher.students.map(({ studentId }) => studentId), ['stu-01', 'stu-02', 'stu-03']);
    assert.equal(teacher.students[0]?.nodes.length, 12);
    assert.equal(teacher.students.some((detail) => 'learning' in detail), false);

    assert.equal(studentGraph.audience, 'graph');
    assert.equal(studentGraph.mode, 'student');
    assert.equal(studentGraph.me.studentId, 'stu-01');
    assert.equal(teacherGraph.audience, 'graph');
    assert.equal(teacherGraph.mode, 'teacher');
    assert.equal(teacherGraph.nodeHeatmap.length, 12);
    assert.deepEqual(
      teacherGraph.tasks.map(({ taskId, taskCompositeScore, origin }) => ({
        taskId,
        taskCompositeScore,
        origin,
      })),
      [
        { taskId: 'P01', taskCompositeScore: 94, origin: 'demo' },
        { taskId: 'P02', taskCompositeScore: 92, origin: 'demo' },
        { taskId: 'P03', taskCompositeScore: 91, origin: 'demo' },
      ],
    );

    assert.equal(projector.audience, 'projector');
    assertProjectorContainsNoPersonalData(projector);
  } finally {
    fixture.cleanup();
    restoreHelperMode();
  }
});

test('strict helper mode reports an offline demo classroom without a live student heartbeat', () => {
  const restoreHelperMode = setStrictClassroomHelper(true);
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);

    const snapshot = new AuthoritativeSnapshotReader(fixture.database)
      .read(teacherActor(), 'teacher', { now });

    assert.deepEqual(snapshot.helper, {
      status: 'offline',
      observedAt: now.toISOString(),
      onlineStudentDeviceCount: 0,
      commandDelivery: { applied: 0, pending: 0, failed: 0 },
      canPush: false,
    });
  } finally {
    fixture.cleanup();
    restoreHelperMode();
  }
});

test('score and submission fields keep their distinct authoritative meanings', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const snapshot = new AuthoritativeSnapshotReader(fixture.database)
      .read(teacherActor(), 'teacher', { now });

    assert.deepEqual(snapshot.submissions.classroomActivity, {
      submittedCount: 0,
      submissionPercent: 0,
    });
    assert.deepEqual(snapshot.submissions.activeAssessment, {
      status: 'idle',
      eligibleCount: 3,
      submittedCount: 0,
      playingCount: 0,
      passedCount: 0,
      submissionPercent: 0,
    });
    assert.deepEqual(snapshot.submissions.professionalOutputs, {
      submittedAwaitingReviewCount: 0,
      returnedCount: 1,
      verifiedCount: 3,
    });
    assert.deepEqual(snapshot.classScores, {
      activeNodeTestHighestScore: 93,
      activeNodeTestAverageScore: 90.5,
      activeTaskCompositeAverageScore: 94,
      projectCompositeAverageScore: 92,
      distribution: [
        { range: '90-100', count: 1 },
        { range: 'pass-89', count: 1 },
        { range: '60-below-pass', count: 0 },
        { range: 'below-60', count: 0 },
      ],
      demoData: true,
    });
    assert.equal(snapshot.students[0]?.nodes.every(({ origin }) => origin === undefined), true);
    assert.equal(snapshot.students[1]?.nodes.find(({ nodeId }) => nodeId === 'P1T1-N04')?.origin, 'demo');
    assert.equal(snapshot.students[2]?.tasks.every(({ origin }) => origin === 'demo'), true);
  } finally {
    fixture.cleanup();
  }
});

test('historical demo attempts never enter active assessment submission statistics', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const classroom = new ClassroomSessionRepository(fixture.database).readSession('demo-class');
    assert.ok(classroom);
    classroom.state.formalTest = {
      assessmentId: 'demo-assessment-stu-03-p01',
      runId: 'classroom-run-historical-proof',
      gameId: 'p01-n02-formal',
      nodeId: 'P1T1-N02',
      status: 'running',
      durationSeconds: 300,
      startedAt: '2026-07-16T00:30:00.000Z',
    };
    fixture.database.prepare(`
      UPDATE classroom_sessions SET status = 'active', state_json = ?
      WHERE session_id = 'demo-class'
    `).run(JSON.stringify(classroom.state));

    const snapshot = new AuthoritativeSnapshotReader(fixture.database).read(
      teacherActor(),
      'teacher',
      { now },
    );
    assert.deepEqual(snapshot.submissions.activeAssessment, {
      status: 'running',
      eligibleCount: 3,
      submittedCount: 0,
      playingCount: 3,
      passedCount: 0,
      submissionPercent: 0,
    });
  } finally {
    fixture.cleanup();
  }
});

test('counts a real submission by shared classroom run while preserving its unique student assessment identity', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, 'stu-01');
    const classroom = new ClassroomSessionRepository(fixture.database).readSession('demo-class');
    assert.ok(classroom);
    classroom.state.formalTest = {
      assessmentId: 'AS-P1T1-N02',
      runId: 'classroom-run-shared-01',
      gameId: 'P1T1-N02-server-assessment',
      nodeId: 'P1T1-N02',
      status: 'running',
      durationSeconds: 900,
      startedAt: '2026-07-16T01:10:00.000Z',
    };
    fixture.database.prepare(`
      UPDATE classroom_sessions SET status = 'active', state_json = ?
      WHERE session_id = 'demo-class'
    `).run(JSON.stringify(classroom.state));
    let sequence = 0;
    const assessment = new FormalAssessmentService(fixture.database, {
      now: () => new Date('2026-07-16T01:15:00.000Z'),
      randomId: () => `live-${++sequence}`,
      randomToken: () => `live-token-${++sequence}-0123456789abcdef`,
    });
    const selfIssued = assessment.issuePaper(studentActor('stu-01'), 'P1T1-N02');
    assessment.submitAnswers(
      studentActor('stu-01'),
      selfIssued.attemptToken,
      passingAssessmentAnswers(),
    );
    const issued = assessment.issuePaper(studentActor('stu-01'), 'P1T1-N02', {
      classroomSessionId: 'demo-class',
    });
    assessment.submitAnswers(studentActor('stu-01'), issued.attemptToken, wrongAssessmentAnswers());

    const snapshot = new AuthoritativeSnapshotReader(fixture.database)
      .read(teacherActor(), 'teacher', { now });

    assert.notEqual(issued.assessmentId, classroom.state.formalTest.runId);
    const bindings = fixture.database.prepare(`
      SELECT assessment_id AS assessmentId, classroom_run_id AS classroomRunId
      FROM formal_assessment_instances
      WHERE assessment_id IN (?, ?)
      ORDER BY assessment_id
    `).all(selfIssued.assessmentId, issued.assessmentId) as Array<{
      assessmentId: string;
      classroomRunId: string | null;
    }>;
    assert.equal(bindings.find(({ assessmentId }) => assessmentId === selfIssued.assessmentId)?.classroomRunId, null);
    assert.equal(bindings.find(({ assessmentId }) => assessmentId === issued.assessmentId)?.classroomRunId, 'classroom-run-shared-01');
    assert.deepEqual(snapshot.submissions.activeAssessment, {
      status: 'running',
      eligibleCount: 3,
      submittedCount: 1,
      playingCount: 2,
      passedCount: 0,
      submissionPercent: 33.3,
      passRatePercent: 0,
    });

    classroom.state.formalTest.status = 'review';
    classroom.state.reviewState = 'reviewing';
    fixture.database.prepare(`
      UPDATE classroom_sessions SET state_json = ? WHERE session_id = 'demo-class'
    `).run(JSON.stringify(classroom.state));
    const projectorReview = new AuthoritativeSnapshotReader(fixture.database)
      .read(teacherActor(), 'projector', { now });
    assert.deepEqual(projectorReview.submissions.activeAssessment.errorDistribution, [
      { dimension: 'evidenceClassification', incorrectCount: 1, percent: 100 },
      { dimension: 'linkReconstruction', incorrectCount: 1, percent: 100 },
      { dimension: 'defectiveOutputRevision', incorrectCount: 1, percent: 100 },
      { dimension: 'professionalConclusion', incorrectCount: 1, percent: 100 },
    ]);
    assertProjectorContainsNoPersonalData(projectorReview);
    const serializedReview = JSON.stringify(projectorReview.submissions.activeAssessment);
    for (const forbidden of ['stu-01', 'student01', 'answers', 'feedback', 'evidenceText']) {
      assert.equal(serializedReview.includes(forbidden), false);
    }
  } finally {
    fixture.cleanup();
  }
});

test('running assessment excludes unbound attempts even when their old assessment id and time appear current', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const classroom = new ClassroomSessionRepository(fixture.database).readSession('demo-class');
    assert.ok(classroom);
    classroom.state.formalTest = {
      assessmentId: 'assessment-current',
      runId: 'classroom-run-current',
      gameId: 'P1T1-N02-formal',
      nodeId: 'P1T1-N02',
      status: 'running',
      durationSeconds: 300,
      startedAt: '2026-07-16T01:10:00.000Z',
    };
    fixture.database.exec(`
      INSERT INTO formal_assessment_instances (
        assessment_id, session_id, node_id, game_id, question_version, status, opened_at, closed_at
      ) VALUES
        (
          'assessment-history', 'demo-class', 'P1T1-N02', 'P1T1-N02-formal',
          'question-v0', 'closed', '2026-07-16T01:10:00.000Z', '2026-07-16T01:18:00.000Z'
        ),
        (
          'assessment-current', 'demo-class', 'P1T1-N02', 'P1T1-N02-formal',
          'question-v1', 'running', '2026-07-16T01:10:00.000Z', NULL
        );
    `);
    fixture.database.prepare(`
      UPDATE classroom_sessions
      SET status = 'active', state_json = ?
      WHERE session_id = 'demo-class'
    `).run(JSON.stringify(classroom.state));
    const learning = new LearningRepository(fixture.database);
    learning.recordFormalAttempt({
      attemptId: 'current-window-zero',
      studentId: 'stu-01',
      nodeId: 'P1T1-N02',
      assessmentId: 'assessment-current',
      gameId: 'P1T1-N02-formal',
      score: 0,
      completedAt: '2026-07-16T01:15:00.000Z',
    }, learning.readTopicVersion('learning:stu-01'));
    learning.recordFormalAttempt({
      attemptId: 'current-window-history-assessment',
      studentId: 'stu-02',
      nodeId: 'P1T1-N02',
      assessmentId: 'assessment-history',
      gameId: 'P1T1-N02-formal',
      score: 100,
      completedAt: '2026-07-16T01:16:00.000Z',
    }, learning.readTopicVersion('learning:stu-02'));
    learning.recordFormalAttempt({
      attemptId: 'current-assessment-other-game',
      studentId: 'stu-02',
      nodeId: 'P1T1-N02',
      assessmentId: 'assessment-current',
      gameId: 'other-formal-game',
      score: 100,
      completedAt: '2026-07-16T01:17:00.000Z',
    }, learning.readTopicVersion('learning:stu-02'));
    learning.recordFormalAttempt({
      attemptId: 'current-window-after-observation',
      studentId: 'stu-03',
      nodeId: 'P1T1-N02',
      assessmentId: 'assessment-current',
      gameId: 'P1T1-N02-formal',
      score: 100,
      completedAt: '2026-07-16T01:21:00.000Z',
    }, learning.readTopicVersion('learning:stu-03'));

    const snapshot = new AuthoritativeSnapshotReader(fixture.database)
      .read(teacherActor(), 'teacher', { now });

    assert.deepEqual(snapshot.submissions.activeAssessment, {
      status: 'running',
      eligibleCount: 3,
      submittedCount: 0,
      playingCount: 3,
      passedCount: 0,
      submissionPercent: 0,
    });
  } finally {
    fixture.cleanup();
  }
});

test('classroom lifecycle, participation, and helper availability remain separate synchronized axes', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.prepare(`
      UPDATE classroom_sessions SET status = 'active' WHERE session_id = 'demo-class'
    `).run();
    const participation = new ClassroomParticipationRepository(fixture.database);
    participation.join('demo-class', 'stu-01', new Date('2026-07-16T01:19:55.000Z'));
    participation.setMode('demo-class', 'stu-01', 'self', new Date('2026-07-16T01:19:56.000Z'));
    new ClassroomSessionRepository(fixture.database).recordHeartbeat('demo-class', {
      deviceId: 'private-student-device',
      actorRole: 'student',
      studentId: 'stu-01',
      pageState: 'ready',
      lastAppliedRevision: 0,
    }, new Date('2026-07-16T01:19:59.000Z'));

    const reader = new AuthoritativeSnapshotReader(fixture.database);
    const student = reader.read(studentActor('stu-01'), 'student', { now });
    const teacher = reader.read(teacherActor(), 'teacher', { now });
    const projector = reader.read(teacherActor(), 'projector', { now });

    assert.deepEqual(commonOf(student), commonOf(teacher));
    assert.deepEqual(commonOf(student), commonOf(projector));
    assert.equal(student.classroom.status, 'active');
    assert.deepEqual(student.membership, { classSize: 3, joinedCount: 1, followingCount: 0 });
    assert.equal(student.helper.status, 'online');
    assert.equal(student.helper.onlineStudentDeviceCount, 1);
    assert.equal(student.helper.canPush, true);
    assert.equal(JSON.stringify(projector).includes('private-student-device'), false);
  } finally {
    fixture.cleanup();
  }
});

test('classroom helper counts one online student once across multiple devices', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const sessions = new ClassroomSessionRepository(fixture.database);
    sessions.recordHeartbeat('demo-class', {
      deviceId: 'stu-01-tablet',
      actorRole: 'student',
      studentId: 'stu-01',
      pageState: 'ready',
      lastAppliedRevision: 0,
    }, new Date('2026-07-16T01:19:57.000Z'));
    sessions.recordHeartbeat('demo-class', {
      deviceId: 'stu-01-browser',
      actorRole: 'student',
      studentId: 'stu-01',
      pageState: 'ready',
      lastAppliedRevision: 0,
    }, new Date('2026-07-16T01:19:58.000Z'));
    sessions.recordHeartbeat('demo-class', {
      deviceId: 'stu-02-browser',
      actorRole: 'student',
      studentId: 'stu-02',
      pageState: 'ready',
      lastAppliedRevision: 0,
    }, new Date('2026-07-16T01:19:59.000Z'));

    const snapshot = new AuthoritativeSnapshotReader(fixture.database)
      .read(teacherActor(), 'teacher', { now });

    assert.equal(snapshot.helper.onlineStudentDeviceCount, 2);
  } finally {
    fixture.cleanup();
  }
});

test('teacher snapshot naturally expands from three to twenty-four active members', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const insertUser = fixture.database.prepare(`
      INSERT INTO users (id, username, display_name, role, password_hash, is_active)
      VALUES (?, ?, ?, 'student', 'test-hash', 1)
    `);
    const insertMember = fixture.database.prepare(`
      INSERT INTO classroom_members (session_id, student_id) VALUES ('demo-class', ?)
    `);
    fixture.database.transaction(() => {
      for (let index = 4; index <= 24; index += 1) {
        const id = `stu-${String(index).padStart(2, '0')}`;
        insertUser.run(id, `student${String(index).padStart(2, '0')}`, `学生${index}`);
        insertMember.run(id);
      }
    }).immediate();

    const snapshot = new AuthoritativeSnapshotReader(fixture.database)
      .read(teacherActor(), 'teacher', { now });

    assert.equal(snapshot.membership.classSize, 24);
    assert.equal(snapshot.students.length, 24);
    assert.equal(snapshot.submissions.activeAssessment.eligibleCount, 24);
  } finally {
    fixture.cleanup();
  }
});

test('audience authorization fails closed before returning a snapshot', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const reader = new AuthoritativeSnapshotReader(fixture.database);

    assert.throws(
      () => reader.read(studentActor('stu-01'), 'teacher', { now }),
      AuthoritativeSnapshotAuthorizationError,
    );
    assert.throws(
      () => reader.read(studentActor('stu-01'), 'projector', { now }),
      AuthoritativeSnapshotAuthorizationError,
    );
    assert.throws(
      () => reader.read({ ...teacherActor(), classId: 'other-class' }, 'teacher', { now }),
      AuthoritativeSnapshotAuthorizationError,
    );
    assert.throws(
      () => reader.read({ ...studentActor('stu-01'), studentId: 'stu-02' }, 'student', { now }),
      AuthoritativeSnapshotAuthorizationError,
    );
  } finally {
    fixture.cleanup();
  }
});

function commonOf(snapshot: AuthoritativeSnapshot): Record<string, unknown> {
  const copy = { ...snapshot } as Record<string, unknown>;
  delete copy.audience;
  delete copy.me;
  delete copy.students;
  delete copy.weakPoints;
  delete copy.mode;
  delete copy.nodeHeatmap;
  delete copy.tasks;
  return copy;
}

function assertProjectorContainsNoPersonalData(snapshot: AuthoritativeSnapshot & { audience: 'projector' }): void {
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ['stu-01', 'stu-02', 'stu-03', '学生一', '学生二', '学生三']) {
    assert.equal(serialized.includes(forbidden), false, `projector leaked ${forbidden}`);
  }
  const forbiddenKeys = new Set([
    'studentId', 'students', 'participants', 'roster', 'devices', 'acks',
    'displayName', 'username', 'deviceId', 'outputId', 'feedback', 'answers', 'evidenceText',
  ]);
  visit(snapshot, (key) => assert.equal(forbiddenKeys.has(key), false, `projector leaked key ${key}`));
}

function visit(value: unknown, check: (key: string) => void): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    check(key);
    visit(nested, check);
  }
}

function teacherActor(): AuthenticatedActor {
  return {
    userId: 'teacher-01',
    username: 'teacher01',
    displayName: '张老师',
    role: 'teacher',
    classId: 'demo-class',
  };
}

function setStrictClassroomHelper(enabled: boolean): () => void {
  const previous = process.env.DGBOOK_STRICT_CLASSROOM_HELPER;
  if (enabled) process.env.DGBOOK_STRICT_CLASSROOM_HELPER = '1';
  else delete process.env.DGBOOK_STRICT_CLASSROOM_HELPER;
  return () => {
    if (previous === undefined) delete process.env.DGBOOK_STRICT_CLASSROOM_HELPER;
    else process.env.DGBOOK_STRICT_CLASSROOM_HELPER = previous;
  };
}

function studentActor(studentId: 'stu-01' | 'stu-02' | 'stu-03'): AuthenticatedActor {
  return {
    userId: studentId,
    username: studentId.replace('stu-', 'student'),
    displayName: studentId,
    role: 'student',
    classId: 'demo-class',
    studentId,
  };
}

function readyForFormalAssessment(database: ReturnType<typeof createTestDatabase>['database'], studentId: string): void {
  const insert = database.prepare(`
    INSERT INTO practice_attempts (
      attempt_id, student_id, activity_id, node_id, passed, origin, attempted_at
    ) VALUES (?, ?, ?, ?, 1, 'user', '2026-07-16T01:00:00.000Z')
  `);
  for (const [activityId, nodeId] of [
    ['P1T1-N01-micro-01', 'P1T1-N01'],
    ['P1T1-N02-foundation-01', 'P1T1-N02'],
    ['P1T1-N02-application-01', 'P1T1-N02'],
    ['P1T1-N02-transfer-01', 'P1T1-N02'],
  ] as const) insert.run(`ready-${studentId}-${activityId}`, studentId, activityId, nodeId);
  const insertSection = database.prepare(`
    INSERT INTO learning_events (
      event_id, student_id, node_id, channel, event_type, payload_json, origin
    ) VALUES (?, ?, ?, 'self-study', 'section_completed', ?, 'user')
  `);
  for (const nodeId of ['P1T1-N01', 'P1T1-N02']) {
    for (const sectionId of REQUIRED_SELF_STUDY_SECTIONS) {
      insertSection.run(
        `ready-${studentId}-${nodeId}-${sectionId}`,
        studentId,
        nodeId,
        JSON.stringify({ sectionId, completed: true }),
      );
    }
  }
}

function wrongAssessmentAnswers(): AssessmentAnswers {
  return {
    evidenceClassification: 'environment-note',
    linkReconstruction: ['peer-device', 'peer-port', 'cable-label', 'source-port', 'source-device'],
    defectiveOutputRevision: ['erase-gap'],
    professionalConclusion: {
      confirmedFact: '未说明',
      evidenceGap: '未说明',
      risk: '未说明',
      action: '未说明',
    },
  };
}

function passingAssessmentAnswers(): AssessmentAnswers {
  return {
    evidenceClassification: 'nameplate-photo',
    linkReconstruction: ['source-device', 'source-port', 'cable-label', 'peer-port', 'peer-device'],
    defectiveOutputRevision: ['restore-source', 'add-photo-index', 'record-direction'],
    professionalConclusion: {
      confirmedFact: '设备铭牌与源端口证据清晰，设备身份和源端连接已经确认。',
      evidenceGap: '对端端口照片仍需复核，当前不扩展未经证实的结论。',
      risk: '证据不足时直接交付可能造成链路关系误判。',
      action: '补拍对端端口并核验编号，完成证据索引后更新成果表。',
    },
  } as AssessmentAnswers;
}
