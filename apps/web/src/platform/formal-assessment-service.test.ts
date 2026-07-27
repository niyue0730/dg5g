import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthenticatedActor } from './auth/actor.ts';
import { createTestDatabase } from './db/test-database.ts';
import { migrateDatabase } from './db/migrations.ts';
import { seedDemo } from './db/demo-seed.ts';
import { closeDatabase, type AppDatabase } from './db/database.ts';
import { AuthService } from './auth/auth-service.ts';
import { AUTH_COOKIE_NAME } from './auth/cookie.ts';
import { ActivityRepository } from '../features/learning-activities/activity-repository.ts';
import {
  p01Activities,
  readActivityDefinition,
} from '../features/learning-activities/activity-catalog.ts';
import { LearningRepository } from './learning-repository.ts';
import {
  createLearningCommandService,
  LearningCommandValidationError,
} from './learning-command-service.ts';
import {
  AssessmentClassroomWindowError,
  AssessmentRemediationRequiredError,
  AssessmentTokenError,
  FormalAssessmentService,
  type AssessmentAnswers,
} from './formal-assessment-service.ts';
import { getFormalAssessmentDefinition } from './formal-assessment-catalog.server.ts';
import { ClassroomSessionRepository } from './classroom-session-repository.ts';
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

const wrongAnswers: AssessmentAnswers = {
  evidenceClassification: 'environment-note',
  linkReconstruction: ['peer-device', 'peer-port', 'cable-label', 'source-port', 'source-device'],
  defectiveOutputRevision: ['erase-gap'],
  professionalConclusion: {
    confirmedFact: '未说明。',
    evidenceGap: '未说明。',
    risk: '未说明。',
    action: '未说明。',
  },
} as unknown as AssessmentAnswers;

const passingAnswers = {
  evidenceClassification: 'nameplate-photo',
  linkReconstruction: ['source-device', 'source-port', 'cable-label', 'peer-port', 'peer-device'],
  defectiveOutputRevision: ['restore-source', 'add-photo-index', 'record-direction'],
  professionalConclusion: {
    confirmedFact: '设备铭牌可识别，源端口照片清晰，已经确认源设备身份和源端口。',
    evidenceGap: '对端端口照片模糊，当前无法确认对端端口编号。',
    risk: '若直接交付，链路关系可能错误并造成后续配置风险。',
    action: '重新拍摄对端端口并核验编号，补齐照片索引后更新成果表。',
  },
} as unknown as AssessmentAnswers;

test('each assessment dimension maps to a semantically matching real activity contract', () => {
  const definition = getFormalAssessmentDefinition('P1T1-N02');
  assert.ok(definition);
  const expectedContracts = {
    evidenceClassification: {
      activityId: 'P1T1-N02-foundation-01',
      kind: 'evidence-classification',
      materialIds: ['room-overview', 'device-nameplate', 'two-ended-port-trace'],
    },
    linkReconstruction: {
      activityId: 'P1T1-N02-application-01',
      kind: 'link-reconstruction',
      materialIds: ['bbu-port', 'odf-in', 'odf-out', 'aau-port'],
    },
    defectiveOutputRevision: {
      activityId: 'P1T1-N02-remediation-revision-01',
      kind: 'defective-sheet-revision',
      fieldIds: ['sourceEvidenceRevision', 'photoIndexRevision', 'directionRevision'],
    },
    professionalConclusion: {
      activityId: 'P1T1-N02-remediation-conclusion-01',
      kind: 'structured-record',
      fieldIds: ['confirmedFact', 'evidenceGap', 'risk', 'action'],
    },
  } as const;

  const targetIds = Object.entries(expectedContracts).map(([dimension, expected]) => {
    const target = definition.grading[dimension as keyof typeof expectedContracts].remediationTarget;
    assert.equal(target.activityId, expected.activityId);
    const activity = readActivityDefinition(target.activityId)?.activity;
    assert.ok(activity, `missing remediation activity ${target.activityId}`);
    assert.equal(activity.nodeId, target.nodeId);
    assert.equal(activity.kind, expected.kind);
    if ('materialIds' in expected) {
      assert.deepEqual(activity.materials.map(({ id }) => id), [...expected.materialIds]);
    }
    if ('fieldIds' in expected) {
      const fields = activity.interaction.type === 'record-form'
        || activity.interaction.type === 'revision-form'
        ? activity.interaction.fields
        : undefined;
      assert.ok(fields);
      assert.deepEqual(fields.map(({ id }) => id), [...expected.fieldIds]);
    }
    return target.activityId;
  });
  assert.equal(new Set(targetIds).size, targetIds.length);
});

test('every selectable professional conclusion includes one fully gradable evidence-bound answer', () => {
  for (const nodeId of ['P1T1-N02', 'P1T2-N02', 'P1T3-N02']) {
    const definition = getFormalAssessmentDefinition(nodeId);
    assert.ok(definition);
    const question = definition.paper.questions.find(({ id }) => id === 'professionalConclusion');
    const criteria = definition.grading.professionalConclusion.conclusionCriteria;
    assert.ok(question?.conclusionOptions);
    assert.ok(criteria);
    for (const field of ['confirmedFact', 'evidenceGap', 'risk', 'action'] as const) {
      const choices = question.conclusionOptions[field];
      assert.ok(choices.length >= 2, `${nodeId}/${field} must provide a real decision`);
      assert.ok(choices.some(({ label }) => (
        Array.from(label.replace(/\s/g, '')).length >= criteria.minimumCharacters
        && criteria[field].every((variants) => variants.some((term) => label.includes(term)))
      )), `${nodeId}/${field} has no answer that can pass server grading`);
    }
  }
});

test('issues an answer-free paper and grades and persists only on the server', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());

    const issued = service.issuePaper(studentOne, 'P1T1-N02');
    const serializedPaper = JSON.stringify(issued.paper);
    assert.equal(serializedPaper.includes('correct'), false);
    assert.equal(serializedPaper.includes('targetId'), false);
    assert.equal(serializedPaper.includes('modelAnswer'), false);

    const result = service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers);
    assert.notEqual(result.totalScore, 100);
    assert.equal(result.passed, false);
    assert.deepEqual(Object.keys(result.dimensions), [
      'evidenceClassification',
      'linkReconstruction',
      'defectiveOutputRevision',
      'professionalConclusion',
    ]);
    assert.equal(JSON.stringify(result.paper).includes('correct'), false);

    const stored = fixture.database.prepare(`
      SELECT assessment_id AS assessmentId, question_version AS questionVersion,
        answers_json AS answersJson, diagnostics_json AS diagnosticsJson, origin
      FROM formal_attempts WHERE attempt_id = ?
    `).get(result.attemptId) as {
      assessmentId: string;
      questionVersion: string;
      answersJson: string;
      diagnosticsJson: string;
      origin: string;
    };
    assert.equal(stored.assessmentId, result.assessmentId);
    assert.equal(stored.questionVersion, issued.paper.questionVersion);
    assert.deepEqual(JSON.parse(stored.answersJson), wrongAnswers);
    assert.equal(JSON.parse(stored.diagnosticsJson).totalScore, result.totalScore);
    assert.equal(stored.origin, 'user');
  } finally {
    fixture.cleanup();
  }
});

test('binds a classroom-issued paper to the exact active shared run without replacing its unique assessment identity', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const classroom = new ClassroomSessionRepository(fixture.database).readSession('demo-class');
    assert.ok(classroom);
    classroom.state.formalTest = {
      assessmentId: 'AS-P1T1-N02',
      gameId: 'P1T1-N02-server-assessment',
      nodeId: 'P1T1-N02',
      durationSeconds: 900,
      runId: 'classroom-run-live-01',
      status: 'running',
      startedAt: '2026-07-16T01:00:00.000Z',
    };
    fixture.database.prepare(`
      UPDATE classroom_sessions
      SET status = 'active', state_json = ?
      WHERE session_id = 'demo-class'
    `).run(JSON.stringify(classroom.state));
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());

    const issued = service.issuePaper(studentOne, 'P1T1-N02', {
      classroomSessionId: 'demo-class',
    });
    const stored = fixture.database.prepare(`
      SELECT assessment_id AS assessmentId, session_id AS sessionId,
        classroom_run_id AS classroomRunId
      FROM formal_assessment_instances
      WHERE assessment_id = ?
    `).get(issued.assessmentId);

    assert.deepEqual(stored, {
      assessmentId: issued.assessmentId,
      sessionId: 'demo-class',
      classroomRunId: 'classroom-run-live-01',
    });
    assert.notEqual(issued.assessmentId, 'classroom-run-live-01');
  } finally {
    fixture.cleanup();
  }
});

test('rejects a classroom-bound submission after its shared run has left the active window', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const classroom = new ClassroomSessionRepository(fixture.database).readSession('demo-class');
    assert.ok(classroom);
    classroom.state.formalTest = {
      assessmentId: 'AS-P1T1-N02',
      gameId: 'P1T1-N02-server-assessment',
      nodeId: 'P1T1-N02',
      durationSeconds: 900,
      runId: 'classroom-run-closed-before-submit',
      status: 'running',
      startedAt: '2026-07-16T09:55:00.000Z',
    };
    fixture.database.prepare(`
      UPDATE classroom_sessions SET status = 'active', state_json = ?
      WHERE session_id = 'demo-class'
    `).run(JSON.stringify(classroom.state));
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());
    const issued = service.issuePaper(studentOne, 'P1T1-N02', {
      classroomSessionId: 'demo-class',
    });

    classroom.state.formalTest.status = 'review';
    fixture.database.prepare(`
      UPDATE classroom_sessions SET state_json = ? WHERE session_id = 'demo-class'
    `).run(JSON.stringify(classroom.state));

    assert.throws(
      () => service.submitAnswers(studentOne, issued.attemptToken, passingAnswers),
      AssessmentClassroomWindowError,
    );
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM formal_attempts WHERE assessment_id = ?
    `).pluck().get(issued.assessmentId), 0);
  } finally {
    fixture.cleanup();
  }
});

test('binds a single-use token to one student, node, version, and assessment instance', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());
    const issued = service.issuePaper(studentOne, 'P1T1-N02');

    assert.throws(
      () => service.submitAnswers(studentTwo, issued.attemptToken, wrongAnswers),
      (error) => error instanceof AssessmentTokenError && error.code === 'invalid-token',
    );
    service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers);
    assert.throws(
      () => service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers),
      (error) => error instanceof AssessmentTokenError && error.code === 'used-token',
    );
  } finally {
    fixture.cleanup();
  }
});

test('issuing a new paper atomically retires the prior paper so remediation cannot be bypassed', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());
    const first = service.issuePaper(studentOne, 'P1T1-N02');
    const parallel = service.issuePaper(studentOne, 'P1T1-N02');

    assert.throws(
      () => service.submitAnswers(studentOne, first.attemptToken, wrongAnswers),
      (error) => error instanceof AssessmentTokenError && error.code === 'used-token',
    );
    const stale = fixture.database.prepare(`
      SELECT token.used_at AS usedAt, instance.status
      FROM formal_assessment_tokens AS token
      INNER JOIN formal_assessment_instances AS instance
        ON instance.assessment_id = token.assessment_id
      WHERE token.assessment_id = ?
    `).get(first.assessmentId) as { usedAt: string | null; status: string };
    assert.notEqual(stale.usedAt, null);
    assert.equal(stale.status, 'closed');

    service.submitAnswers(studentOne, parallel.attemptToken, wrongAnswers);
    assert.throws(
      () => service.issuePaper(studentOne, 'P1T1-N02'),
      (error) => error instanceof AssessmentRemediationRequiredError,
    );
  } finally {
    fixture.cleanup();
  }
});

test('validates all choice and ordering values against the bound paper before grading', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());
    const issued = service.issuePaper(studentOne, 'P1T1-N02');
    const invalidAnswers = [
      { ...wrongAnswers, evidenceClassification: 'forged-answer-id' },
      {
        ...wrongAnswers,
        linkReconstruction: ['source-device', 'source-port', 'forged-answer-id', 'peer-port', 'peer-device'],
      },
      {
        ...wrongAnswers,
        linkReconstruction: ['source-device', 'source-port', 'cable-label', 'peer-port', 'peer-port'],
      },
      { ...wrongAnswers, defectiveOutputRevision: ['restore-source', 'forged-answer-id'] },
    ] as AssessmentAnswers[];

    for (const invalid of invalidAnswers) {
      assert.throws(
        () => service.submitAnswers(studentOne, issued.attemptToken, invalid),
        (error) => error instanceof TypeError && /option/i.test(error.message),
      );
    }
    assert.equal(fixture.database.prepare(`
      SELECT used_at FROM formal_assessment_tokens WHERE assessment_id = ?
    `).pluck().get(issued.assessmentId), null);
    assert.equal(service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers).passed, false);
  } finally {
    fixture.cleanup();
  }
});

test('requires a coherent four-part professional conclusion instead of keyword stuffing', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());
    const issued = service.issuePaper(studentOne, 'P1T1-N02');
    const result = service.submitAnswers(studentOne, issued.attemptToken, passingAnswers);
    assert.equal(result.dimensions.professionalConclusion.score, 25);
    assert.equal(result.totalScore, 100);

    const secondStudent = service.issuePaper(studentTwo, 'P1T1-N02');
    const stuffed = {
      ...passingAnswers,
      professionalConclusion: {
        confirmedFact: '铭牌 源端 对端 模糊 复核',
        evidenceGap: '铭牌 源端 对端 模糊 复核',
        risk: '铭牌 源端 对端 模糊 复核',
        action: '铭牌 源端 对端 模糊 复核',
      },
    } as unknown as AssessmentAnswers;
    const stuffedResult = service.submitAnswers(studentTwo, secondStudent.attemptToken, stuffed);
    assert.ok(stuffedResult.dimensions.professionalConclusion.score < 25);
  } finally {
    fixture.cleanup();
  }
});

test('stores only a token hash and rejects expiry plus node, version, and instance tampering', () => {
  const fixture = createTestDatabase();
  let now = new Date('2026-07-16T10:00:00.000Z');
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, {
      ...deterministicOptions(),
      now: () => now,
      tokenTtlMs: 60_000,
    });
    const issued = service.issuePaper(studentOne, 'P1T1-N02');
    const storedHash = fixture.database.prepare(`
      SELECT token_hash FROM formal_assessment_tokens WHERE assessment_id = ?
    `).pluck().get(issued.assessmentId) as string;
    assert.equal(storedHash.length, 64);
    assert.notEqual(storedHash, issued.attemptToken);
    assert.equal(JSON.stringify(fixture.database.prepare(`
      SELECT * FROM formal_assessment_tokens WHERE assessment_id = ?
    `).get(issued.assessmentId)).includes(issued.attemptToken), false);

    assert.throws(
      () => service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers, 'P1T1-N03'),
      (error) => error instanceof AssessmentTokenError && error.code === 'invalid-token',
    );
    fixture.database.prepare(`
      UPDATE formal_assessment_tokens SET question_version = 'tampered-version'
      WHERE assessment_id = ?
    `).run(issued.assessmentId);
    assert.throws(
      () => service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers),
      (error) => error instanceof AssessmentTokenError && error.code === 'invalid-token',
    );
    fixture.database.prepare(`
      UPDATE formal_assessment_tokens SET question_version = ? WHERE assessment_id = ?
    `).run(issued.paper.questionVersion, issued.assessmentId);
    fixture.database.prepare(`
      UPDATE formal_assessment_instances SET node_id = 'tampered-node' WHERE assessment_id = ?
    `).run(issued.assessmentId);
    assert.throws(
      () => service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers),
      (error) => error instanceof AssessmentTokenError && error.code === 'invalid-token',
    );
    fixture.database.prepare(`
      UPDATE formal_assessment_instances SET node_id = ? WHERE assessment_id = ?
    `).run(issued.paper.nodeId, issued.assessmentId);
    now = new Date('2026-07-16T10:02:00.000Z');
    assert.throws(
      () => service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers),
      (error) => error instanceof AssessmentTokenError && error.code === 'expired-token',
    );
  } finally {
    fixture.cleanup();
  }
});

test('rolls back token consumption and assessment closure when persistence fails', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, deterministicOptions());
    const issued = service.issuePaper(studentOne, 'P1T1-N02');
    fixture.database.exec(`
      CREATE TRIGGER fail_formal_attempt_insert
      BEFORE INSERT ON formal_attempts
      BEGIN
        SELECT RAISE(ABORT, 'forced persistence failure');
      END
    `);
    assert.throws(
      () => service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers),
      /forced persistence failure/,
    );
    assert.deepEqual(fixture.database.prepare(`
      SELECT token.used_at AS usedAt, instance.status
      FROM formal_assessment_tokens AS token
      INNER JOIN formal_assessment_instances AS instance
        ON instance.assessment_id = token.assessment_id
      WHERE token.assessment_id = ?
    `).get(issued.assessmentId), { usedAt: null, status: 'running' });
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM formal_attempts WHERE assessment_id = ?
    `).pluck().get(issued.assessmentId), 0);
    fixture.database.exec('DROP TRIGGER fail_formal_attempt_insert');
    assert.equal(service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers).passed, false);
  } finally {
    fixture.cleanup();
  }
});

test('requires real post-failure passed activities and unlocks only after every target', () => {
  const fixture = createTestDatabase();
  const now = new Date('2000-01-01T00:00:00.000Z');
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    const service = new FormalAssessmentService(fixture.database, {
      ...deterministicOptions(),
      now: () => now,
    });
    const learning = createLearningCommandService(fixture.database);
    const activities = new ActivityRepository(fixture.database);
    const issued = service.issuePaper(studentOne, 'P1T1-N02');
    const failed = service.submitAnswers(studentOne, issued.attemptToken, wrongAnswers);

    assert.throws(
      () => service.issuePaper(studentOne, 'P1T1-N02'),
      (error) => error instanceof AssessmentRemediationRequiredError
        && error.targets.length === failed.remediationTargets.length,
    );

    let snapshot = learning.readStudentSnapshot(studentOne);
    for (const [index, sectionId] of REQUIRED_SELF_STUDY_SECTIONS.entries()) {
      snapshot = learning.appendEvent(studentOne, {
        eventId: `generic-node-complete-${index}`,
        nodeId: 'P1T1-N02',
        channel: 'self-study',
        eventType: 'section_completed',
        payload: { completed: true, sectionId },
        occurredAt: '2000-01-01T00:01:00.000Z',
        expectedVersion: snapshot.version,
      });
    }
    assert.throws(
      () => service.issuePaper(studentOne, 'P1T1-N02'),
      (error) => error instanceof AssessmentRemediationRequiredError
        && error.targets.length === failed.remediationTargets.length,
    );

    for (const [index, target] of failed.remediationTargets.entries()) {
      const activity = p01Activities.find(({ activity }) => activity.id === target.activityId);
      assert.ok(activity, `missing real activity ${target.activityId}`);
      const result = activities.recordEvaluatedAttempt({
        attemptId: `real-remediation-${index}`,
        studentId: studentOne.userId,
        activity,
        response: correctActivityResponse(target.activityId),
        expectedVersion: 0,
      });
      assert.equal(result.passed, true);
      assert.equal(
        fixture.database.prepare(`SELECT origin FROM practice_attempts WHERE attempt_id = ?`)
          .pluck().get(`real-remediation-${index}`),
        'user',
      );
      if (index < failed.remediationTargets.length - 1) {
        assert.throws(
          () => service.issuePaper(studentOne, 'P1T1-N02'),
          (error) => error instanceof AssessmentRemediationRequiredError
            && error.targets.length === failed.remediationTargets.length - index - 1,
        );
      }
    }

    assert.equal(service.issuePaper(studentOne, 'P1T1-N02').paper.nodeId, 'P1T1-N02');
  } finally {
    fixture.cleanup();
  }
});

test('refuses an accessible N02 paper until authoritative micro-practice readiness exists', async () => {
  const fixture = createTestDatabase();
  const previousPath = process.env.DGBOOK_SQLITE_PATH;
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    passRequiredActivities(fixture.database, studentOne.userId, [
      ['P1T1-N01-micro-01', 'P1T1-N01'],
    ]);
    fixture.database.prepare(`
      DELETE FROM learning_events WHERE student_id = ? AND node_id = ?
    `).run(studentOne.studentId, 'P1T1-N02');
    const learning = createLearningCommandService(fixture.database);
    assert.equal(learning.requireNodeAccess(studentOne, 'P1T1-N02').kind, 'open');
    assert.equal(
      learning.readStudentSnapshot(studentOne).nodes
        .find(({ nodeId }) => nodeId === 'P1T1-N02')?.stateTrail.includes('micro-practice-passed'),
      false,
    );

    const service = new FormalAssessmentService(fixture.database, deterministicOptions());
    assert.throws(
      () => service.issuePaper(studentOne, 'P1T1-N02'),
      (error) => error instanceof LearningCommandValidationError
        && /micro-practice-passed/.test(error.message),
    );
    assert.equal(fixture.database.prepare('SELECT COUNT(*) FROM formal_assessment_tokens').pluck().get(), 0);

    process.env.DGBOOK_SQLITE_PATH = fixture.databasePath;
    closeDatabase();
    const auth = new AuthService(fixture.database);
    const session = auth.login({ username: 'student01', password: '123456' });
    assert.ok(session);
    const route = await import('../app/api/learning/nodes/[nodeId]/assessment/route.ts');
    const locked = route.GET(
      routeRequest('GET', `${AUTH_COOKIE_NAME}=${session.token}`),
      routeContext(),
    );
    assert.equal(locked.status, 422);
    assert.deepEqual(await locked.json(), {
      error: 'Formal assessment requires micro-practice-passed first.',
      nodeId: 'P1T1-N02',
      requiredState: 'micro-practice-passed',
      routeState: 'prerequisite-required',
    });

    closeDatabase();
    passRequiredActivities(fixture.database, studentOne.userId, n02RequiredActivities);
    assert.equal(service.issuePaper(studentOne, 'P1T1-N02').paper.nodeId, 'P1T1-N02');
  } finally {
    closeDatabase();
    if (previousPath === undefined) delete process.env.DGBOOK_SQLITE_PATH;
    else process.env.DGBOOK_SQLITE_PATH = previousPath;
    fixture.cleanup();
  }
});

test('assessment route rejects forged scores and accepts an answer-only submission', async () => {
  const fixture = createTestDatabase();
  const previousPath = process.env.DGBOOK_SQLITE_PATH;
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    readyForFormalAssessment(fixture.database, studentOne.userId);
    process.env.DGBOOK_SQLITE_PATH = fixture.databasePath;
    closeDatabase();
    const auth = new AuthService(fixture.database);
    const session = auth.login({ username: 'student01', password: '123456' });
    assert.ok(session);
    const cookie = `${AUTH_COOKIE_NAME}=${session.token}`;
    const route = await import('../app/api/learning/nodes/[nodeId]/assessment/route.ts');
    const legacyAttemptRoute = await import('../app/api/learning/nodes/[nodeId]/attempts/route.ts');

    const forgedContext = route.GET(new Request(
      'http://localhost/api/learning/nodes/P1T1-N02/assessment?runId=forged-client-run',
      { headers: { cookie } },
    ), routeContext());
    assert.equal(forgedContext.status, 400);

    const paperResponse = route.GET(routeRequest('GET', cookie), routeContext());
    assert.equal(paperResponse.status, 200);
    const issued = await paperResponse.json() as { attemptToken: string; paper: unknown };
    assert.equal(JSON.stringify(issued.paper).includes('correct'), false);

    const forged = await route.POST(routeRequest('POST', cookie, {
      score: 100,
      answers: wrongAnswers,
    }, issued.attemptToken), routeContext());
    assert.equal(forged.status, 400);

    const nestedForged = await route.POST(routeRequest('POST', cookie, {
      answers: { ...wrongAnswers, score: 100 },
    }, issued.attemptToken), routeContext());
    assert.equal(nestedForged.status, 400);

    const repository = new LearningRepository(fixture.database);
    const legacy = await legacyAttemptRoute.POST(new Request(
      'http://localhost/api/learning/nodes/P1T1-N02/attempts',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          attemptId: 'forged-legacy-score',
          gameId: 'node-test',
          score: 100,
          expectedVersion: repository.readTopicVersion('learning:stu-01'),
        }),
      },
    ), routeContext());
    assert.equal(legacy.status, 400);
    assert.equal(repository.readStudentFacts('stu-01').attempts.some(
      ({ attemptId }) => attemptId === 'forged-legacy-score',
    ), false);

    const submitted = await route.POST(routeRequest('POST', cookie, {
      answers: wrongAnswers,
    }, issued.attemptToken), routeContext());
    assert.equal(submitted.status, 200);
    assert.notEqual((await submitted.json()).totalScore, 100);
  } finally {
    closeDatabase();
    if (previousPath === undefined) delete process.env.DGBOOK_SQLITE_PATH;
    else process.env.DGBOOK_SQLITE_PATH = previousPath;
    fixture.cleanup();
  }
});

function deterministicOptions() {
  let sequence = 0;
  return {
    now: () => new Date('2026-07-16T10:00:00.000Z'),
    randomId: () => `assessment-sequence-${++sequence}`,
    randomToken: () => `token-sequence-${++sequence}-0123456789abcdef`,
  };
}

const n02RequiredActivities = [
  ['P1T1-N02-foundation-01', 'P1T1-N02'],
  ['P1T1-N02-application-01', 'P1T1-N02'],
  ['P1T1-N02-transfer-01', 'P1T1-N02'],
] as const;

function readyForFormalAssessment(database: AppDatabase, studentId: string): void {
  passRequiredActivities(database, studentId, [
    ['P1T1-N01-micro-01', 'P1T1-N01'],
    ...n02RequiredActivities,
  ]);
}

function passRequiredActivities(
  database: AppDatabase,
  studentId: string,
  activities: readonly (readonly [activityId: string, nodeId: string])[],
): void {
  const insert = database.prepare(`
    INSERT INTO practice_attempts (
      attempt_id, student_id, activity_id, node_id, passed, origin, attempted_at
    ) VALUES (?, ?, ?, ?, 1, 'user', '1999-12-31T23:59:00.000Z')
  `);
  for (const [activityId, nodeId] of activities) {
    insert.run(`test-ready-${studentId}-${activityId}`, studentId, activityId, nodeId);
  }
  const insertSection = database.prepare(`
    INSERT OR IGNORE INTO learning_events (
      event_id, student_id, node_id, channel, event_type, payload_json, origin
    ) VALUES (?, ?, ?, 'self-study', 'section_completed', ?, 'user')
  `);
  for (const nodeId of new Set(activities.map(([, nodeId]) => nodeId))) {
    for (const sectionId of REQUIRED_SELF_STUDY_SECTIONS) {
      insertSection.run(
        `test-ready-${studentId}-${nodeId}-${sectionId}`,
        studentId,
        nodeId,
        JSON.stringify({ sectionId, completed: true }),
      );
    }
  }
}

function correctActivityResponse(activityId: string): Record<string, unknown> {
  return {
    'P1T1-N02-foundation-01': {
      assignments: {
        'room-overview': 'location',
        'device-nameplate': 'identity',
        'two-ended-port-trace': 'link',
      },
    },
    'P1T1-N02-application-01': {
      order: ['bbu-port', 'odf-in', 'odf-out', 'aau-port'],
    },
    'P1T1-N02-transfer-01': {
      fields: {
        siteId: 'HY-01',
        roomId: '01',
        cabinetId: 'K02',
        deviceId: 'BBU-01',
        nearPort: 'BBU-1/0',
        farPort: 'AAU-1',
      },
    },
    'P1T1-N02-remediation-revision-01': {
      revisions: {
        sourceEvidenceRevision: '原表缺少字段来源，补充设备铭牌 IMG-031 和源端口 IMG-032。',
        photoIndexRevision: '设备对应 IMG-031，源端口对应 IMG-032，对端口对应 IMG-033。',
        directionRevision: '连接方向为源端 BBU-01 CPRI-1 至对端 AAU-01 OPT-1。',
      },
    },
    'P1T1-N02-remediation-conclusion-01': {
      fields: {
        confirmedFact: '设备铭牌可识别，源端口照片清晰，已确认设备身份和源端口。',
        evidenceGap: '对端端口照片模糊，当前无法确认对端端口编号。',
        risk: '直接下结论存在链路误判风险，会影响成果交付。',
        action: '补拍对端端口照片并复核编号后再更新记录。',
      },
    },
  }[activityId] ?? {};
}

function routeRequest(method: string, cookie: string, body?: unknown, token?: string): Request {
  return new Request('http://localhost/api/learning/nodes/P1T1-N02/assessment', {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { 'x-assessment-token': token }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function routeContext() {
  return { params: { nodeId: 'P1T1-N02' } };
}
