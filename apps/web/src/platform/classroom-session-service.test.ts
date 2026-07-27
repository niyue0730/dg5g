import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedActor } from './auth/actor.ts';
import { ClassroomSessionService } from './classroom-session-service.ts';
import { seedDemo } from './db/demo-seed.ts';
import { migrateDatabase } from './db/migrations.ts';
import { createTestDatabase } from './db/test-database.ts';
import { ClassroomSessionRepository } from './classroom-session-repository.ts';
import { ClassroomRosterRepository } from './classroom-roster-repository.ts';
import { getNodeLearningPolicy } from './learning-policy.ts';
import { FormalAssessmentService, type AssessmentAnswers } from './formal-assessment-service.ts';
import { REQUIRED_SELF_STUDY_SECTIONS } from './self-study-sections.ts';

const teacher: AuthenticatedActor = {
  userId: 'teacher-01',
  username: 'teacher01',
  displayName: '张老师',
  role: 'teacher',
  classId: 'demo-class',
};

const student: AuthenticatedActor = {
  userId: 'stu-01',
  username: 'student01',
  displayName: '学生一',
  role: 'student',
  classId: 'demo-class',
  studentId: 'stu-01',
};

test('authorizes exact SQLite membership and returns role-scoped projections of one session', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );

    const teacherSession = service.read(teacher, 'demo-class');
    const studentSession = service.read(student, 'demo-class');

    assert.ok(teacherSession);
    assert.ok(studentSession);
    assert.equal(teacherSession.sessionId, 'demo-class');
    assert.equal(teacherSession.sessionStatus, 'paused');
    assert.equal(teacherSession.activeNodeId, 'P1T1-N02');
    assert.equal(teacherSession.studentRoster.length, 3);
    assert.deepEqual(studentSession.studentRoster, []);
    assert.equal(studentSession.studentProgress?.studentId, 'stu-01');
    assert.throws(
      () => service.read({ ...student, userId: 'stu-missing', studentId: 'stu-missing' }, 'demo-class'),
      { name: 'ClassroomAuthorizationError' },
    );
    assert.equal(service.read(teacher, 'P1T1-N02'), undefined);
  } finally {
    fixture.cleanup();
  }
});

test('allows only the owning teacher to apply a revision-checked lesson intent', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );

    assert.throws(
      () => service.applyTeacherIntent(student, 'demo-class', { type: 'phase_changed', phase: 'lecture' }, 0),
      { name: 'ClassroomAuthorizationError' },
    );
    const result = service.applyTeacherIntent(
      teacher,
      'demo-class',
      { type: 'phase_changed', phase: 'lecture' },
      0,
      new Date('2026-07-16T02:00:00.000Z'),
    );

    assert.equal(result.session.lessonState?.phase, 'lecture');
    assert.equal(result.session.sessionStatus, 'active');
    assert.equal(result.session.lessonState?.revision, 1);
    assert.equal(result.command.revision, 1);
    assert.equal(result.session.syncRequestId, result.command.commandId);
  } finally {
    fixture.cleanup();
  }
});

test('starts a formal assessment with a server-owned shared run identity and server timestamp', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const repository = new ClassroomSessionRepository(fixture.database);
    const service = new ClassroomSessionService(
      repository,
      new ClassroomRosterRepository(fixture.database),
    );
    const now = new Date('2026-07-16T04:00:00.000Z');
    repository.recordHeartbeat('demo-class', {
      deviceId: 'student-live-01',
      actorRole: 'student',
      studentId: 'stu-01',
      pageState: 'ready',
      lastAppliedRevision: 0,
    }, now);
    service.applyTeacherIntent(
      teacher,
      'demo-class',
      { type: 'phase_changed', phase: 'lecture' },
      0,
      now,
    );
    const current = service.read(teacher, 'demo-class', 'actor', now);
    assert.ok(current?.formalTest);

    const started = service.patchTeacherState(teacher, 'demo-class', {
      formalTest: {
        ...current.formalTest,
        runId: 'forged-client-run',
        gameId: 'forged-client-game',
        status: 'running',
        startedAt: '1999-01-01T00:00:00.000Z',
      },
    }, 1, now);

    assert.match(started.formalTest?.runId ?? '', /^classroom-run-/);
    assert.notEqual(started.formalTest?.runId, 'forged-client-run');
    assert.equal(started.formalTest?.startedAt, now.toISOString());
    assert.equal(started.formalTest?.gameId, 'P1T1-N02-server-assessment');
    assert.equal(started.formalTest?.status, 'running');
    const stored = repository.readSession('demo-class');
    assert.equal(stored?.state.formalTest?.runId, started.formalTest?.runId);
  } finally {
    fixture.cleanup();
  }
});

test('managed demo classroom accepts ten consecutive synchronized page changes without an external heartbeat', () => {
  const restoreHelperMode = setStrictClassroomHelper(false);
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const repository = new ClassroomSessionRepository(fixture.database);
    const service = new ClassroomSessionService(
      repository,
      new ClassroomRosterRepository(fixture.database),
    );
    const now = new Date('2026-07-16T04:00:00.000Z');
    service.applyTeacherIntent(
      teacher,
      'demo-class',
      { type: 'phase_changed', phase: 'lecture' },
      0,
      now,
    );

    for (let operation = 1; operation <= 10; operation += 1) {
      const result = service.applyTeacherIntent(
        teacher,
        'demo-class',
        { type: 'page_changed', pageIndex: operation },
        operation,
        new Date(now.getTime() + operation * 1_000),
      );
      assert.equal(result.command.revision, operation + 1);
      assert.equal(result.session.teacherSlideIndex, operation + 1);
    }

    assert.equal(fixture.database.prepare(`
      SELECT revision FROM classroom_sessions WHERE session_id = 'demo-class'
    `).pluck().get(), 11);
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'demo-class'
    `).pluck().get(), 11);
  } finally {
    fixture.cleanup();
    restoreHelperMode();
  }
});

test('strict helper mode rejects synchronized mutations without a live student heartbeat', () => {
  const restoreHelperMode = setStrictClassroomHelper(true);
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );
    const now = new Date('2026-07-16T04:00:00.000Z');

    assert.throws(
      () => service.patchTeacherState(teacher, 'demo-class', {
        currentPageId: 'P1-STUDENT-FOLLOW-N01',
        teacherSlideId: 'P1T1-N02-S02',
        teacherSlideIndex: 2,
        studentSyncState: 'requested',
      }, 0, now),
      { name: 'ClassroomHelperUnavailableError' },
    );
    assert.throws(
      () => service.applyTeacherIntent(
        teacher,
        'demo-class',
        { type: 'playback_seeked', positionMs: 1_500 },
        0,
        now,
      ),
      { name: 'ClassroomHelperUnavailableError' },
    );
    assert.equal(fixture.database.prepare(`
      SELECT revision FROM classroom_sessions WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
  } finally {
    fixture.cleanup();
    restoreHelperMode();
  }
});

test('non-demo classrooms remain fail-closed without a live student heartbeat', () => {
  const restoreHelperMode = setStrictClassroomHelper(false);
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.prepare(`
      INSERT INTO classroom_sessions (
        session_id, class_id, name, teacher_id, status, active_node_id,
        active_unit_id, revision, state_json
      )
      SELECT 'practice-class', class_id, 'Practice class', teacher_id, status, active_node_id,
        active_unit_id, revision, state_json
      FROM classroom_sessions
      WHERE session_id = 'demo-class'
    `).run();
    fixture.database.prepare(`
      INSERT INTO classroom_members (session_id, student_id)
      SELECT 'practice-class', student_id
      FROM classroom_members
      WHERE session_id = 'demo-class'
    `).run();
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );

    assert.throws(
      () => service.patchTeacherState(teacher, 'practice-class', {
        teacherSlideId: 'P1T1-N02-S02',
        teacherSlideIndex: 2,
        studentSyncState: 'requested',
      }, 0, new Date('2026-07-16T04:00:00.000Z')),
      { name: 'ClassroomHelperUnavailableError' },
    );
    assert.equal(fixture.database.prepare(`
      SELECT revision FROM classroom_sessions WHERE session_id = 'practice-class'
    `).pluck().get(), 0);
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'practice-class'
    `).pluck().get(), 0);
  } finally {
    fixture.cleanup();
    restoreHelperMode();
  }
});

test('blocks review at zero real submissions and opens it after one valid submission in the active run', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, 'stu-01');
    const repository = new ClassroomSessionRepository(fixture.database);
    const service = new ClassroomSessionService(
      repository,
      new ClassroomRosterRepository(fixture.database),
    );
    const now = new Date('2026-07-16T04:00:00.000Z');
    repository.recordHeartbeat('demo-class', {
      deviceId: 'student-live-review',
      actorRole: 'student',
      studentId: 'stu-01',
      pageState: 'ready',
      lastAppliedRevision: 0,
    }, now);
    service.applyTeacherIntent(teacher, 'demo-class', { type: 'phase_changed', phase: 'lecture' }, 0, now);
    service.applyTeacherIntent(teacher, 'demo-class', { type: 'phase_changed', phase: 'practice' }, 1, now);
    service.applyTeacherIntent(teacher, 'demo-class', { type: 'phase_changed', phase: 'challenge' }, 2, now);
    const before = service.read(teacher, 'demo-class', 'actor', now);
    assert.ok(before?.formalTest);
    const running = service.patchTeacherState(teacher, 'demo-class', {
      formalTest: { ...before.formalTest, status: 'running' },
    }, 3, now);
    assert.ok(running.formalTest?.runId);

    assert.throws(
      () => service.applyTeacherIntent(
        teacher,
        'demo-class',
        { type: 'phase_changed', phase: 'review' },
        4,
        new Date('2026-07-16T04:01:00.000Z'),
      ),
      { name: 'ClassroomReviewUnavailableError' },
    );
    assert.equal(repository.readSession('demo-class')?.revision, 4);

    let sequence = 0;
    const assessment = new FormalAssessmentService(fixture.database, {
      now: () => new Date('2026-07-16T04:01:30.000Z'),
      randomId: () => `review-${++sequence}`,
      randomToken: () => `review-token-${++sequence}-0123456789abcdef`,
    });
    const issued = assessment.issuePaper(student, 'P1T1-N02', {
      classroomSessionId: 'demo-class',
    });
    assessment.submitAnswers(student, issued.attemptToken, wrongAssessmentAnswers());

    const review = service.applyTeacherIntent(
      teacher,
      'demo-class',
      { type: 'phase_changed', phase: 'review' },
      4,
      new Date('2026-07-16T04:02:00.000Z'),
    );
    assert.equal(review.session.lessonState?.phase, 'review');
    assert.equal(review.session.reviewState, 'reviewing');
    assert.equal(review.session.formalTest?.status, 'review');
  } finally {
    fixture.cleanup();
  }
});

test('applies projector page changes through one server revision and fails closed at the page boundary', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const repository = new ClassroomSessionRepository(fixture.database);
    const service = new ClassroomSessionService(
      repository,
      new ClassroomRosterRepository(fixture.database),
    );
    const now = new Date('2026-07-16T05:00:00.000Z');
    repository.recordHeartbeat('demo-class', {
      deviceId: 'student-projector-control',
      actorRole: 'student',
      studentId: 'stu-01',
      pageState: 'ready',
      lastAppliedRevision: 0,
    }, now);
    service.applyTeacherIntent(teacher, 'demo-class', { type: 'phase_changed', phase: 'lecture' }, 0, now);

    const lastPage = service.applyTeacherIntent(
      teacher,
      'demo-class',
      { type: 'page_changed', pageIndex: 11 },
      1,
      now,
    );
    assert.equal(lastPage.session.lessonState?.playback.actionIndex, 11);
    assert.equal(lastPage.session.teacherSlideIndex, 12);
    assert.equal(lastPage.session.teacherSlideId, 'P1T1-N02-S12');
    assert.equal(lastPage.command.revision, 2);

    assert.throws(
      () => service.applyTeacherIntent(
        teacher,
        'demo-class',
        { type: 'page_changed', pageIndex: 12 },
        2,
        now,
      ),
      { name: 'ClassroomIntentError' },
    );
    assert.equal(repository.readSession('demo-class')?.revision, 2);
    const continued = service.applyTeacherIntent(
      teacher,
      'demo-class',
      { type: 'page_changed', pageIndex: 10 },
      2,
      new Date('2026-07-16T05:00:10.000Z'),
    );
    assert.equal(continued.command.revision, 3);
    assert.equal(repository.readSession('demo-class')?.revision, 3);
  } finally {
    fixture.cleanup();
  }
});

test('fails closed without a revision or command when a classroom is closed', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.prepare(`
      UPDATE classroom_sessions SET status = 'closed' WHERE session_id = 'demo-class'
    `).run();
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );

    assert.throws(
      () => service.applyTeacherIntent(
        teacher,
        'demo-class',
        { type: 'phase_changed', phase: 'lecture' },
        0,
      ),
      { name: 'ClassroomIntentError' },
    );
    assert.equal(fixture.database.prepare(`
      SELECT revision FROM classroom_sessions WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
  } finally {
    fixture.cleanup();
  }
});

test('rejects an unpublished node or mismatched unit before teacher CAS', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );

    for (const patch of [
      { activeNodeId: 'P9T9-N99', activeUnitId: 'P99-ku-99' },
      { activeNodeId: 'P1T1-N03', activeUnitId: 'P01-ku-99' },
    ]) {
      assert.throws(
        () => service.patchTeacherState(teacher, 'demo-class', patch, 0),
        { name: 'ClassroomIntentError' },
      );
    }
    assert.equal(fixture.database.prepare(`
      SELECT revision FROM classroom_sessions WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
  } finally {
    fixture.cleanup();
  }
});

test('startLesson atomically reopens the classroom at a fresh published teaching position', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const repository = new ClassroomSessionRepository(fixture.database);
    const service = new ClassroomSessionService(
      repository,
      new ClassroomRosterRepository(fixture.database),
    );
    service.applyTeacherIntent(
      teacher,
      'demo-class',
      { type: 'phase_changed', phase: 'lecture' },
      0,
      new Date('2026-07-16T03:00:00.000Z'),
    );
    const beforeDirty = service.read(teacher, 'demo-class');
    assert.ok(beforeDirty?.formalTest);
    repository.recordHeartbeat('demo-class', {
      deviceId: 'student-start-lesson-reset',
      actorRole: 'student',
      studentId: 'stu-01',
      pageState: 'ready',
      lastAppliedRevision: 1,
    }, new Date('2026-07-16T03:01:00.000Z'));
    const dirty = service.patchTeacherState(teacher, 'demo-class', {
      activityState: 'reviewing',
      reviewState: 'completed',
      studentSyncState: 'forced',
      playbackCursor: {
        sceneId: 'stale-scene',
        actionId: 'stale-action',
        actionIndex: 4,
      },
      formalTest: {
        ...beforeDirty.formalTest,
        status: 'running',
        startedAt: '2026-07-16T03:01:00.000Z',
      },
    }, 1, new Date('2026-07-16T03:01:00.000Z'));
    fixture.database.prepare(`
      UPDATE classroom_sessions SET status = 'closed' WHERE session_id = 'demo-class'
    `).run();
    const rosterModes = dirty.studentRoster.map(({ studentId, mode }) => ({ studentId, mode }));
    const eventCount = Number(fixture.database.prepare('SELECT COUNT(*) FROM learning_events').pluck().get());
    const outputCount = Number(fixture.database.prepare('SELECT COUNT(*) FROM professional_outputs').pluck().get());

    const result = service.startLesson(
      teacher,
      'demo-class',
      { nodeId: 'P1T1-N02', expectedRevision: 2 },
      new Date('2026-07-16T03:02:00.000Z'),
    );

    assert.equal(result.session.sessionStatus, 'active');
    assert.equal(result.session.activeNodeId, 'P1T1-N02');
    assert.equal(result.session.activeUnitId, 'P01-ku-02');
    assert.equal(result.session.lessonState?.phase, 'prepare');
    assert.equal(result.session.lessonState?.revision, 3);
    assert.equal(result.session.lessonState?.playback.status, 'idle');
    assert.equal(result.session.lessonState?.playback.actionId, 'P1T1-N02-lesson-case');
    assert.equal(result.session.lessonState?.playback.actionIndex, 0);
    assert.equal(result.session.currentPageId, 'P1-TEACH-CONSOLE-N01');
    assert.equal(result.session.currentSlideId, 'P1T1-N02-S01');
    assert.equal(result.session.teacherSlideId, 'P1T1-N02-S01');
    assert.equal(result.session.teacherSlideIndex, 1);
    assert.equal(result.session.sceneMode, 'learning');
    assert.equal(result.session.studentSyncState, 'idle');
    assert.equal(result.session.activityState, 'not_pushed');
    assert.equal(result.session.reviewState, 'not_started');
    assert.equal(result.session.formalTest?.nodeId, 'P1T1-N02');
    assert.equal(result.session.formalTest?.status, 'idle');
    assert.equal(result.session.formalTest?.startedAt, undefined);
    assert.equal(result.command.revision, 3);
    assert.equal(result.command.nodeId, 'P1T1-N02');
    assert.equal(result.command.unitId, 'P01-ku-02');
    assert.equal(result.command.route, '/classroom/demo-class');
    assert.deepEqual(
      result.session.studentRoster.map(({ studentId, mode }) => ({ studentId, mode })),
      rosterModes,
    );
    assert.equal(Number(fixture.database.prepare('SELECT COUNT(*) FROM learning_events').pluck().get()), eventCount);
    assert.equal(Number(fixture.database.prepare('SELECT COUNT(*) FROM professional_outputs').pluck().get()), outputCount);
    assert.deepEqual(fixture.database.prepare(`
      SELECT status, active_node_id AS activeNodeId, active_unit_id AS activeUnitId, revision
      FROM classroom_sessions WHERE session_id = 'demo-class'
    `).get(), {
      status: 'active',
      activeNodeId: 'P1T1-N02',
      activeUnitId: 'P01-ku-02',
      revision: 3,
    });
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'demo-class' AND revision = 3
    `).pluck().get(), 1);
  } finally {
    fixture.cleanup();
  }
});

test('startLesson uses each published N04 source knowledge unit instead of deriving ku-04', () => {
  const cases = [
    ['P1T1-N04', 'P01-ku-06'],
    ['P1T2-N04', 'P02-ku-06'],
    ['P1T3-N04', 'P03-ku-06'],
  ] as const;

  for (const [nodeId, unitId] of cases) {
    const fixture = createTestDatabase();
    try {
      migrateDatabase(fixture.database);
      seedDemo(fixture.database);
      const service = new ClassroomSessionService(
        new ClassroomSessionRepository(fixture.database),
        new ClassroomRosterRepository(fixture.database),
      );

      const result = service.startLesson(
        teacher,
        'demo-class',
        { nodeId, expectedRevision: 0 },
      );

      assert.equal(result.session.activeUnitId, unitId);
      assert.equal(result.session.lessonState?.activeUnitId, unitId);
      assert.equal(result.command.unitId, unitId);
    } finally {
      fixture.cleanup();
    }
  }
});

test('startLesson rejects unknown and unpublished nodes without mutating SQLite', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const repository = new ClassroomSessionRepository(fixture.database);
    const roster = new ClassroomRosterRepository(fixture.database);
    const published = getNodeLearningPolicy('P1T1-N02');
    assert.ok(published);
    const unknownService = new ClassroomSessionService(repository, roster);
    const unpublishedService = new ClassroomSessionService(
      repository,
      roster,
      (nodeId) => nodeId === published.nodeId
        ? { ...published, publicationStatus: 'not-open' }
        : getNodeLearningPolicy(nodeId),
    );

    assert.throws(
      () => unknownService.startLesson(
        teacher,
        'demo-class',
        { nodeId: 'P9T9-N99', expectedRevision: 0 },
      ),
      { name: 'ClassroomIntentError' },
    );
    assert.throws(
      () => unpublishedService.startLesson(
        teacher,
        'demo-class',
        { nodeId: 'P1T1-N02', expectedRevision: 0 },
      ),
      { name: 'ClassroomIntentError' },
    );
    assert.equal(fixture.database.prepare(`
      SELECT revision FROM classroom_sessions WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'demo-class'
    `).pluck().get(), 0);
  } finally {
    fixture.cleanup();
  }
});

test('startLesson rejects a student and a stale teacher revision without overwriting the live lesson', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );

    assert.throws(
      () => service.startLesson(
        student,
        'demo-class',
        { nodeId: 'P1T1-N02', expectedRevision: 0 },
      ),
      { name: 'ClassroomAuthorizationError' },
    );
    const first = service.startLesson(
      teacher,
      'demo-class',
      { nodeId: 'P1T1-N03', expectedRevision: 0 },
    );
    assert.equal(first.session.lessonState?.revision, 1);
    assert.throws(
      () => service.startLesson(
        teacher,
        'demo-class',
        { nodeId: 'P1T1-N02', expectedRevision: 0 },
      ),
      (error: unknown) => (
        error instanceof Error
        && error.name === 'ClassroomRevisionConflictError'
        && 'currentRevision' in error
        && error.currentRevision === 1
      ),
    );
    assert.deepEqual(fixture.database.prepare(`
      SELECT active_node_id AS activeNodeId, active_unit_id AS activeUnitId, revision
      FROM classroom_sessions WHERE session_id = 'demo-class'
    `).get(), {
      activeNodeId: 'P1T1-N03',
      activeUnitId: 'P01-ku-03',
      revision: 1,
    });
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM classroom_commands WHERE session_id = 'demo-class'
    `).pluck().get(), 1);
  } finally {
    fixture.cleanup();
  }
});

test('startLesson returns the new-node roster projection while preserving each participation mode', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const service = new ClassroomSessionService(
      new ClassroomSessionRepository(fixture.database),
      new ClassroomRosterRepository(fixture.database),
    );
    const before = service.read(teacher, 'demo-class');
    assert.ok(before);
    const modes = before.studentRoster.map(({ studentId, mode }) => ({ studentId, mode }));

    const result = service.startLesson(
      teacher,
      'demo-class',
      { nodeId: 'P1T1-N03', expectedRevision: 0 },
    );
    const fresh = service.read(teacher, 'demo-class');

    assert.ok(fresh);
    assert.deepEqual(result.session.studentRoster, fresh.studentRoster);
    assert.deepEqual(
      result.session.studentRoster.map(({ studentId, mode }) => ({ studentId, mode })),
      modes,
    );
    assert.equal(result.session.studentRoster.every(({ activeNodeId }) => activeNodeId === 'P1T1-N03'), true);
  } finally {
    fixture.cleanup();
  }
});

function readyForFormalAssessment(database: ReturnType<typeof createTestDatabase>['database'], studentId: string): void {
  const insert = database.prepare(`
    INSERT INTO practice_attempts (
      attempt_id, student_id, activity_id, node_id, passed, origin, attempted_at
    ) VALUES (?, ?, ?, ?, 1, 'user', '2026-07-16T03:30:00.000Z')
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

function setStrictClassroomHelper(enabled: boolean): () => void {
  const previous = process.env.DGBOOK_STRICT_CLASSROOM_HELPER;
  if (enabled) process.env.DGBOOK_STRICT_CLASSROOM_HELPER = '1';
  else delete process.env.DGBOOK_STRICT_CLASSROOM_HELPER;
  return () => {
    if (previous === undefined) delete process.env.DGBOOK_STRICT_CLASSROOM_HELPER;
    else process.env.DGBOOK_STRICT_CLASSROOM_HELPER = previous;
  };
}

function wrongAssessmentAnswers(): AssessmentAnswers {
  return {
    evidenceClassification: 'environment-note',
    linkReconstruction: ['peer-device', 'peer-port', 'cable-label', 'source-port', 'source-device'],
    defectiveOutputRevision: ['erase-gap'],
    professionalConclusion: {
      confirmedFact: '未说明', evidenceGap: '未说明', risk: '未说明', action: '未说明',
    },
  };
}
