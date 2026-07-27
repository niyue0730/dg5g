import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evidenceLibraryForTask,
  readEvidenceDefinition,
} from '../../features/portfolio/evidence-library.ts';
import {
  professionalOutputSchemaForTask,
  validateProfessionalOutputSubmission,
} from '../../features/portfolio/output-schema.ts';
import { loadSelfStudyCatalog } from '../../features/textbook-scene/self-study-content.ts';
import { verifyPassword } from '../auth/password.ts';
import {
  DEMO_STUDENT_IDS,
  readDemoSeed,
  resetDemo,
  seedBase,
  seedDemo,
} from './demo-seed.ts';
import { migrateDatabase, readMigrations } from './migrations.ts';
import { createTestDatabase } from './test-database.ts';

test('three demo personas are rebuilt from complete truthful demo facts', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    assertTruthfulPersonas(fixture.database);
  } finally {
    fixture.cleanup();
  }
});

test('base and demo seeding are deterministic and keep one teacher with exactly three students', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    seedBase(fixture.database);
    seedDemo(fixture.database);
    const first = mutableCounts(fixture.database);
    seedDemo(fixture.database);
    assert.deepEqual(mutableCounts(fixture.database), first);
    assert.deepEqual(fixture.database.prepare('SELECT id FROM users ORDER BY id').pluck().all(), [
      'stu-01', 'stu-02', 'stu-03', 'teacher-01',
    ]);
    assert.equal(fixture.database.prepare("SELECT COUNT(*) FROM users WHERE role = 'teacher'").pluck().get(), 1);
    assert.equal(fixture.database.prepare("SELECT COUNT(*) FROM users WHERE role = 'student'").pluck().get(), 3);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) FROM classroom_members').pluck().get(), 3);
    const passwordRows = fixture.database.prepare(`
      SELECT password_hash AS passwordHash FROM users
    `).all() as Array<{ passwordHash: string }>;
    assert.equal(passwordRows.every(({ passwordHash }) => verifyPassword('123456', passwordHash)), true);
  } finally {
    fixture.cleanup();
  }
});

test('demo seeding upgrades a legacy demo output that occupies the same student task identity', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    fixture.database.exec(`
      INSERT INTO professional_outputs (
        output_id, student_id, task_id, node_id, status, content_json,
        current_version, state_revision, origin
      ) VALUES (
        'demo-output-stu-02-p1t1-n04', 'stu-02', 'P01', 'P1T1-N04',
        'verified', '{"kind":"legacy-placeholder"}', 1, 1, 'demo'
      );
      INSERT INTO professional_output_versions (
        output_id, task_id, version, schema_version, fields_json, upstream_refs_json
      ) VALUES (
        'demo-output-stu-02-p1t1-n04', 'P01', 1, 1,
        '{"kind":"legacy-placeholder"}', '[]'
      );
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES (
        'user-fact-survives-demo-upgrade', 'stu-02', 'P1T1-N01',
        'self-study', 'section_completed', '{}', 'user'
      );
    `);

    assert.doesNotThrow(() => seedDemo(fixture.database));
    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM professional_outputs
      WHERE output_id = 'demo-output-stu-02-p1t1-n04'
    `), 0);
    assert.deepEqual(fixture.database.prepare(`
      SELECT output_id AS outputId, status, origin
      FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).get(), {
      outputId: 'demo-output-stu-02-p01',
      status: 'returned',
      origin: 'demo',
    });
    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM learning_events
      WHERE event_id = 'user-fact-survives-demo-upgrade' AND origin = 'user'
    `), 1);
  } finally {
    fixture.cleanup();
  }
});

test('demo seeding removes obsolete demo facts and resets legacy-only cursors to the current personas', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedBase(fixture.database);
    fixture.database.exec(`
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES
        ('demo-event-stu-01-p1t1-n01', 'stu-01', 'P1T1-N02',
          'self-study', 'micro_practice_passed', '{"masteryPercent":74}', 'demo'),
        ('demo-event-stu-02-p1t1-n01', 'stu-02', 'P1T1-N01',
          'self-study', 'micro_practice_passed', '{"masteryPercent":88}', 'demo'),
        ('demo-event-stu-03-p1t1-n01-v2', 'stu-03', 'P1T1-N01',
          'self-study', 'micro_practice_passed', '{"masteryPercent":94}', 'demo');
      INSERT INTO formal_attempts (
        attempt_id, student_id, node_id, game_id, score, origin
      ) VALUES (
        'demo-attempt-stu-01-p1t1-n02', 'stu-01', 'P1T1-N02', 'node-test', 74, 'demo'
      );
      INSERT INTO frozen_task_scores (
        score_id, student_id, task_id, snapshot_version,
        provisional_score, official_score, details_json, origin
      ) VALUES (
        'demo-task-score-stu-02-p01-v2', 'stu-02', 'P01', 2,
        89, 89, '{"source":"legacy-demo"}', 'demo'
      );
      INSERT INTO self_study_cursors (
        student_id, node_id, unit_id, action_id, action_index, position_ms, is_active
      ) VALUES
        ('stu-01', 'P1T1-N02', 'P01-ku-02', 'P1T1-N02-lesson-case', 0, 0, 1),
        ('stu-02', 'P1T2-N02', 'P02-ku-02', 'P1T2-N02-lesson-case', 0, 0, 1),
        ('stu-03', 'P1T3-N02', 'P03-ku-02', 'P1T3-N02-lesson-case', 0, 0, 1);
    `);

    seedDemo(fixture.database);

    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM learning_events WHERE event_id LIKE 'demo-event-%'
    `), 0, 'learning_events must not retain obsolete demo facts');
    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM formal_attempts WHERE attempt_id LIKE 'demo-attempt-%-p1t%'
    `), 0, 'formal_attempts must not retain obsolete demo facts');
    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM frozen_task_scores WHERE score_id LIKE 'demo-task-score-%'
    `), 0, 'frozen_task_scores must not retain obsolete demo facts');
    assert.deepEqual(fixture.database.prepare(`
      SELECT student_id AS studentId, node_id AS nodeId
      FROM self_study_cursors
      WHERE is_active = 1
      ORDER BY student_id
    `).all(), [
      { studentId: 'stu-01', nodeId: 'P1T1-N01' },
      { studentId: 'stu-02', nodeId: 'P1T1-N04' },
      { studentId: 'stu-03', nodeId: 'P1T3-N04' },
    ]);
    assertTruthfulPersonas(fixture.database);
  } finally {
    fixture.cleanup();
  }
});

test('a v8 production-shaped demo upgrades through v14 without deleting an unknown legacy runtime fact', () => {
  const fixture = createTestDatabase();
  try {
    applyMigrationsThrough(fixture.database, 8);
    seedBase(fixture.database);
    fixture.database.exec(`
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json
      ) VALUES
        ('demo-event-stu-01-p1t1-n01', 'stu-01', 'P1T1-N01',
          'self-study', 'micro_practice_passed', '{"masteryPercent":92}'),
        ('demo-event-stu-02-p1t1-n01', 'stu-02', 'P1T1-N01',
          'self-study', 'micro_practice_passed', '{"masteryPercent":88}'),
        ('demo-event-stu-03-p1t1-n01-v2', 'stu-03', 'P1T1-N01',
          'self-study', 'micro_practice_passed', '{"masteryPercent":94}'),
        ('runtime-event-before-truth-origin', 'stu-02', 'P1T2-N02',
          'self-study', 'section_completed', '{"source":"runtime"}');
      INSERT INTO formal_attempts (
        attempt_id, student_id, node_id, game_id, score
      ) VALUES
        ('demo-attempt-stu-01-p1t1-n02', 'stu-01', 'P1T1-N02', 'node-test', 74),
        ('demo-attempt-stu-02-p1t1-n02-v2', 'stu-02', 'P1T1-N02', 'node-test', 88),
        ('demo-attempt-stu-03-p1t1-n02', 'stu-03', 'P1T1-N02', 'node-test', 93),
        ('demo-attempt-stu-03-p1t2-n02', 'stu-03', 'P1T2-N02', 'node-test', 91);
      INSERT INTO professional_outputs (
        output_id, student_id, task_id, node_id, status, content_json,
        current_version, state_revision
      ) VALUES
        ('demo-output-stu-02-p1t1-n04', 'stu-02', 'P01', 'P1T1-N04',
          'verified', '{"kind":"legacy-p01"}', 1, 1),
        ('demo-output-stu-03-p1t1-n04', 'stu-03', 'P01', 'P1T1-N04',
          'verified', '{"kind":"legacy-p01"}', 1, 1),
        ('demo-output-stu-03-p1t2-n04', 'stu-03', 'P02', 'P1T2-N04',
          'verified', '{"kind":"legacy-p02"}', 1, 1);
      INSERT INTO professional_output_versions (
        output_id, task_id, version, schema_version, fields_json, upstream_refs_json
      ) VALUES
        ('demo-output-stu-02-p1t1-n04', 'P01', 1, 1, '{"kind":"legacy-p01"}', '[]'),
        ('demo-output-stu-03-p1t1-n04', 'P01', 1, 1, '{"kind":"legacy-p01"}', '[]'),
        ('demo-output-stu-03-p1t2-n04', 'P02', 1, 1, '{"kind":"legacy-p02"}', '[]');
      INSERT INTO self_study_cursors (
        student_id, node_id, unit_id, action_id, action_index, position_ms, is_active
      ) VALUES
        ('stu-01', 'P1T1-N02', 'P01-ku-02', 'P1T1-N02-lesson-case', 0, 0, 1),
        ('stu-02', 'P1T2-N02', 'P02-ku-02', 'P1T2-N02-lesson-case', 0, 0, 1),
        ('stu-03', 'P1T3-N02', 'P03-ku-02', 'P1T3-N02-lesson-case', 0, 0, 1);
      INSERT INTO frozen_task_scores (
        score_id, student_id, task_id, snapshot_version,
        provisional_score, official_score, details_json
      ) VALUES
        ('demo-task-score-stu-02-p01-v2', 'stu-02', 'P01', 2, 89, 89, '{}'),
        ('demo-task-score-stu-03-p1t1-v1', 'stu-03', 'P01', 1, 94, 94, '{}'),
        ('demo-task-score-stu-03-p1t2-v1', 'stu-03', 'P02', 1, 92, 92, '{}');
    `);

    assert.deepEqual(migrateDatabase(fixture.database).appliedVersions, [9, 10, 11, 12, 13, 14]);
    seedDemo(fixture.database);

    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM learning_events WHERE event_id = 'runtime-event-before-truth-origin'
    `), 1);
    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM learning_events WHERE event_id LIKE 'demo-event-%'
    `), 0);
    assert.equal(count(fixture.database, `
      SELECT COUNT(*) FROM professional_outputs WHERE output_id LIKE 'demo-output-%-p1t%-n04'
    `), 0);
    assert.deepEqual(fixture.database.prepare(`
      SELECT student_id AS studentId, node_id AS nodeId
      FROM self_study_cursors WHERE is_active = 1 ORDER BY student_id
    `).all(), [
      { studentId: 'stu-01', nodeId: 'P1T1-N01' },
      { studentId: 'stu-02', nodeId: 'P1T2-N02' },
      { studentId: 'stu-03', nodeId: 'P1T3-N04' },
    ]);
    const first = mutableCounts(fixture.database);
    seedDemo(fixture.database);
    assert.deepEqual(mutableCounts(fixture.database), first);
    assert.equal(fixture.database.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(fixture.database.pragma('foreign_key_check'), []);
  } finally {
    fixture.cleanup();
  }
});

test('seeded facts are explicitly demo while later user facts remain authoritative on repeated seed', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    for (const table of [
      'learning_events', 'practice_attempts', 'formal_attempts',
      'professional_outputs', 'output_reviews', 'frozen_task_scores',
    ]) {
      assert.equal(fixture.database.prepare(
        `SELECT COUNT(*) FROM ${table} WHERE origin != 'demo'`,
      ).pluck().get(), 0, `${table} seed facts must be demo origin`);
    }
    fixture.database.exec(`
      UPDATE professional_outputs
      SET origin = 'user', content_json = '{"user":"kept"}'
      WHERE output_id = 'demo-output-stu-02-p01';
      INSERT INTO formal_attempts (
        attempt_id, student_id, node_id, game_id, score, origin
      ) VALUES ('user-lower-score', 'stu-02', 'P1T1-N02', 'p01-n02-formal', 0, 'user');
    `);
    seedDemo(fixture.database);
    assert.deepEqual(fixture.database.prepare(`
      SELECT origin, content_json AS contentJson
      FROM professional_outputs WHERE output_id = 'demo-output-stu-02-p01'
    `).get(), { origin: 'user', contentJson: '{"user":"kept"}' });
    assert.equal(fixture.database.prepare(
      "SELECT score FROM formal_attempts WHERE attempt_id = 'user-lower-score'",
    ).pluck().get(), 0);
  } finally {
    fixture.cleanup();
  }
});

test('reset is transactional, preserves stable rows, removes all scoped runtime, and advances topics', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const evidenceCount = count(fixture.database, 'SELECT COUNT(*) FROM evidence_library');
    fixture.database.exec(`
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json, origin
      ) VALUES ('user-transient', 'stu-01', 'P1T1-N01', 'self-study', 'section_completed', '{}', 'user');
      INSERT INTO practice_attempts (
        attempt_id, student_id, activity_id, node_id, passed, origin
      ) VALUES ('user-transient-practice', 'stu-01', 'P1T1-N01-micro-01', 'P1T1-N01', 1, 'user');
      INSERT INTO formal_assessment_instances (
        assessment_id, node_id, game_id, question_version, status
      ) VALUES ('user-transient-assessment', 'P1T1-N02', 'node-test', 'p01-n02-v1', 'running');
      INSERT INTO formal_assessment_tokens (
        token_hash, assessment_id, student_id, node_id, question_version, expires_at
      ) VALUES ('user-transient-token', 'user-transient-assessment', 'stu-01', 'P1T1-N02',
        'p01-n02-v1', '2099-01-01T00:00:00Z');
      INSERT INTO classroom_participation (
        session_id, student_id, state, mode
      ) VALUES ('demo-class', 'stu-01', 'joined', 'follow');
    `);
    const before = topicVersions(fixture.database);
    resetDemo(fixture.database);
    const afterFirst = topicVersions(fixture.database);
    assertTopicsAdvanced(before, afterFirst);
    assertTruthfulPersonas(fixture.database);
    assert.equal(count(fixture.database, "SELECT COUNT(*) FROM users"), 4);
    assert.equal(count(fixture.database, "SELECT COUNT(*) FROM classroom_members"), 3);
    assert.equal(count(fixture.database, "SELECT COUNT(*) FROM evidence_library"), evidenceCount);
    assert.equal(count(fixture.database, "SELECT COUNT(*) FROM classroom_participation"), 0);
    assert.equal(count(fixture.database, "SELECT COUNT(*) FROM learning_events WHERE event_id = 'user-transient'"), 0);
    assert.equal(count(fixture.database, "SELECT COUNT(*) FROM practice_attempts WHERE attempt_id = 'user-transient-practice'"), 0);
    assert.equal(count(fixture.database, "SELECT COUNT(*) FROM formal_assessment_instances WHERE assessment_id = 'user-transient-assessment'"), 0);

    resetDemo(fixture.database);
    const afterSecond = topicVersions(fixture.database);
    assertTopicsAdvanced(afterFirst, afterSecond);
    assertTruthfulPersonas(fixture.database);

    const invalidSeed = structuredClone(readDemoSeed());
    invalidSeed.demo.practiceAttempts[0]!.activityId = 'missing-activity';
    const stableBeforeFailure = mutableCounts(fixture.database);
    assert.throws(() => resetDemo(fixture.database, invalidSeed), /Unknown demo practice activity/);
    assert.deepEqual(mutableCounts(fixture.database), stableBeforeFailure);
    assertTruthfulPersonas(fixture.database);
  } finally {
    fixture.cleanup();
  }
});

test('frozen demo score snapshots never exceed the monotonic global snapshot', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const globalVersion = fixture.database.prepare(
      "SELECT version FROM snapshot_versions WHERE topic = 'global'",
    ).pluck().get() as number;
    const maximumFrozen = fixture.database.prepare(
      'SELECT MAX(snapshot_version) FROM frozen_task_scores',
    ).pluck().get() as number;
    assert.equal(maximumFrozen <= globalVersion, true);
  } finally {
    fixture.cleanup();
  }
});

test('every demo output version uses the exact generated schema with evidence, provenance, and bound review events', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const catalog = loadSelfStudyCatalog();
    const seed = readDemoSeed();
    for (const output of seed.demo.outputs) {
      const taskId = output.taskId as 'P01' | 'P02' | 'P03';
      const schema = professionalOutputSchemaForTask(catalog, taskId);
      const expectedKeys = schema.fields.map(({ key }) => key).sort();
      for (const version of output.versions) {
        assert.deepEqual(Object.keys(version.fields).sort(), expectedKeys, `${output.outputId} v${version.version}`);
        assert.doesNotThrow(() => validateProfessionalOutputSubmission(schema, version.fields));
        assert.deepEqual(Object.keys(version.evidenceLinks).sort(), expectedKeys);
        assert.deepEqual(
          [...new Set(version.fieldSources.map(({ fieldKey }) => fieldKey))].sort(),
          expectedKeys,
          `${output.outputId} v${version.version} provenance`,
        );
        for (const [fieldKey, evidenceIds] of Object.entries(version.evidenceLinks)) {
          assert.ok(evidenceIds.length > 0, `${output.outputId} v${version.version}.${fieldKey}`);
          for (const evidenceId of evidenceIds) {
            const definition = readEvidenceDefinition(taskId, evidenceId);
            assert.ok(definition?.allowedFieldKeys.includes(fieldKey), `${taskId}.${fieldKey}:${evidenceId}`);
          }
        }
      }
    }

    const persistedSources = fixture.database.prepare(`
      SELECT source.output_id AS outputId, source.version, source.field_key AS fieldKey,
        source.source_node_id AS sourceNodeId, source.source_attempt_id AS sourceAttemptId,
        attempt.student_id AS sourceStudentId, attempt.node_id AS attemptNodeId,
        output.student_id AS outputStudentId
      FROM output_field_sources AS source
      INNER JOIN professional_outputs AS output ON output.output_id = source.output_id
      INNER JOIN practice_attempts AS attempt ON attempt.attempt_id = source.source_attempt_id
      ORDER BY source.output_id, source.version, source.field_key, source.source_attempt_id
    `).all() as Array<{
      outputId: string; version: number; fieldKey: string; sourceNodeId: string;
      sourceAttemptId: string; sourceStudentId: string; attemptNodeId: string; outputStudentId: string;
    }>;
    assert.ok(persistedSources.length > 0);
    assert.equal(persistedSources.every((source) => (
      source.sourceStudentId === source.outputStudentId
      && source.sourceNodeId === source.attemptNodeId
    )), true);

    const verified = fixture.database.prepare(`
      SELECT output_id AS outputId, student_id AS studentId, task_id AS taskId,
        current_version AS currentVersion
      FROM professional_outputs WHERE status = 'verified'
      ORDER BY task_id
    `).all() as Array<{ outputId: string; studentId: string; taskId: string; currentVersion: number }>;
    assert.equal(verified.length, 3);
    for (const output of verified) {
      assert.equal(count(fixture.database, `
        SELECT COUNT(*) FROM learning_events
        WHERE student_id = '${output.studentId}' AND event_type = 'evidence_submitted'
          AND json_extract(payload_json, '$.outputId') = '${output.outputId}'
          AND json_extract(payload_json, '$.version') = ${output.currentVersion}
      `), 1, `${output.taskId} current version requires one submission`);
      assert.equal(count(fixture.database, `
        SELECT COUNT(*) FROM output_reviews AS review
        INNER JOIN learning_events AS event
          ON json_extract(event.payload_json, '$.reviewId') = review.review_id
        WHERE review.output_id = '${output.outputId}' AND review.status = 'verified'
          AND event.event_type = 'teacher_verified'
          AND json_extract(event.payload_json, '$.version') = ${output.currentVersion}
      `), 1, `${output.taskId} current version requires one verified review event`);
    }

    assert.deepEqual(evidenceDiffFields(
      seed.demo.outputs.find(({ outputId }) => outputId === 'demo-output-stu-03-p01')!,
    ), ['evidenceGap', 'locationEvidence']);
    assert.ok(evidenceLibraryForTask('P01').some(({ evidenceId }) => evidenceId === 'P01-EV-CLOSEOUT'));
  } finally {
    fixture.cleanup();
  }
});

test('unknown or missing seeded output fields are rejected before any demo mutation', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const before = mutableCounts(fixture.database);
    const invalidSeeds = [
      { seed: (() => {
        const seed = structuredClone(readDemoSeed());
        seed.demo.outputs.find(({ taskId }) => taskId === 'P02')!.versions[0]!.fields.invented = 'forged';
        return seed;
      })(), expected: /professional output field/i },
      { seed: (() => {
        const seed = structuredClone(readDemoSeed());
        delete seed.demo.outputs.find(({ taskId }) => taskId === 'P03')!.versions[0]!.fields.complaintBaseline;
        return seed;
      })(), expected: /professional output field/i },
      { seed: (() => {
        const seed = structuredClone(readDemoSeed());
        seed.demo.frozenTaskScores.find(({ taskId }) => taskId === 'P02')!.details.outputVersion = 99;
        return seed;
      })(), expected: /frozen task score/i },
    ];
    for (const { seed: invalidSeed, expected } of invalidSeeds) {
      assert.throws(() => resetDemo(fixture.database, invalidSeed), expected);
      assert.deepEqual(mutableCounts(fixture.database), before);
    }
  } finally {
    fixture.cleanup();
  }
});

function assertTruthfulPersonas(database: ReturnType<typeof createTestDatabase>['database']) {
  for (const table of [
    'learning_events', 'practice_attempts', 'formal_attempts',
    'professional_outputs', 'frozen_task_scores',
  ]) {
    assert.equal(count(database, `SELECT COUNT(*) FROM ${table} WHERE student_id = 'stu-01'`), 0);
  }
  assert.deepEqual(database.prepare(`
    SELECT node_id AS nodeId, is_active AS isActive
    FROM self_study_cursors WHERE student_id = 'stu-01'
  `).get(), { nodeId: 'P1T1-N01', isActive: 1 });

  assert.equal(count(database, "SELECT COUNT(*) FROM practice_attempts WHERE student_id = 'stu-02'"), 6);
  const returned = database.prepare(`
    SELECT output_id AS outputId, status, current_version AS currentVersion,
      origin, content_json AS contentJson
    FROM professional_outputs WHERE student_id = 'stu-02' AND task_id = 'P01'
  `).get() as { outputId: string; status: string; currentVersion: number; origin: string; contentJson: string };
  assert.deepEqual(
    { status: returned.status, currentVersion: returned.currentVersion, origin: returned.origin },
    { status: 'returned', currentVersion: 1, origin: 'demo' },
  );
  const returnedFields = JSON.parse(returned.contentJson) as Record<string, unknown>;
  assert.deepEqual(Object.keys(returnedFields).sort(), [
    'collectionScope', 'connectionDirection', 'deviceIdentity', 'endpointA', 'endpointB',
    'evidenceGap', 'locationEvidence', 'photoIndex', 'riskAndReviewConclusion', 'siteRoom',
  ]);
  assert.equal(Object.values(returnedFields).every((value) => typeof value === 'string' && value.length > 0), true);
  assert.equal(count(database, `
    SELECT COUNT(*) FROM output_evidence_links WHERE output_id = '${returned.outputId}' AND version = 1
  `) > 0, true);
  assert.deepEqual(database.prepare(`
    SELECT status, origin FROM output_reviews WHERE output_id = ?
  `).get(returned.outputId), { status: 'returned', origin: 'demo' });
  assert.equal(count(database, `
    SELECT COUNT(*) FROM output_review_annotations AS annotation
    INNER JOIN output_reviews AS review ON review.review_id = annotation.review_id
    WHERE review.output_id = '${returned.outputId}'
  `) > 0, true);
  assert.equal(count(database, "SELECT COUNT(*) FROM frozen_task_scores WHERE student_id = 'stu-02'"), 0);

  assert.equal(count(database, "SELECT COUNT(*) FROM practice_attempts WHERE student_id = 'stu-03'") >= 6, true);
  const p01Attempt = database.prepare(`
    SELECT assessment_id AS assessmentId, question_version AS questionVersion,
      diagnostics_json AS diagnosticsJson, answers_json AS answersJson, origin
    FROM formal_attempts WHERE student_id = 'stu-03' AND node_id = 'P1T1-N02'
  `).get() as { assessmentId: string; questionVersion: string; diagnosticsJson: string; answersJson: string; origin: string };
  assert.equal(p01Attempt.assessmentId.length > 0, true);
  assert.equal(p01Attempt.questionVersion, 'p01-n02-v1');
  assert.equal(Object.keys(JSON.parse(p01Attempt.diagnosticsJson).dimensions).length, 4);
  assert.equal(Object.keys(JSON.parse(p01Attempt.answersJson)).length, 4);
  assert.equal(p01Attempt.origin, 'demo');
  assert.equal(count(database, `
    SELECT COUNT(*) FROM professional_outputs
    WHERE student_id = 'stu-03' AND status = 'verified' AND origin = 'demo'
  `), 3);
  const completeP01 = database.prepare(`
    SELECT output_id AS outputId, current_version AS currentVersion
    FROM professional_outputs WHERE student_id = 'stu-03' AND task_id = 'P01'
  `).get() as { outputId: string; currentVersion: number };
  assert.equal(completeP01.currentVersion, 2);
  const versions = database.prepare(`
    SELECT version, fields_json AS fieldsJson
    FROM professional_output_versions WHERE output_id = ? ORDER BY version
  `).all(completeP01.outputId) as Array<{ version: number; fieldsJson: string }>;
  assert.equal(versions.length, 2);
  const v1 = JSON.parse(versions[0]!.fieldsJson);
  const v2 = JSON.parse(versions[1]!.fieldsJson);
  const changedP01Fields = Object.keys(v2).filter((fieldKey) => v1[fieldKey] !== v2[fieldKey]);
  assert.deepEqual(changedP01Fields.sort(), ['evidenceGap', 'locationEvidence']);
  const v1Evidence = evidenceLinksByField(database, completeP01.outputId, 1);
  const v2Evidence = evidenceLinksByField(database, completeP01.outputId, 2);
  const evidenceKeys = new Set([...Object.keys(v1Evidence), ...Object.keys(v2Evidence)]);
  const changedEvidenceFields = [...evidenceKeys].filter((fieldKey) => (
    JSON.stringify(v1Evidence[fieldKey] ?? []) !== JSON.stringify(v2Evidence[fieldKey] ?? [])
  ));
  assert.deepEqual(changedEvidenceFields.sort(), ['evidenceGap', 'locationEvidence']);
  assert.equal(v1Evidence.locationEvidence?.includes('P01-EV-CLOSEOUT') ?? false, false);
  assert.equal(v1Evidence.evidenceGap?.includes('P01-EV-CLOSEOUT') ?? false, false);
  assert.equal(v2Evidence.locationEvidence?.includes('P01-EV-CLOSEOUT'), true);
  assert.equal(v2Evidence.evidenceGap?.includes('P01-EV-CLOSEOUT'), true);
  assert.deepEqual(database.prepare(`
    SELECT status, origin FROM output_reviews
    WHERE output_id = ? ORDER BY reviewed_at, review_id
  `).all(completeP01.outputId), [
    { status: 'returned', origin: 'demo' },
    { status: 'verified', origin: 'demo' },
  ]);

  for (const taskId of ['P02', 'P03']) {
    const output = database.prepare(`
      SELECT output_id AS outputId, current_version AS currentVersion
      FROM professional_outputs WHERE student_id = 'stu-03' AND task_id = ?
    `).get(taskId) as { outputId: string; currentVersion: number };
    const fields = JSON.parse(database.prepare(`
      SELECT fields_json FROM professional_output_versions
      WHERE output_id = ? AND version = ?
    `).pluck().get(output.outputId, output.currentVersion) as string) as Record<string, unknown>;
    const links = database.prepare(`
      SELECT link.field_key AS fieldKey, link.evidence_id AS evidenceId
      FROM output_evidence_links AS link
      INNER JOIN evidence_library AS evidence ON evidence.evidence_id = link.evidence_id
      WHERE link.output_id = ? AND link.version = ?
      ORDER BY link.field_key, link.evidence_id
    `).all(output.outputId, output.currentVersion) as Array<{ fieldKey: string; evidenceId: string }>;
    assert.equal(links.length >= 2, true, `${taskId} must link real built-in evidence`);
    assert.equal(links.every(({ fieldKey }) => Object.hasOwn(fields, fieldKey)), true);
  }

  const dimensionKeys = [
    'evidenceClassification', 'linkReconstruction',
    'defectiveOutputRevision', 'professionalConclusion',
  ];
  for (const nodeId of ['P1T2-N02', 'P1T3-N02']) {
    const attempt = database.prepare(`
      SELECT attempt_id AS attemptId, assessment_id AS assessmentId, node_id AS nodeId,
        question_version AS questionVersion, completed_at AS completedAt,
        diagnostics_json AS diagnosticsJson, origin
      FROM formal_attempts WHERE student_id = 'stu-03' AND node_id = ?
    `).get(nodeId) as {
      attemptId: string; assessmentId: string; nodeId: string; questionVersion: string;
      completedAt: string; diagnosticsJson: string; origin: string;
    };
    const diagnostics = JSON.parse(attempt.diagnosticsJson) as Record<string, any>;
    assert.deepEqual({
      attemptId: diagnostics.attemptId,
      assessmentId: diagnostics.assessmentId,
      nodeId: diagnostics.nodeId,
      questionVersion: diagnostics.questionVersion,
      completedAt: diagnostics.completedAt,
      origin: diagnostics.origin,
    }, {
      attemptId: attempt.attemptId,
      assessmentId: attempt.assessmentId,
      nodeId: attempt.nodeId,
      questionVersion: attempt.questionVersion,
      completedAt: attempt.completedAt,
      origin: 'demo',
    });
    assert.deepEqual(Object.keys(diagnostics.dimensions).sort(), [...dimensionKeys].sort());
    assert.equal(Object.values(diagnostics.dimensions).every((dimension: any) => (
      Number.isFinite(dimension.score)
      && dimension.maxScore === 25
      && typeof dimension.feedback === 'string'
      && dimension.feedback.trim().length > 0
    )), true);
    assert.deepEqual(diagnostics.remediationTargets, []);
  }

  const frozenLinks = database.prepare(`
    SELECT score.task_id AS taskId, score.details_json AS detailsJson,
      attempt.attempt_id AS attemptId, attempt.assessment_id AS assessmentId,
      attempt.question_version AS questionVersion
    FROM frozen_task_scores AS score
    INNER JOIN formal_attempts AS attempt
      ON attempt.student_id = score.student_id
      AND attempt.node_id = CASE score.task_id
        WHEN 'P01' THEN 'P1T1-N02'
        WHEN 'P02' THEN 'P1T2-N02'
        WHEN 'P03' THEN 'P1T3-N02'
      END
    WHERE score.student_id = 'stu-03'
    ORDER BY score.task_id
  `).all() as Array<{
    taskId: string; detailsJson: string; attemptId: string;
    assessmentId: string; questionVersion: string;
  }>;
  assert.equal(frozenLinks.length, 3);
  for (const link of frozenLinks) {
    const details = JSON.parse(link.detailsJson) as Record<string, unknown>;
    assert.deepEqual({
      nodeTestAttemptId: details.nodeTestAttemptId,
      assessmentId: details.assessmentId,
      questionVersion: details.questionVersion,
    }, {
      nodeTestAttemptId: link.attemptId,
      assessmentId: link.assessmentId,
      questionVersion: link.questionVersion,
    }, `${link.taskId} frozen score must identify its exact formal diagnostic`);
  }
}

function evidenceLinksByField(
  database: ReturnType<typeof createTestDatabase>['database'],
  outputId: string,
  version: number,
) {
  const rows = database.prepare(`
    SELECT field_key AS fieldKey, evidence_id AS evidenceId
    FROM output_evidence_links WHERE output_id = ? AND version = ?
    ORDER BY field_key, evidence_id
  `).all(outputId, version) as Array<{ fieldKey: string; evidenceId: string }>;
  return rows.reduce<Record<string, string[]>>((projection, { fieldKey, evidenceId }) => {
    (projection[fieldKey] ??= []).push(evidenceId);
    return projection;
  }, {});
}

function evidenceDiffFields(output: ReturnType<typeof readDemoSeed>['demo']['outputs'][number]): string[] {
  const first = output.versions.find(({ version }) => version === 1)!;
  const second = output.versions.find(({ version }) => version === 2)!;
  const keys = new Set([...Object.keys(first.evidenceLinks), ...Object.keys(second.evidenceLinks)]);
  return [...keys].filter((key) => (
    JSON.stringify([...(first.evidenceLinks[key] ?? [])].sort())
    !== JSON.stringify([...(second.evidenceLinks[key] ?? [])].sort())
  )).sort();
}

function mutableCounts(database: ReturnType<typeof createTestDatabase>['database']) {
  return Object.fromEntries([
    'learning_events', 'practice_attempts', 'formal_assessment_instances', 'formal_assessment_tokens',
    'formal_attempts', 'professional_outputs', 'professional_output_versions', 'output_evidence_links',
    'output_field_sources', 'output_reviews', 'output_review_annotations',
    'self_study_cursors', 'frozen_task_scores',
  ].map((table) => [table, count(database, `SELECT COUNT(*) FROM ${table}`)]));
}

function count(database: ReturnType<typeof createTestDatabase>['database'], sql: string): number {
  return database.prepare(sql).pluck().get() as number;
}

function topicVersions(database: ReturnType<typeof createTestDatabase>['database']) {
  const read = database.prepare('SELECT version FROM snapshot_versions WHERE topic = ?').pluck();
  return {
    global: read.get('global') as number,
    classroom: read.get('classroom:demo-class') as number,
    students: Object.fromEntries(DEMO_STUDENT_IDS.map((id) => [
      id, read.get(`learning:${id}`) as number,
    ])) as Record<(typeof DEMO_STUDENT_IDS)[number], number>,
  };
}

function assertTopicsAdvanced(before: ReturnType<typeof topicVersions>, after: ReturnType<typeof topicVersions>) {
  assert.equal(after.global > before.global, true);
  assert.equal(after.classroom > before.classroom, true);
  for (const studentId of DEMO_STUDENT_IDS) {
    assert.equal(
      after.students[studentId] > before.students[studentId],
      true,
      `${studentId}: ${before.students[studentId]} -> ${after.students[studentId]}`,
    );
  }
}

function applyMigrationsThrough(
  database: ReturnType<typeof createTestDatabase>['database'],
  targetVersion: number,
): void {
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT
  `);
  for (const migration of readMigrations().filter(({ version }) => version <= targetVersion)) {
    database.transaction(() => {
      database.exec(migration.sql);
      database.prepare(`
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
}
