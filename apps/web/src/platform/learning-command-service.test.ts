import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedActor } from './auth/actor.ts';
import { createTestDatabase } from './db/test-database.ts';
import { migrateDatabase } from './db/migrations.ts';
import { seedDemo } from './db/demo-seed.ts';
import type { AppDatabase } from './db/database.ts';
import { LearningRepository } from './learning-repository.ts';
import { LearningCommandService } from './learning-command-service.ts';
import { NodeRouteAccessError } from './access-control.ts';
import { p01OutputFieldKeys } from '../features/portfolio/p01-output-definition.ts';
import {
  evidenceLibraryForTask,
  p01EvidenceLibrary,
} from '../features/portfolio/evidence-library.ts';
import {
  ProfessionalOutputNotFoundError,
  ProfessionalOutputRepository,
} from './professional-output-repository.ts';
import { REQUIRED_SELF_STUDY_SECTIONS } from './self-study-sections.ts';

const studentOne: AuthenticatedActor = {
  userId: 'stu-01',
  studentId: 'stu-01',
  username: 'student01',
  displayName: '学生一',
  role: 'student',
  classId: 'demo-class',
};

const studentTwo: AuthenticatedActor = {
  ...studentOne,
  userId: 'stu-02',
  studentId: 'stu-02',
  username: 'student02',
  displayName: '学生二',
};

const studentThree: AuthenticatedActor = {
  ...studentOne,
  userId: 'stu-03',
  studentId: 'stu-03',
  username: 'student03',
  displayName: '学生三',
};

test('an authenticated student appends a learning event only to their own SQLite snapshot', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const before = repository.readTopicVersion('learning:stu-01');

    const snapshot = service.appendEvent(studentOne, {
      eventId: 'command-service-section-1',
      nodeId: 'P1T1-N02',
      channel: 'self-study',
      eventType: 'section_completed',
      payload: { sectionId: 'figure', completed: true },
      expectedVersion: before,
    });

    assert.equal(snapshot.studentId, 'stu-01');
    assert.equal(snapshot.version, before + 1);
    assert.ok(snapshot.nodes.find((node) => node.nodeId === 'P1T1-N02')?.completedSections.includes('figure'));
    assert.equal(repository.readStudentFacts('stu-02').events.some((event) => event.eventId === 'command-service-section-1'), false);
  } finally {
    fixture.cleanup();
  }
});

test('formal attempts are accepted only on the policy-defined N02 node test', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const before = repository.readTopicVersion('learning:stu-01');

    assert.throws(() => service.recordFormalAttempt(studentOne, {
      attemptId: 'forbidden-n01-formal-attempt',
      nodeId: 'P1T1-N01',
      gameId: 'node-test',
      score: 90,
      expectedVersion: before,
    }), /formal attempt.*N02/i);
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
    assert.equal(repository.readStudentFacts('stu-01').attempts.some((attempt) => attempt.attemptId === 'forbidden-n01-formal-attempt'), false);
  } finally {
    fixture.cleanup();
  }
});

test('formal attempt storage has no permanent three-attempt lock while exact replay stays idempotent', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    let version = repository.readTopicVersion('learning:stu-01');
    service.recordFormalAttempt(studentOne, {
      attemptId: 'command-service-attempt-1',
      nodeId: 'P1T1-N02',
      gameId: 'node-test',
      score: 80,
      expectedVersion: version,
    });
    version += 1;
    const second = {
      attemptId: 'command-service-attempt-2',
      nodeId: 'P1T1-N02',
      gameId: 'node-test',
      score: 82,
      expectedVersion: version,
    } as const;
    service.recordFormalAttempt(studentOne, second);
    version += 1;
    service.recordFormalAttempt(studentOne, {
      attemptId: 'command-service-attempt-3',
      nodeId: 'P1T1-N02',
      gameId: 'node-test',
      score: 91,
      expectedVersion: version,
    });
    version += 1;

    const fourth = service.recordFormalAttempt(studentOne, {
      attemptId: 'command-service-attempt-4',
      nodeId: 'P1T1-N02',
      gameId: 'node-test',
      score: 95,
      expectedVersion: version,
    });
    version += 1;
    assert.equal(fourth.version, version);

    const replay = service.recordFormalAttempt(studentOne, second);
    assert.equal(replay.version, version);
    assert.equal(replay.nodes.find((node) => node.nodeId === 'P1T1-N02')?.attempts.length, 4);
  } finally {
    fixture.cleanup();
  }
});

test('student event commands reject teacher facts and output facts on a non-output node', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const before = repository.readTopicVersion('learning:stu-01');
    for (const command of [
      { eventId: 'forged-teacher-review', eventType: 'teacher_verified', payload: {} },
      { eventId: 'forged-n02-output', eventType: 'evidence_submitted', payload: { evidenceText: 'forged' } },
    ]) {
      assert.throws(() => service.appendEvent(studentOne, {
        ...command,
        nodeId: 'P1T1-N02',
        channel: 'self-study',
        expectedVersion: before,
      }), /unsupported learning event|professional output/i);
    }
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
  } finally {
    fixture.cleanup();
  }
});

test('learning events reject evidence submission until the authoritative output command exists', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const before = repository.readTopicVersion('learning:stu-02');

    assert.throws(() => service.appendEvent(studentTwo, {
      eventId: 'non-authoritative-output-event',
      nodeId: 'P1T1-N04',
      channel: 'self-study',
      eventType: 'evidence_submitted',
      payload: { evidenceText: 'must not become a second output source' },
      expectedVersion: before,
    }), /authoritative output API/i);
    assert.equal(repository.readTopicVersion('learning:stu-02'), before);
    assert.equal(repository.readStudentFacts('stu-02').events.some((event) => event.eventId === 'non-authoritative-output-event'), false);
  } finally {
    fixture.cleanup();
  }
});

test('locked, not-open, and unknown nodes fail closed without advancing either snapshot version', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const learningBefore = repository.readTopicVersion('learning:stu-01');
    const globalBefore = repository.readTopicVersion('global');
    const cases = [
      ['P1T1-N04', 'locked'],
      ['P4T2-N04', 'not-open'],
      ['does-not-exist', 'not-found'],
    ] as const;

    for (const [nodeId, kind] of cases) {
      assert.throws(() => service.appendEvent(studentOne, {
        eventId: `closed-${kind}`,
        nodeId,
        channel: 'self-study',
        eventType: 'micro_practice_passed',
        expectedVersion: learningBefore,
      }), (error) => error instanceof NodeRouteAccessError && error.classification.kind === kind);
    }
    assert.equal(repository.readTopicVersion('learning:stu-01'), learningBefore);
    assert.equal(repository.readTopicVersion('global'), globalBefore);
  } finally {
    fixture.cleanup();
  }
});

test('student event matrix rejects direct pass facts and malformed section, game, or classroom events', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const before = repository.readTopicVersion('learning:stu-01');
    const invalidCommands = [
      { eventId: 'direct-pass', nodeId: 'P1T1-N02', channel: 'self-study', eventType: 'micro_practice_passed', payload: {} },
      { eventId: 'bad-section-channel', nodeId: 'P1T1-N02', channel: 'classroom', eventType: 'section_completed', payload: { sectionId: 'problem', completed: true } },
      { eventId: 'bad-section-id', nodeId: 'P1T1-N02', channel: 'self-study', eventType: 'section_completed', payload: { sectionId: 'invented', completed: true } },
      { eventId: 'incomplete-section', nodeId: 'P1T1-N02', channel: 'self-study', eventType: 'section_completed', payload: { sectionId: 'problem', completed: false } },
      { eventId: 'formal-game-event', nodeId: 'P1T1-N02', channel: 'game', eventType: 'game_completed', payload: { formal: true, completed: true } },
      { eventId: 'incomplete-game-event', nodeId: 'P1T1-N02', channel: 'game', eventType: 'game_completed', payload: { formal: false, completed: false } },
      { eventId: 'wrong-classroom-node', nodeId: 'P1T1-N01', channel: 'classroom', eventType: 'classroom_submitted', payload: { completed: true } },
    ] as const;

    for (const command of invalidCommands) {
      assert.throws(() => service.appendEvent(studentOne, { ...command, expectedVersion: before }), /event|section|game|classroom|pass/i);
    }
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
    assert.equal(repository.readStudentFacts('stu-01').events.some(({ eventId }) => invalidCommands.some((command) => command.eventId === eventId)), false);
  } finally {
    fixture.cleanup();
  }
});

test('formal N02 attempts require micro-practice-passed in the current state trail', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const before = repository.readTopicVersion('learning:stu-01');

    assert.throws(() => service.recordFormalAttempt(studentOne, {
      attemptId: 'attempt-before-micro-practice',
      nodeId: 'P1T1-N02',
      gameId: 'node-test',
      score: 90,
      expectedVersion: before,
    }), /micro-practice/i);
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
    assert.equal(repository.readStudentFacts('stu-01').attempts.some(({ attemptId }) => attemptId === 'attempt-before-micro-practice'), false);
  } finally {
    fixture.cleanup();
  }
});

test('the current published classroom node permits a member submission without overwriting personal locked state', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    fixture.database.prepare(`
      UPDATE classroom_sessions
      SET status = 'active', active_node_id = 'P1T1-N04', updated_at = CURRENT_TIMESTAMP
      WHERE session_id = 'demo-class'
    `).run();
    const repository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(repository);
    const before = repository.readTopicVersion('learning:stu-01');
    const beforeNode = service.readStudentSnapshot(studentOne).nodes.find(({ nodeId }) => nodeId === 'P1T1-N04');
    assert.equal(beforeNode?.state, 'locked');

    const snapshot = service.appendEvent(studentOne, {
      eventId: 'locked-classroom-activity',
      nodeId: 'P1T1-N04',
      channel: 'classroom',
      eventType: 'classroom_submitted',
      payload: { completed: true },
      expectedVersion: before,
    });

    assert.equal(snapshot.version, before + 1);
    assert.equal(snapshot.nodes.find(({ nodeId }) => nodeId === 'P1T1-N04')?.state, 'locked');
  } finally {
    fixture.cleanup();
  }
});

test('professional output commands reuse node access and derive ownership from the student actor', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    fixture.database.prepare(`
      DELETE FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).run();
    const learningRepository = new LearningRepository(fixture.database);
    const outputRepository = new ProfessionalOutputRepository(
      fixture.database,
      () => 'command-output-stu-02-p01',
    );
    const service = new LearningCommandService(learningRepository, undefined, outputRepository);
    const fields = completeP01Fields('student two evidence');

    const draft = service.saveProfessionalOutputDraft(studentTwo, 'P01', {
      expectedStateRevision: 0,
      fields,
      upstreamRefs: [],
    });
    assert.equal(draft.head.studentId, 'stu-02');
    assert.equal(draft.head.status, 'draft');
    const submitted = service.submitProfessionalOutput(studentTwo, 'P01', {
      outputId: draft.head.outputId,
      expectedStateRevision: 1,
      fields,
      upstreamRefs: [],
    });
    assert.equal(submitted.head.status, 'submitted');
    const envelope = service.readProfessionalOutput(studentTwo, 'P01', draft.head.outputId);
    assert.equal(envelope.output?.head.outputId, draft.head.outputId);
    assert.equal(envelope.prefill.siteRoom?.sources.some(
      ({ sourceAttemptId }) => sourceAttemptId === 'demo-stu2-n01',
    ), true);
    assert.equal(envelope.evidenceLibrary.length, p01EvidenceLibrary.length);
    for (const taskId of ['P02', 'P03'] as const) {
      const taskEnvelope = service.readProfessionalOutput(studentThree, taskId);
      assert.deepEqual(taskEnvelope.prefill, {});
      assert.deepEqual(
        taskEnvelope.evidenceLibrary.map(({ evidenceId }) => evidenceId),
        evidenceLibraryForTask(taskId).map(({ evidenceId }) => evidenceId),
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test('professional output access fails closed for locked, not-open, unknown, and non-owned output IDs', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    unlockN02(fixture.database);
    const learningRepository = new LearningRepository(fixture.database);
    const service = new LearningCommandService(
      learningRepository,
      undefined,
      new ProfessionalOutputRepository(fixture.database),
    );
    const command = {
      expectedStateRevision: 0,
      fields: completeP01Fields('must not persist'),
      upstreamRefs: [],
    };
    for (const [taskId, kind] of [
      ['P01', 'locked'],
      ['P04', 'not-open'],
      ['does-not-exist', 'not-found'],
    ] as const) {
      assert.throws(
        () => service.saveProfessionalOutputDraft(studentOne, taskId, command),
        (error: unknown) => error instanceof NodeRouteAccessError && error.classification.kind === kind,
      );
    }
    assert.throws(
      () => service.readProfessionalOutput(
        studentThree,
        'P01',
        'demo-output-stu-02-p1t1-n04',
      ),
      ProfessionalOutputNotFoundError,
    );
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM professional_outputs WHERE student_id = 'stu-01'
    `).pluck().get(), 0);
  } finally {
    fixture.cleanup();
  }
});

function completeP01Fields(value: string): Record<string, string> {
  return Object.fromEntries(p01OutputFieldKeys.map((fieldKey) => [fieldKey, `${value}: ${fieldKey}`]));
}

function unlockN02(database: AppDatabase): void {
  passRequiredActivities(database, [
    ['P1T1-N01-micro-01', 'P1T1-N01'],
  ]);
}

function readyN02(database: AppDatabase): void {
  passRequiredActivities(database, [
    ['P1T1-N01-micro-01', 'P1T1-N01'],
    ['P1T1-N02-foundation-01', 'P1T1-N02'],
    ['P1T1-N02-application-01', 'P1T1-N02'],
    ['P1T1-N02-transfer-01', 'P1T1-N02'],
  ]);
}

function passRequiredActivities(
  database: AppDatabase,
  activities: readonly (readonly [activityId: string, nodeId: string])[],
): void {
  const insert = database.prepare(`
    INSERT INTO practice_attempts (
      attempt_id, student_id, activity_id, node_id, passed, origin
    ) VALUES (?, 'stu-01', ?, ?, 1, 'user')
  `);
  for (const [activityId, nodeId] of activities) {
    insert.run(`test-ready-stu-01-${activityId}`, activityId, nodeId);
  }
  for (const nodeId of new Set(activities.map(([, nodeId]) => nodeId))) {
    insertCompletedSections(database, 'stu-01', nodeId);
  }
}

function insertCompletedSections(database: AppDatabase, studentId: string, nodeId: string): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO learning_events (
      event_id, student_id, node_id, channel, event_type, payload_json, origin
    ) VALUES (?, ?, ?, 'self-study', 'section_completed', ?, 'user')
  `);
  for (const sectionId of REQUIRED_SELF_STUDY_SECTIONS) {
    insert.run(
      `test-ready-${studentId}-${nodeId}-${sectionId}`,
      studentId,
      nodeId,
      JSON.stringify({ sectionId, completed: true }),
    );
  }
}
