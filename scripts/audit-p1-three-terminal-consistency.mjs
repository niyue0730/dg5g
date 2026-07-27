#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChromium } from './utils/playwright-browser.mjs';

const baseUrl = normalizeBaseUrl(readArg('--base-url', 'http://127.0.0.1:3157/'));
const outDir = path.resolve(process.cwd(), readArg('--out', 'output/playwright/p1-three-terminal-consistency'));
const password = process.env.DGBOOK_DEMO_PASSWORD ?? '123456';
const checks = [];
const failures = [];
const consoleErrors = [];
const MAX_SNAPSHOT_WINDOW_ATTEMPTS = 3;

await mkdir(outDir, { recursive: true });
const browser = await launchChromium({ headless: true });
const contexts = [];

try {
  const teacher = await authenticatedContext('teacher01');
  const students = await Promise.all(['student01', 'student02', 'student03'].map(authenticatedContext));
  contexts.push(teacher, ...students);

  const {
    teacherSnapshot,
    projectorSnapshot,
    teacherGraph,
    studentSnapshots,
    studentGraphs,
  } = await captureStableSnapshotWindow(teacher, students);

  const expectedCommon = commonOf(teacherSnapshot);
  for (const [label, snapshot] of [
    ['projector', projectorSnapshot],
    ['teacher graph', teacherGraph],
    ...studentSnapshots.map((snapshot, index) => [`student ${index + 1}`, snapshot]),
    ...studentGraphs.map((snapshot, index) => [`student graph ${index + 1}`, snapshot]),
  ]) {
    assert.deepEqual(commonOf(snapshot), expectedCommon, `${label} common facts differ`);
  }
  checks.push({
    name: 'all audiences share one common snapshot',
    status: 'passed',
    snapshotVersion: teacherSnapshot.snapshotVersion,
    revision: teacherSnapshot.classroom.revision,
  });

  assert.deepEqual(teacherSnapshot.membership, {
    classSize: 3,
    joinedCount: teacherSnapshot.membership.joinedCount,
    followingCount: teacherSnapshot.membership.followingCount,
  });
  assert.equal(teacherSnapshot.students.length, 3);
  for (let index = 0; index < studentSnapshots.length; index += 1) {
    const student = studentSnapshots[index];
    const graph = studentGraphs[index];
    const teacherStudent = teacherSnapshot.students.find(({ studentId }) => studentId === student.me.studentId);
    assert.ok(teacherStudent, `teacher cut omitted ${student.me.studentId}`);
    assert.deepEqual(student.me.nodes, teacherStudent.nodes, `${student.me.studentId} node facts differ`);
    assert.deepEqual(student.me.tasks, teacherStudent.tasks, `${student.me.studentId} task facts differ`);
    assert.equal(student.me.projectCompositeScore, teacherStudent.projectCompositeScore);
    assert.deepEqual(graph.me.nodes, student.me.nodes, `${student.me.studentId} graph node facts differ`);
    assert.deepEqual(graph.me.tasks, student.me.tasks, `${student.me.studentId} graph task facts differ`);
    for (const graphTask of graph.me.tasks) {
      const studentTask = student.me.tasks.find(({ taskId }) => taskId === graphTask.taskId);
      assert.equal(
        graphTask.stateCompletionPercent,
        studentTask?.stateCompletionPercent,
        `${student.me.studentId} ${graphTask.taskId} graph stateCompletionPercent differs`,
      );
    }
  }
  checks.push({ name: 'student teacher and graph personal facts match', status: 'passed', students: 3 });

  assertNamedMetrics(teacherSnapshot);
  assertProjectorPrivacy(projectorSnapshot);
  checks.push({ name: 'named score and submission metrics', status: 'passed' });
  checks.push({ name: 'projector has aggregate facts and zero personal data', status: 'passed' });

  if (consoleErrors.length) throw new Error(`browser console errors:\n${consoleErrors.join('\n')}`);
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser.close();
}

const report = {
  schema: 'dgbook.p1-three-terminal-consistency/v1',
  generatedAt: new Date().toISOString(),
  baseUrl,
  checks,
  consoleErrors,
  failures,
};
await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (failures.length) throw new Error(`P1 three-terminal consistency audit failed:\n- ${failures.join('\n- ')}`);
console.log(`P1 three-terminal consistency audit passed: ${path.join(outDir, 'report.json')}`);

async function authenticatedContext(username) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const response = await context.request.post(api('/api/auth/login'), {
    data: { username, password },
  });
  assert(response.ok(), `${username} login returned ${response.status()}`);
  context.on('page', (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`${username}: ${message.text()}`);
    });
    page.on('pageerror', (error) => consoleErrors.push(`${username}: ${error.message}`));
  });
  return context;
}

async function readSnapshot(context, audience) {
  const response = await context.request.get(api(`/api/snapshot?audience=${audience}&sessionId=demo-class`));
  assert(response.ok(), `${audience} snapshot returned ${response.status()}`);
  return response.json();
}

async function captureStableSnapshotWindow(teacher, students) {
  let lastWindow;
  for (let attempt = 1; attempt <= MAX_SNAPSHOT_WINDOW_ATTEMPTS; attempt += 1) {
    const teacherV1 = await readSnapshot(teacher, 'teacher');
    const [projectorSnapshot, teacherGraph, studentSnapshots, studentGraphs, surfaces] = await Promise.all([
      readSnapshot(teacher, 'projector'),
      readSnapshot(teacher, 'graph'),
      Promise.all(students.map((context) => readSnapshot(context, 'student'))),
      Promise.all(students.map((context) => readSnapshot(context, 'graph'))),
      captureFourSurfaceFacts(teacher, students[0]),
    ]);
    const teacherV2 = await readSnapshot(teacher, 'teacher');
    lastWindow = {
      attempt,
      v1: teacherV1.snapshotVersion,
      v2: teacherV2.snapshotVersion,
      revisionV1: teacherV1.classroom.revision,
      revisionV2: teacherV2.classroom.revision,
    };
    if (teacherV1.snapshotVersion !== teacherV2.snapshotVersion
      || teacherV1.classroom.revision !== teacherV2.classroom.revision) continue;

    const middleSnapshots = [projectorSnapshot, teacherGraph, ...studentSnapshots, ...studentGraphs];
    for (const [index, snapshot] of [teacherV1, ...middleSnapshots, teacherV2].entries()) {
      assertHelperObservation(snapshot.helper, `stable window snapshot ${index + 1}`);
      assert.deepEqual(helperStableFacts(snapshot.helper), helperStableFacts(teacherV1.helper), `stable window helper facts differ at snapshot ${index + 1}`);
    }
    const expectedCommon = commonOf(teacherV1);
    for (const [index, snapshot] of [...middleSnapshots, teacherV2].entries()) {
      assert.deepEqual(commonOf(snapshot), expectedCommon, `stable window common facts differ at snapshot ${index + 1}`);
    }
    assert.deepEqual(teacherV2.students, teacherV1.students, 'teacher personal facts changed inside a stable version window');
    assertSurfaceFacts(surfaces, {
      teacher: teacherV2,
      projector: projectorSnapshot,
      student: studentSnapshots[0],
      graph: studentGraphs[0],
    });
    checks.push({
      name: 'teacher V1 to four terminals to teacher V2 stable handshake',
      status: 'passed',
      attempt,
      snapshotVersion: teacherV2.snapshotVersion,
      revision: teacherV2.classroom.revision,
      helperObservedAt: [teacherV1.helper.observedAt, teacherV2.helper.observedAt],
    });
    return {
      teacherSnapshot: teacherV2,
      projectorSnapshot,
      teacherGraph,
      studentSnapshots,
      studentGraphs,
    };
  }
  throw new Error(`authoritative snapshot did not stabilize within ${MAX_SNAPSHOT_WINDOW_ATTEMPTS} attempts: ${JSON.stringify(lastWindow)}`);
}

async function captureFourSurfaceFacts(teacher, student) {
  const [studentFacts, teacherFacts, projectorFacts, graphFacts] = await Promise.all([
    captureSnapshotSurface(student, '/student/home', '[data-student-home]', 'student-home'),
    captureSnapshotSurface(teacher, '/teacher/sessions/demo-class', '.teacher-console', 'teacher-session'),
    captureSnapshotSurface(
      teacher,
      '/present/demo-class',
      '.projector-app',
      'projector',
      '.scene-projector-stage [data-teaching-page], .scene-projector-stage .projector-formal-test, .scene-projector-stage .projector-review',
    ),
    captureSnapshotSurface(student, '/course', '[data-course-home]', 'student-graph'),
  ]);
  return { student: studentFacts, teacher: teacherFacts, projector: projectorFacts, graph: graphFacts };
}

async function captureSnapshotSurface(context, route, selector, label, readySelector) {
  const attributes = [
    'data-snapshot-version',
    'data-classroom-revision',
    'data-class-size',
    'data-formal-submitted',
    'data-formal-passed',
  ];
  return captureSurface(context, route, selector, label, async (page, root) => {
    if (readySelector) {
      await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 45_000 });
    }
    await page.waitForFunction(({ target, names }) => {
      const element = document.querySelector(target);
      return Boolean(element && names.every((name) => element.getAttribute(name) !== null));
    }, { target: selector, names: attributes }, { timeout: 20_000 });
    return Object.fromEntries(await Promise.all(attributes.map(async (name) => [name, await root.getAttribute(name)])));
  });
}

async function captureSurface(context, route, selector, label, readFacts) {
  const page = await context.newPage();
  try {
    const response = await page.goto(api(route), { waitUntil: 'domcontentloaded' });
    assert(response?.ok(), `${label} returned ${response?.status() ?? 'no response'}`);
    const root = page.locator(selector).first();
    await root.waitFor({ state: 'visible', timeout: 20_000 });
    const facts = await readFacts(page, root);
    await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true });
    return facts;
  } finally {
    await page.close();
  }
}

function assertSurfaceFacts(surfaces, snapshots) {
  for (const label of ['student', 'teacher', 'projector', 'graph']) {
    const surface = surfaces[label];
    const snapshot = snapshots[label];
    assert.equal(integerAttribute(surface['data-snapshot-version'], `${label} data-snapshot-version`), snapshot.snapshotVersion);
    assert.equal(integerAttribute(surface['data-classroom-revision'], `${label} data-classroom-revision`), snapshot.classroom.revision);
    assert.equal(integerAttribute(surface['data-class-size'], `${label} data-class-size`), snapshot.membership.classSize);
    assert.equal(
      integerAttribute(surface['data-formal-submitted'], `${label} data-formal-submitted`),
      snapshot.submissions.activeAssessment.submittedCount,
    );
    assert.equal(
      integerAttribute(surface['data-formal-passed'], `${label} data-formal-passed`),
      snapshot.submissions.activeAssessment.passedCount,
    );
  }
  checks.push({ name: 'four terminal DOM data attributes match authoritative API facts', status: 'passed', surfaces });
}

function integerAttribute(value, name) {
  const parsed = Number(value);
  assert.equal(Number.isSafeInteger(parsed), true, `${name} is not a safe integer: ${value}`);
  return parsed;
}

function commonOf(snapshot) {
  const common = structuredClone(snapshot);
  for (const field of ['audience', 'me', 'students', 'weakPoints', 'mode', 'nodeHeatmap', 'tasks']) delete common[field];
  if (common.helper) delete common.helper.observedAt;
  return common;
}

function assertHelperObservation(helper, label) {
  assert.equal(typeof helper.observedAt, 'string', `${label} helper.observedAt is missing`);
  assert.equal(Number.isFinite(Date.parse(helper.observedAt)), true, `${label} helper.observedAt is invalid`);
  assert.equal(['offline', 'online', 'degraded'].includes(helper.status), true, `${label} helper status is invalid`);
  assert.equal(typeof helper.canPush, 'boolean', `${label} helper canPush is invalid`);
  for (const [name, value] of Object.entries({
    onlineStudentDeviceCount: helper.onlineStudentDeviceCount,
    applied: helper.commandDelivery.applied,
    pending: helper.commandDelivery.pending,
    failed: helper.commandDelivery.failed,
  })) assert.equal(Number.isSafeInteger(value) && value >= 0, true, `${label} helper ${name} is invalid`);
}

function helperStableFacts(helper) {
  const copy = structuredClone(helper);
  delete copy.observedAt;
  return copy;
}

function assertNamedMetrics(snapshot) {
  assert.equal(typeof snapshot.submissions.classroomActivity.submittedCount, 'number');
  assert.equal(typeof snapshot.submissions.activeAssessment.submittedCount, 'number');
  assert.equal(typeof snapshot.submissions.professionalOutputs.submittedAwaitingReviewCount, 'number');
  const serialized = JSON.stringify(snapshot.classScores);
  for (const forbidden of ['"score"', '"grade"', '"submittedCount":']) {
    assert.equal(serialized.includes(forbidden), false, `ambiguous metric key leaked: ${forbidden}`);
  }
  for (const student of snapshot.students) {
    for (const task of student.tasks) {
      if ('taskCompositeScore' in task) assert.equal(typeof task.taskCompositeScore, 'number');
      if ('nodeTestHighestScore' in task) assert.equal(typeof task.nodeTestHighestScore, 'number');
    }
    if ('projectCompositeScore' in student) assert.equal(typeof student.projectCompositeScore, 'number');
  }
}

function assertProjectorPrivacy(snapshot) {
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'stu-01', 'stu-02', 'stu-03', 'student01', 'student02', 'student03',
    '学生一', '学生二', '学生三',
  ]) assert.equal(serialized.includes(forbidden), false, `projector leaked ${forbidden}`);
  const forbiddenKeys = new Set([
    'studentId', 'students', 'participants', 'roster', 'devices', 'acks',
    'displayName', 'username', 'deviceId', 'outputId', 'feedback', 'answers', 'evidenceText',
  ]);
  visit(snapshot, (key) => assert.equal(forbiddenKeys.has(key), false, `projector leaked key ${key}`));
}

function visit(value, check) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    check(key);
    visit(nested, check);
  }
}

function api(route) {
  return new URL(route.replace(/^\//, ''), baseUrl).toString();
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
