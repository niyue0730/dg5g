import assert from 'node:assert/strict';
import test from 'node:test';
import { seedDemo } from './db/demo-seed.ts';
import { migrateDatabase } from './db/migrations.ts';
import { createTestDatabase } from './db/test-database.ts';
import { ClassroomRosterRepository } from './classroom-roster-repository.ts';

test('reads the three active demo-class students from SQLite membership in stable order', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N02');

    assert.deepEqual(
      roster.map(({ studentId }) => studentId),
      ['stu-01', 'stu-02', 'stu-03'],
    );
    assert.ok(roster.every(({ name }) => name.trim().length > 0));
    assert.equal(roster.some(({ studentId }) => studentId === 'teacher-01'), false);
  } finally {
    fixture.cleanup();
  }
});

test('projects classroom mode only from joined participation and never from membership alone', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.prepare(`UPDATE classroom_sessions SET status = 'active' WHERE session_id = 'demo-class'`).run();
    fixture.database.exec(`
      INSERT INTO classroom_participation (session_id, student_id, state, mode)
      VALUES
        ('demo-class', 'stu-01', 'joined', 'follow'),
        ('demo-class', 'stu-02', 'joined', 'self'),
        ('demo-class', 'stu-03', 'left', 'follow');
    `);

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N02');

    assert.deepEqual(
      roster.map(({ studentId, mode }) => ({ studentId, mode })),
      [
        { studentId: 'stu-01', mode: 'follow' },
        { studentId: 'stu-02', mode: 'self' },
        { studentId: 'stu-03', mode: 'self' },
      ],
    );
  } finally {
    fixture.cleanup();
  }
});

test('projects only persisted formal-attempt facts for the active node', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N02');
    const studentOne = roster.find(({ studentId }) => studentId === 'stu-01');
    const studentTwo = roster.find(({ studentId }) => studentId === 'stu-02');
    const studentThree = roster.find(({ studentId }) => studentId === 'stu-03');

    assert.equal(studentOne?.firstGameScore, undefined);
    assert.equal(studentOne?.bestGameScore, undefined);
    assert.equal(studentOne?.latestGameScore, undefined);
    assert.equal(studentOne?.attemptCount, undefined);
    assert.equal(studentOne?.gameDurationSeconds, undefined);
    assert.equal(studentTwo?.firstGameScore, 88);
    assert.equal(studentTwo?.bestGameScore, 88);
    assert.equal(studentTwo?.latestGameScore, 88);
    assert.equal(studentTwo?.attemptCount, 1);
    assert.equal(studentTwo?.gameDurationSeconds, 238);
    assert.equal(studentThree?.firstGameScore, 93);
    assert.equal(studentThree?.bestGameScore, 93);
    assert.equal(studentThree?.latestGameScore, 93);
    assert.equal(studentThree?.attemptCount, 1);
    assert.equal(studentThree?.gameDurationSeconds, 205);
  } finally {
    fixture.cleanup();
  }
});

test('projects persisted learning events without inventing scores', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N01');
    const studentOne = roster.find(({ studentId }) => studentId === 'stu-01');
    const studentTwo = roster.find(({ studentId }) => studentId === 'stu-02');
    const studentThree = roster.find(({ studentId }) => studentId === 'stu-03');

    assert.equal(studentOne?.selfStudyState, 'not_started');
    assert.equal(studentTwo?.selfStudyState, 'completed');
    assert.equal(studentThree?.selfStudyState, 'completed');
    assert.equal(studentOne?.bestGameScore, undefined);
    assert.equal(studentTwo?.bestGameScore, undefined);
    assert.equal(studentThree?.bestGameScore, undefined);
  } finally {
    fixture.cleanup();
  }
});

test('projects persisted task-output review facts only onto their database member', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N04');
    const studentOne = roster.find(({ studentId }) => studentId === 'stu-01');
    const studentTwo = roster.find(({ studentId }) => studentId === 'stu-02');
    const studentThree = roster.find(({ studentId }) => studentId === 'stu-03');

    assert.equal(studentOne?.submissionState, 'draft');
    assert.equal(studentOne?.evidenceCount, 0);
    assert.equal(studentTwo?.submissionState, 'reviewed');
    assert.equal(studentTwo?.evidenceCount, 1);
    assert.equal(studentTwo?.evidenceReviewStatus, 'returned');
    assert.equal(studentTwo?.teacherVerified, false);
    assert.equal(studentThree?.submissionState, 'reviewed');
    assert.equal(studentThree?.evidenceCount, 1);
    assert.equal(studentThree?.evidenceReviewStatus, 'verified');
    assert.equal(studentThree?.teacherVerified, true);
    assert.ok(roster.every(({ bestGameScore }) => bestGameScore === undefined), 'N04 output rubric scores are not node-test scores');
  } finally {
    fixture.cleanup();
  }
});

test('treats a valid but non-object event payload as unknown instead of failing the class loader', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.prepare(`
      INSERT INTO learning_events (
        event_id, student_id, node_id, channel, event_type, payload_json
      ) VALUES (?, ?, ?, 'classroom', 'classroom_activity_submitted', ?)
    `).run('event-non-object-payload', 'stu-03', 'P1T1-N02', 'null');

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N02');
    const studentThree = roster.find(({ studentId }) => studentId === 'stu-03');

    assert.equal(studentThree?.submissionState, 'submitted');
    assert.equal(studentThree?.evidenceCount, 0);
  } finally {
    fixture.cleanup();
  }
});

test('fails closed when the requested SQLite classroom does not exist', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);

    assert.throws(
      () => new ClassroomRosterRepository(fixture.database)
        .readStudentRoster('missing-classroom', 'P1T1-N02'),
      { name: 'ClassroomRosterNotFoundError', message: 'Classroom session not found: missing-classroom' },
    );
  } finally {
    fixture.cleanup();
  }
});

test('isolates roster identity and facts to active student memberships in the requested class', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.exec(`
      INSERT INTO users (id, username, display_name, role, password_hash)
      VALUES
        ('stu-other', 'student-other', 'Other Class Student', 'student', 'test-only'),
        ('stu-inactive', 'student-inactive', 'Inactive Student', 'student', 'test-only');
      UPDATE users SET is_active = 0 WHERE id = 'stu-inactive';
      INSERT INTO classroom_sessions (session_id, class_id, name, teacher_id)
      VALUES ('other-class', 'other-class', 'Other Class', 'teacher-01');
      INSERT INTO classroom_members (session_id, student_id)
      VALUES
        ('other-class', 'stu-other'),
        ('demo-class', 'stu-inactive'),
        ('demo-class', 'teacher-01');
      INSERT INTO formal_attempts (attempt_id, student_id, node_id, score)
      VALUES
        ('attempt-other-class', 'stu-other', 'P1T1-N02', 100),
        ('attempt-inactive', 'stu-inactive', 'P1T1-N02', 100);
    `);

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N02');

    assert.deepEqual(roster.map(({ studentId }) => studentId), ['stu-01', 'stu-02', 'stu-03']);
    assert.equal(JSON.stringify(roster).includes('stu-other'), false);
    assert.equal(JSON.stringify(roster).includes('stu-inactive'), false);
    assert.equal(JSON.stringify(roster).includes('teacher-01'), false);
  } finally {
    fixture.cleanup();
  }
});

test('expands from SQLite membership without an application-level three-student limit', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    fixture.database.exec(`
      INSERT INTO users (id, username, display_name, role, password_hash)
      VALUES ('stu-04', 'student04', 'Student Four', 'student', 'test-only');
      INSERT INTO classroom_members (session_id, student_id)
      VALUES ('demo-class', 'stu-04');
    `);

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N02');

    assert.deepEqual(
      roster.map(({ studentId }) => studentId),
      ['stu-01', 'stu-02', 'stu-03', 'stu-04'],
    );
    assert.equal(roster.at(-1)?.bestGameScore, undefined);
    assert.equal(roster.at(-1)?.submissionState, 'draft');
  } finally {
    fixture.cleanup();
  }
});

test('accepts a future 24-member SQLite class without changing production code', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const insertUser = fixture.database.prepare(`
      INSERT INTO users (id, username, display_name, role, password_hash)
      VALUES (?, ?, ?, 'student', 'test-only')
    `);
    const insertMember = fixture.database.prepare(`
      INSERT INTO classroom_members (session_id, student_id)
      VALUES ('demo-class', ?)
    `);
    fixture.database.transaction(() => {
      for (let index = 4; index <= 24; index += 1) {
        const suffix = String(index).padStart(2, '0');
        insertUser.run(`stu-${suffix}`, `student${suffix}`, `Student ${suffix}`);
        insertMember.run(`stu-${suffix}`);
      }
    })();

    const roster = new ClassroomRosterRepository(fixture.database)
      .readStudentRoster('demo-class', 'P1T1-N02');

    assert.equal(roster.length, 24);
    assert.equal(roster[0]?.studentId, 'stu-01');
    assert.equal(roster.at(-1)?.studentId, 'stu-24');
  } finally {
    fixture.cleanup();
  }
});
