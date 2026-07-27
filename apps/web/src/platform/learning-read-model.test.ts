import assert from 'node:assert/strict';
import test from 'node:test';
import { seedBase, seedDemo } from './db/demo-seed.ts';
import { migrateDatabase } from './db/migrations.ts';
import { createTestDatabase } from './db/test-database.ts';
import { LearningReadModel } from './learning-read-model.ts';
import { getNodeLearningPolicy } from './learning-policy.ts';
import { LearningRepository } from './learning-repository.ts';
import { REQUIRED_SELF_STUDY_SECTIONS } from './self-study-sections.ts';

test('only the policy-required passed practice activities satisfy P01 micro-practice', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    const model = new LearningReadModel(new LearningRepository(fixture.database));
    const insertPractice = fixture.database.prepare(`
      INSERT INTO practice_attempts (
        attempt_id, student_id, activity_id, node_id, response_json,
        result_json, artifact_json, passed, origin
      ) VALUES (?, 'stu-01', ?, ?, '{}', '{}', '{}', ?, 'user')
    `);
    fixture.database.exec(`
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES
        ('arbitrary-pass', 'stu-01', 'P1T1-N01', 'self-study', 'micro_practice_passed', '{}', 'user'),
        ('first-section', 'stu-01', 'P1T1-N01', 'self-study', 'section_completed',
          '{"sectionId":"problem","completed":true}', 'user'),
        ('class-submit', 'stu-01', 'P1T1-N01', 'classroom', 'classroom_submitted',
          '{"completed":true}', 'user')
    `);
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N01').state, 'learning');
    insertPractice.run('failed-required', 'P1T1-N01-micro-01', 'P1T1-N01', 0);
    insertPractice.run('passed-remediation', 'P1T1-N02-remediation-revision-01', 'P1T1-N02', 1);
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N01').state, 'learning');
    insertPractice.run('passed-required', 'P1T1-N01-micro-01', 'P1T1-N01', 1);
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N01').state, 'micro-practice-passed');
    insertCompletedSelfStudy(fixture.database, 'stu-01', 'P1T1-N01');
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N01').state, 'achieved');
  } finally {
    fixture.cleanup();
  }
});

test('N02 requires all three base activities and ignores remediation-only passes', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N01-micro-01', 'P1T1-N01');
    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N02-foundation-01', 'P1T1-N02');
    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N02-application-01', 'P1T1-N02');
    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N02-remediation-revision-01', 'P1T1-N02');
    fixture.database.prepare(`
      INSERT INTO formal_attempts (attempt_id, student_id, node_id, score, origin)
      VALUES ('n02-pass', 'stu-01', 'P1T1-N02', 100, 'user')
    `).run();
    const model = new LearningReadModel(new LearningRepository(fixture.database));
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N02').state, 'learning');
    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N02-transfer-01', 'P1T1-N02');
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N02').state, 'achieved');
  } finally {
    fixture.cleanup();
  }
});

test('lower user score shadows higher demo score and zero remains a real submitted attempt', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    insertP01PrerequisitePractice(fixture.database, 'stu-01', true);
    fixture.database.exec(`
      INSERT INTO formal_attempts (
        attempt_id, student_id, node_id, game_id, score, origin, completed_at
      ) VALUES
        ('demo-high', 'stu-01', 'P1T1-N02', 'node-test', 99, 'demo', '2026-07-16T01:00:00Z'),
        ('user-zero', 'stu-01', 'P1T1-N02', 'node-test', 0, 'user', '2026-07-16T02:00:00Z');
    `);
    const node = requiredNode(
      new LearningReadModel(new LearningRepository(fixture.database)).readStudentSnapshot('stu-01'),
      'P1T1-N02',
    );
    assert.equal(node.bestFormalScore, 0);
    assert.deepEqual(node.attempts.map(({ score, origin }) => ({ score, origin })), [
      { score: 0, origin: 'user' },
    ]);
    assert.equal(node.state, 'micro-practice-passed');
  } finally {
    fixture.cleanup();
  }
});

test('a forged user frozen task fact cannot shadow a valid task score or certify the task', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.exec(`
      INSERT INTO frozen_task_scores (
        score_id, student_id, task_id, snapshot_version,
        provisional_score, official_score, details_json, origin
      ) VALUES
        ('demo-higher-stu3-p01', 'stu-03', 'P01', 7, 99, 99, '{"taskCompositeScore":99}', 'demo'),
        ('user-lower-stu3-p01', 'stu-03', 'P01', 8, 0, 0, '{"taskCompositeScore":0}', 'user');
    `);
    const snapshot = new LearningReadModel(new LearningRepository(fixture.database))
      .readStudentSnapshot('stu-03');
    assert.equal(snapshot.tasks[0]?.taskCompositeScore, 94);
    assert.equal(snapshot.tasks[0]?.origin, 'demo');
    assert.equal(snapshot.tasks[0]?.realTaskCertified, false);
    assert.equal(snapshot.tasks[0]?.demoTaskCertified, true);
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) FROM frozen_task_scores
      WHERE student_id = 'stu-03' AND task_id = 'P01' AND origin = 'demo'
    `).pluck().get() as number >= 2, true);
  } finally {
    fixture.cleanup();
  }
});

test('user output version shadows demo return and only a review bound to the current version applies', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    insertP01PrerequisitePractice(fixture.database, 'stu-01', true);
    fixture.database.exec(`
      INSERT INTO formal_attempts (attempt_id, student_id, node_id, score, origin)
      VALUES ('formal-user', 'stu-01', 'P1T1-N02', 90, 'user');
      INSERT INTO professional_outputs (
        output_id, student_id, task_id, node_id, status, content_json,
        current_version, state_revision, origin
      ) VALUES ('mixed-output', 'stu-01', 'P01', 'P1T1-N04', 'returned',
        '{"version":1}', 1, 3, 'demo');
      INSERT INTO professional_output_versions (
        output_id, task_id, version, fields_json, upstream_refs_json
      ) VALUES ('mixed-output', 'P01', 1, '{"version":1}', '[]');
      INSERT INTO output_reviews (
        review_id, output_id, reviewer_id, status, feedback, origin
      ) VALUES ('demo-return-v1', 'mixed-output', 'teacher-01', 'returned', 'revise v1', 'demo');
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES ('demo-return-event', 'stu-01', 'P1T1-N04', 'classroom', 'teacher_returned',
        '{"reviewId":"demo-return-v1","version":1}', 'demo');
      UPDATE professional_outputs SET status = 'submitted', content_json = '{"version":2}',
        current_version = 2, state_revision = 5, origin = 'user'
      WHERE output_id = 'mixed-output';
      INSERT INTO professional_output_versions (
        output_id, task_id, version, fields_json, upstream_refs_json
      ) VALUES ('mixed-output', 'P01', 2, '{"version":2}', '[]');
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES ('user-submit-v2', 'stu-01', 'P1T1-N04', 'self-study', 'evidence_submitted',
        '{"outputId":"mixed-output","version":2}', 'user');
    `);
    const model = new LearningReadModel(new LearningRepository(fixture.database));
    const submitted = requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N04');
    assert.equal(submitted.state, 'awaiting-review');
    assert.equal(submitted.evidence?.origin, 'user');
    assert.equal(submitted.review, undefined);

    fixture.database.exec(`
      INSERT INTO output_reviews (
        review_id, output_id, reviewer_id, status, score, feedback, origin
      ) VALUES ('user-verify-v2', 'mixed-output', 'teacher-01', 'verified', 90, 'verified v2', 'user');
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES ('user-verify-event-v2', 'stu-01', 'P1T1-N04', 'classroom', 'teacher_verified',
        '{"reviewId":"user-verify-v2","version":2}', 'user');
      UPDATE professional_outputs SET status = 'verified', state_revision = 6
      WHERE output_id = 'mixed-output';
    `);
    const verified = requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N04');
    assert.equal(verified.state, 'achieved');
    assert.equal(verified.review?.outputVersion, 2);
    assert.equal(verified.review?.origin, 'user');
  } finally {
    fixture.cleanup();
  }
});

test('clean, returned, and complete demo personas project consistently with visible origins', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const model = new LearningReadModel(new LearningRepository(fixture.database));
    const clean = model.readStudentSnapshot('stu-01');
    const returned = model.readStudentSnapshot('stu-02');
    const complete = model.readStudentSnapshot('stu-03');

    assert.equal(clean.nodes.every(({ attempts, evidence }) => attempts.length === 0 && evidence === undefined), true);
    assert.equal(clean.tasks.every(({ nodeTestHighestScore, taskCompositeScore }) => (
      nodeTestHighestScore === undefined && taskCompositeScore === undefined
    )), true);
    assert.equal(requiredNode(returned, 'P1T1-N04').state, 'returned');
    assert.equal(requiredNode(returned, 'P1T1-N04').origin, 'demo');
    assert.equal(requiredNode(returned, 'P1T1-N04').evidence?.origin, 'demo');
    assert.equal(requiredNode(returned, 'P1T1-N04').review?.origin, 'demo');
    assert.equal(returned.tasks[0]?.taskCompositeScore, undefined);
    assert.equal(requiredNode(complete, 'P1T1-N04').state, 'achieved');
    assert.equal(requiredNode(complete, 'P1T2-N04').state, 'achieved');
    assert.equal(requiredNode(complete, 'P1T3-N04').state, 'achieved');
    assert.deepEqual(complete.tasks.map(({ taskId, taskCompositeScore, origin }) => ({
      taskId, taskCompositeScore, origin,
    })), [
      { taskId: 'P01', taskCompositeScore: 94, origin: 'demo' },
      { taskId: 'P02', taskCompositeScore: 92, origin: 'demo' },
      { taskId: 'P03', taskCompositeScore: 91, origin: 'demo' },
    ]);
    assert.equal(complete.projectCompositeScore, 92);
  } finally {
    fixture.cleanup();
  }
});

test('class read uses the same student projections and one shared global snapshot version', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const repository = new LearningRepository(fixture.database);
    const snapshot = new LearningReadModel(repository).readClassSnapshot('teacher-01', 'demo-class');
    assert.deepEqual(snapshot.students.map(({ studentId }) => studentId), ['stu-01', 'stu-02', 'stu-03']);
    assert.equal(snapshot.students.every(({ globalVersion }) => globalVersion === snapshot.version), true);
    assert.equal(requiredNode(snapshot.students[0]!, 'P1T1-N01').state, 'available');
    assert.equal(requiredNode(snapshot.students[1]!, 'P1T1-N04').state, 'returned');
    assert.equal(requiredNode(snapshot.students[2]!, 'P1T3-N04').state, 'achieved');
  } finally {
    fixture.cleanup();
  }
});

test('a published node with an empty activity policy fails closed on legacy generic pass events', () => {
  const fixture = createTestDatabase();
  const policy = getNodeLearningPolicy('P1T1-N01')!;
  const originalActivityIds = policy.requiredActivityIds;
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    policy.requiredActivityIds = [];
    fixture.database.exec(`
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES ('legacy-only', 'stu-01', 'P1T1-N01', 'self-study',
        'micro_practice_passed', '{"demo":true}', 'demo');
    `);
    const node = requiredNode(
      new LearningReadModel(new LearningRepository(fixture.database)).readStudentSnapshot('stu-01'),
      'P1T1-N01',
    );
    assert.equal(node.state, 'available');
    assert.equal(node.stateTrail.includes('micro-practice-passed'), false);
  } finally {
    policy.requiredActivityIds = originalActivityIds;
    fixture.cleanup();
  }
});

test('legacy demo pass history neither advances nor taints a user activity milestone', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    fixture.database.exec(`
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES ('legacy-demo-history', 'stu-01', 'P1T1-N01', 'self-study',
        'micro_practice_passed', '{"demo":true}', 'demo');
    `);
    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N01-micro-01', 'P1T1-N01');
    const node = requiredNode(
      new LearningReadModel(new LearningRepository(fixture.database)).readStudentSnapshot('stu-01'),
      'P1T1-N01',
    );
    assert.equal(node.state, 'achieved');
    assert.equal(node.origin, 'user');
  } finally {
    fixture.cleanup();
  }
});

test('node origin stays demo until every required fact and prerequisite is user-origin', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N01-micro-01', 'P1T1-N01', 'demo');
    for (const activityId of [
      'P1T1-N02-foundation-01',
      'P1T1-N02-application-01',
      'P1T1-N02-transfer-01',
    ]) insertPassedPractice(fixture.database, 'stu-01', activityId, 'P1T1-N02');
    fixture.database.exec(`
      INSERT INTO formal_attempts (attempt_id, student_id, node_id, score, origin)
      VALUES ('all-user-formal', 'stu-01', 'P1T1-N02', 90, 'user');
    `);
    const model = new LearningReadModel(new LearningRepository(fixture.database));
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N01').origin, 'demo');
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N02').origin, 'demo');

    insertPassedPractice(fixture.database, 'stu-01', 'P1T1-N01-micro-01', 'P1T1-N01', 'user', 'replacement');
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N01').origin, 'user');
    assert.equal(requiredNode(model.readStudentSnapshot('stu-01'), 'P1T1-N02').origin, 'user');
  } finally {
    fixture.cleanup();
  }
});

test('forged user frozen scores cannot replace the fully certified demo project origin', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const model = new LearningReadModel(new LearningRepository(fixture.database));
    const before = model.readStudentSnapshot('stu-03');
    assert.equal(before.projectCompositeOrigin, 'demo');
    assert.equal(before.tasks.every(({ demoTaskCertified }) => demoTaskCertified), true);

    fixture.database.exec(`
      INSERT INTO frozen_task_scores (
        score_id, student_id, task_id, snapshot_version,
        provisional_score, official_score, details_json, origin
      ) VALUES ('forged-user-p03', 'stu-03', 'P03', 99, 100, 100, '{"taskCompositeScore":100}', 'user');
    `);
    const after = model.readStudentSnapshot('stu-03');
    assert.equal(after.projectCompositeOrigin, 'demo');
    assert.equal(after.tasks.every(({ demoTaskCertified }) => demoTaskCertified), true);
    assert.equal(after.tasks.some(({ realTaskCertified }) => realTaskCertified), false);
  } finally {
    fixture.cleanup();
  }
});

function insertP01PrerequisitePractice(
  database: ReturnType<typeof createTestDatabase>['database'],
  studentId: string,
  throughN04: boolean,
) {
  const attempts = [
    ['P1T1-N01-micro-01', 'P1T1-N01'],
    ['P1T1-N02-foundation-01', 'P1T1-N02'],
    ['P1T1-N02-application-01', 'P1T1-N02'],
    ['P1T1-N02-transfer-01', 'P1T1-N02'],
    ['P1T1-N03-micro-01', 'P1T1-N03'],
    ...(throughN04 ? [['P1T1-N04-micro-01', 'P1T1-N04']] : []),
  ];
  for (const [activityId, nodeId] of attempts) {
    insertPassedPractice(database, studentId, activityId!, nodeId!);
  }
}

function insertPassedPractice(
  database: ReturnType<typeof createTestDatabase>['database'],
  studentId: string,
  activityId: string,
  nodeId: string,
  origin: 'demo' | 'user' = 'user',
  suffix = '',
) {
  database.prepare(`
    INSERT INTO practice_attempts (
      attempt_id, student_id, activity_id, node_id, passed, origin
    ) VALUES (?, ?, ?, ?, 1, ?)
  `).run(`${studentId}-${activityId}${suffix}`, studentId, activityId, nodeId, origin);
  insertCompletedSelfStudy(database, studentId, nodeId, origin, suffix);
}

function insertCompletedSelfStudy(
  database: ReturnType<typeof createTestDatabase>['database'],
  studentId: string,
  nodeId: string,
  origin: 'demo' | 'user' = 'user',
  suffix = '',
): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO learning_events (
      event_id, student_id, node_id, channel, event_type, payload_json, origin
    ) VALUES (?, ?, ?, 'self-study', 'section_completed', ?, ?)
  `);
  for (const sectionId of REQUIRED_SELF_STUDY_SECTIONS) {
    insert.run(
      `${studentId}-${nodeId}-${sectionId}${suffix}`,
      studentId,
      nodeId,
      JSON.stringify({ sectionId, completed: true }),
      origin,
    );
  }
}

function requiredNode(snapshot: ReturnType<LearningReadModel['readStudentSnapshot']>, nodeId: string) {
  const node = snapshot.nodes.find((candidate) => candidate.nodeId === nodeId);
  assert.ok(node, `missing node ${nodeId}`);
  return node;
}
