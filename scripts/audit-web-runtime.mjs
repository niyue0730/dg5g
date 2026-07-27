#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChromium } from './utils/playwright-browser.mjs';

const baseUrl = normalizeBaseUrl(readArg('--base-url', 'http://127.0.0.1:3157/'));
const outDir = path.resolve(process.cwd(), readArg('--out', 'output/playwright/web-runtime'));
const password = process.env.DGBOOK_DEMO_PASSWORD ?? '123456';
const isolatedDatabase = process.env.DGBOOK_AUDIT_ISOLATED_SQLITE === '1';
const failures = [];
const checks = [];
const consoleErrors = [];

await mkdir(outDir, { recursive: true });
const browser = await launchChromium({ headless: true });

try {
  const anonymous = await browser.newContext();
  await expectStatus(anonymous, '/api/snapshot?audience=student&sessionId=demo-class', 401, 'anonymous authoritative snapshot');
  await anonymous.close();

  const studentOne = await authenticatedContext('student01', { width: 1440, height: 900 });
  const studentTwo = await authenticatedContext('student02', { width: 390, height: 844 });
  const studentThree = await authenticatedContext('student03', { width: 1920, height: 1080 });
  const teacher = await authenticatedContext('teacher01', { width: 1440, height: 900 });

  const studentSnapshot = await readAudienceSnapshot(studentOne, 'student');
  const studentTwoSnapshot = await readAudienceSnapshot(studentTwo, 'student');
  const studentThreeSnapshot = await readAudienceSnapshot(studentThree, 'student');
  const teacherSnapshot = await readAudienceSnapshot(teacher, 'teacher');
  const projectorSnapshot = await readAudienceSnapshot(teacher, 'projector');
  const graphSnapshot = await readAudienceSnapshot(studentOne, 'graph');
  assertStudentSnapshot(studentSnapshot, 'stu-01');
  assertStudentSnapshot(studentTwoSnapshot, 'stu-02');
  assertStudentSnapshot(studentThreeSnapshot, 'stu-03');
  assertTeacherSnapshot(teacherSnapshot);
  assertCommonSnapshotFacts({ student: studentSnapshot, teacher: teacherSnapshot, projector: projectorSnapshot, graph: graphSnapshot });
  assertProjectorPrivacy(projectorSnapshot);
  await expectStatus(studentOne, '/api/skill-progress/stu-01', 410, 'retired legacy progress endpoint');
  await expectStatus(studentOne, '/api/snapshot?audience=teacher&sessionId=demo-class', 403, 'student teacher snapshot denial');
  await expectStatus(studentOne, '/api/snapshot?audience=projector&sessionId=demo-class', 403, 'student projector snapshot denial');
  await expectStatus(teacher, '/api/snapshot?audience=student&sessionId=demo-class', 403, 'teacher student snapshot denial');

  await assertPage(studentOne, '/student/home', '[data-student-home]', 'student-home');
  await assertP1ProjectPage(studentOne, 'stu-01', 'P01');
  await assertP1ProjectPage(studentTwo, 'stu-02', 'P02');
  await assertP1ProjectPage(studentThree, 'stu-03', 'P03');
  await assertP1PortfolioPage(studentOne, 'stu-01', { viewportLabel: '1440', expectedVersion: undefined });
  await assertP1PortfolioPage(studentTwo, 'stu-02', {
    viewportLabel: '390',
    expectedVersion: 'v1',
    expectedTaskScoreLabel: '尚未形成',
    forbiddenTaskScore: '89',
  });
  await assertLockedNodePage(studentOne, '/learn/P1T2-N01', 'P1T1-N04');
  await assertCapabilityGraph(studentThree);
  await assertFullSelfStudyPage(studentThree, {
    studentId: 'stu-03',
    nodeId: 'P1T1-N02',
    evidenceAssertions: [
      ['设备位置证据', /位置证据|设备在哪里/],
      ['设备身份信息', /身份信息|设备是谁/],
      ['连接方向证据', /连接方向|从哪里到哪里/],
      ['证据判断原因', /为什么/],
    ],
  });
  await assertFullSelfStudyPage(studentThree, {
    studentId: 'stu-03',
    nodeId: 'P1T2-N02',
    evidenceAssertions: [
      ['天线方位角', /方位角/],
      ['天线下倾', /下倾/],
      ['天线挂高', /挂高/],
    ],
  });
  await assertFullSelfStudyPage(studentThree, {
    studentId: 'stu-03',
    nodeId: 'P1T3-N02',
    evidenceAssertions: [
      ['投诉同地点条件', /同一?地点/],
      ['投诉同业务条件', /同一?业务/],
      ['投诉同终端条件', /同一?终端/],
    ],
  });
  await assertPage(teacher, '/teacher/workbench', '[data-teacher-workbench]', 'teacher-workbench');
  await assertPage(teacher, '/teacher/sessions/demo-class', '.teacher-console[data-role-scope], .teacher-console', 'teacher-console');
  await assertPage(teacher, '/present/demo-class', '.projector-app', 'projector');
  await assertPage(studentOne, '/classroom/demo-class', '[data-student-mode]', 'student-classroom');

  if (isolatedDatabase) await assertIsolatedMutation(studentTwo);
  else checks.push({ name: 'isolated mutation', status: 'skipped', reason: 'DGBOOK_AUDIT_ISOLATED_SQLITE is not enabled' });

  await Promise.all([studentOne.close(), studentTwo.close(), studentThree.close(), teacher.close()]);
} finally {
  await browser.close();
}

if (consoleErrors.length) failures.push(`browser console errors: ${consoleErrors.join(' | ')}`);
const report = {
  baseUrl,
  checkedAt: new Date().toISOString(),
  isolatedDatabase,
  checks,
  consoleErrors,
  failures,
};
await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (failures.length) throw new Error(`web runtime audit failed:\n- ${failures.join('\n- ')}`);
console.log(`web runtime audit passed: ${path.join(outDir, 'report.json')}`);

async function authenticatedContext(username, viewport) {
  const context = await browser.newContext({ viewport });
  const response = await context.request.post(api('/api/auth/login'), {
    data: { username, password },
  });
  assert(response.ok(), `${username} login returned ${response.status()}`);
  bindConsoleCapture(context, username);
  return context;
}

function bindConsoleCapture(context, label) {
  context.on('page', (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`);
    });
    page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`));
  });
}

async function readAudienceSnapshot(context, audience) {
  const response = await context.request.get(api(`/api/snapshot?audience=${audience}&sessionId=demo-class`));
  assert(response.ok(), `${audience} authoritative snapshot returned ${response.status()}`);
  const snapshot = await response.json();
  assert(snapshot.audience === audience, `${audience} request received ${snapshot.audience ?? 'no'} audience`);
  return snapshot;
}

function assertStudentSnapshot(snapshot, studentId) {
  assert(snapshot.me?.studentId === studentId, `${studentId} received another student's snapshot`);
  assert(Array.isArray(snapshot.me?.nodes), `${studentId} snapshot omitted nodes`);
  checks.push({ name: `${studentId} actor-scoped authoritative snapshot`, status: 'passed', snapshotVersion: snapshot.snapshotVersion });
}

function assertTeacherSnapshot(snapshot) {
  const ids = snapshot.students?.map((student) => student.studentId).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['stu-01', 'stu-02', 'stu-03']), `class roster mismatch: ${JSON.stringify(ids)}`);
  checks.push({ name: 'teacher authoritative snapshot', status: 'passed', studentIds: ids, snapshotVersion: snapshot.snapshotVersion });
}

function assertCommonSnapshotFacts(snapshots) {
  const entries = Object.entries(snapshots);
  const expected = JSON.stringify(commonSnapshotFacts(entries[0][1]));
  const versions = {};
  for (const [audience, snapshot] of entries) {
    assert(Number.isSafeInteger(snapshot.snapshotVersion), `${audience} snapshot omitted its authoritative version`);
    assert(snapshot.classroom?.sessionId === 'demo-class', `${audience} snapshot did not read demo-class`);
    assert(snapshot.membership?.classSize === 3, `${audience} snapshot class size is not three`);
    assert(JSON.stringify(commonSnapshotFacts(snapshot)) === expected, `${audience} common authoritative facts differ`);
    versions[audience] = snapshot.snapshotVersion;
  }
  checks.push({ name: 'four audiences share authoritative common facts', status: 'passed', versions });
}

function commonSnapshotFacts(snapshot) {
  const common = structuredClone(snapshot);
  for (const field of ['audience', 'me', 'students', 'weakPoints', 'mode', 'nodeHeatmap', 'tasks']) delete common[field];
  if (common.helper) delete common.helper.observedAt;
  return common;
}

function assertProjectorPrivacy(snapshot) {
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ['stu-01', 'stu-02', 'stu-03', 'student01', 'student02', 'student03']) {
    assert(!serialized.includes(forbidden), `projector snapshot leaked ${forbidden}`);
  }
  const forbiddenKeys = new Set([
    'studentId', 'students', 'participants', 'roster', 'devices', 'acks',
    'displayName', 'username', 'deviceId', 'outputId', 'feedback', 'answers', 'evidenceText',
  ]);
  visitSnapshot(snapshot, (key) => assert(!forbiddenKeys.has(key), `projector snapshot leaked key ${key}`));
  checks.push({ name: 'projector authoritative snapshot contains no personal data', status: 'passed' });
}

function visitSnapshot(value, check) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    check(key);
    visitSnapshot(nested, check);
  }
}

async function assertPage(context, route, selector, name) {
  const page = await context.newPage();
  const response = await page.goto(api(route), { waitUntil: 'domcontentloaded' });
  assert(response?.ok(), `${name} returned ${response?.status() ?? 'no response'}`);
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  checks.push({ name, status: 'passed', route });
  await page.close();
}

async function assertFullSelfStudyPage(context, { studentId, nodeId, evidenceAssertions }) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__DGBOOK_RUNTIME_AUDIT_PLAYBACK_EVENTS__ = 0;
    window.addEventListener('dgbook:playback-target', () => {
      window.__DGBOOK_RUNTIME_AUDIT_PLAYBACK_EVENTS__ += 1;
    });
  });
  const route = `/learn/${nodeId}`;
  const response = await page.goto(api(route), { waitUntil: 'networkidle' });
  assert(response?.ok(), `${studentId} ${nodeId} self-study page returned ${response?.status() ?? 'no response'}`);

  const renderer = page.locator(`[data-self-study-renderer="${nodeId}"]`);
  await renderer.waitFor({ state: 'visible', timeout: 15_000 });
  const rendererLayout = await renderer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      viewportWidth: window.innerWidth,
    };
  });
  if (rendererLayout.viewportWidth <= 760) {
    assert(rendererLayout.left >= -1, `${studentId} ${nodeId} mobile textbook overflows the left viewport edge`);
    assert(rendererLayout.right <= rendererLayout.viewportWidth + 1, `${studentId} ${nodeId} mobile textbook overflows the right viewport edge`);
    assert(rendererLayout.width >= rendererLayout.viewportWidth * 0.9, `${studentId} ${nodeId} mobile textbook does not fill at least 90% of the viewport`);
  }
  const expectedSections = ['problem', 'figure', 'steps', 'correction', 'practice', 'output'];
  const renderedSections = await renderer.locator('[data-self-study-section]').evaluateAll((sections) => (
    sections.map((section) => section.getAttribute('data-self-study-section'))
  ));
  assert(
    JSON.stringify(renderedSections) === JSON.stringify(expectedSections),
    `${studentId} ${nodeId} self-study sections mismatch: ${JSON.stringify(renderedSections)}`,
  );

  const navigation = renderer.locator('.self-study-head nav button');
  assert(await navigation.count() === expectedSections.length, `${studentId} ${nodeId} does not expose six manual reading controls`);
  const readableSections = [];
  for (const [index, sectionId] of expectedSections.entries()) {
    await navigation.nth(index).click();
    const section = renderer.locator(`[data-self-study-section="${sectionId}"]`);
    await section.waitFor({ state: 'visible', timeout: 5_000 });
    await renderer.locator('.self-study-sections').evaluate((element) => element.scrollTo({ left: 0, top: 0 }));
    const readingAnchor = section.locator('h2').first();
    await readingAnchor.waitFor({ state: 'visible', timeout: 5_000 });
    const viewport = await readingAnchor.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const intersectionTop = Math.max(0, rect.top);
      const intersectionBottom = Math.min(window.innerHeight, rect.bottom);
      const intersectionLeft = Math.max(0, rect.left);
      const intersectionRight = Math.min(window.innerWidth, rect.right);
      const hitX = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const hitY = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(hitX, hitY);
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        intersectionWidth: Math.max(0, Math.round(intersectionRight - intersectionLeft)),
        intersectionHeight: Math.max(0, Math.round(intersectionBottom - intersectionTop)),
        unobscured: Boolean(hit && (hit === element || element.contains(hit))),
      };
    });
    assert(
      viewport.intersectionWidth >= Math.min(80, viewport.viewportWidth * 0.5),
      `${studentId} ${nodeId} ${sectionId} is rendered outside the horizontal viewport`,
    );
    assert(viewport.intersectionHeight >= 18, `${studentId} ${nodeId} ${sectionId} heading is rendered outside the vertical viewport`);
    assert(viewport.unobscured, `${studentId} ${nodeId} ${sectionId} heading is covered by another interface layer`);
    const text = (await section.innerText()).replace(/\s+/g, ' ').trim();
    assert(text.length >= 80, `${studentId} ${nodeId} ${sectionId} is summary-only (${text.length} characters)`);
    readableSections.push({ sectionId, textLength: text.length, viewport, text });
  }

  const markerCounts = {
    glossary: await renderer.locator('[data-self-study-glossary]').count(),
    terms: await renderer.locator('[data-self-study-term]').count(),
    examples: await renderer.locator('[data-self-study-example]').count(),
    counterexamples: await renderer.locator('[data-self-study-counterexample]').count(),
    retries: await renderer.locator('[data-self-study-retry]').count(),
    transfer: await renderer.locator('[data-self-study-transfer]').count(),
    rubric: await renderer.locator('[data-self-study-rubric]').count(),
    outputTemplate: await renderer.locator('[data-self-study-output-template]').count(),
    foundationPractice: await renderer.locator('[data-practice-level="foundation"]').count(),
    applicationPractice: await renderer.locator('[data-practice-level="application"]').count(),
    transferPractice: await renderer.locator('[data-practice-level="transfer"]').count(),
  };
  assert(markerCounts.glossary === 1, `${studentId} ${nodeId} glossary marker is missing or duplicated`);
  assert(markerCounts.terms >= 3, `${studentId} ${nodeId} must render at least three glossary terms`);
  assert(markerCounts.examples >= 2, `${studentId} ${nodeId} must render at least two complete examples`);
  assert(markerCounts.counterexamples >= 2, `${studentId} ${nodeId} must render at least two counterexamples`);
  assert(markerCounts.retries >= 3, `${studentId} ${nodeId} must render retry controls for all three practice levels`);
  assert(markerCounts.transfer === 1, `${studentId} ${nodeId} transfer task marker is missing or duplicated`);
  assert(markerCounts.rubric === 1, `${studentId} ${nodeId} rubric marker is missing or duplicated`);
  assert(markerCounts.outputTemplate === 1, `${studentId} ${nodeId} output template marker is missing or duplicated`);
  assert(markerCounts.foundationPractice >= 1, `${studentId} ${nodeId} foundation practice marker is missing`);
  assert(markerCounts.applicationPractice >= 1, `${studentId} ${nodeId} application practice marker is missing`);
  assert(markerCounts.transferPractice >= 1, `${studentId} ${nodeId} transfer practice marker is missing`);

  const fullText = readableSections.map(({ text }) => text).join('\n');
  for (const [label, pattern] of evidenceAssertions) {
    assert(pattern.test(fullText), `${studentId} ${nodeId} omitted qualitative evidence: ${label}`);
  }

  const playbackState = await page.evaluate(() => ({
    playbackTargetEvents: window.__DGBOOK_RUNTIME_AUDIT_PLAYBACK_EVENTS__ ?? 0,
    playingAudio: [...document.querySelectorAll('audio')].filter((audio) => !audio.paused).length,
  }));
  assert(playbackState.playbackTargetEvents === 0, `${studentId} ${nodeId} required a playback event during manual reading`);
  assert(playbackState.playingAudio === 0, `${studentId} ${nodeId} started audio during manual reading`);

  await page.screenshot({ path: path.join(outDir, `${studentId}-${nodeId.toLowerCase()}-self-study.png`), fullPage: true });
  checks.push({
    name: `${studentId} ${nodeId} complete self-study without playback`,
    status: 'passed',
    route,
    rendererLayout,
    sections: readableSections.map(({ sectionId, textLength, viewport }) => ({ sectionId, textLength, viewport })),
    markerCounts,
    qualitativeEvidence: evidenceAssertions.map(([label]) => label),
    playbackState,
  });
  await page.close();
}

async function assertP1ProjectPage(context, studentId, expectedTaskId) {
  const page = await context.newPage();
  const response = await page.goto(api('/student/projects/p1'), { waitUntil: 'networkidle' });
  assert(response?.ok(), `${studentId} P1 project page returned ${response?.status() ?? 'no response'}`);
  await page.locator('[data-p1-project]').waitFor({ state: 'visible', timeout: 15_000 });
  for (const taskId of ['P01', 'P02', 'P03']) {
    assert(await page.locator(`[data-p1-task="${taskId}"]`).count() === 1, `${studentId} P1 page omitted ${taskId}`);
  }
  const scroll = await page.evaluate(() => {
    const scroller = document.scrollingElement;
    const lastTask = document.querySelector('[data-p1-task="P03"]');
    const scrollHeight = scroller?.scrollHeight ?? 0;
    const viewportHeight = window.innerHeight;
    window.scrollTo(0, Math.max(0, scrollHeight - viewportHeight));
    const lastTaskBottom = lastTask?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY;
    return {
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      scrollHeight,
      viewportHeight,
      scrollTop: scroller?.scrollTop ?? 0,
      lastTaskBottom,
    };
  });
  assert(scroll.bodyOverflowY === 'auto', `${studentId} P1 page body remains scroll-locked`);
  if (scroll.scrollHeight > scroll.viewportHeight) {
    assert(scroll.scrollTop > 0, `${studentId} P1 page could not scroll to the final task`);
    assert(scroll.lastTaskBottom <= scroll.viewportHeight + 2, `${studentId} P03 card remains clipped after scrolling`);
  } else {
    assert(scroll.lastTaskBottom <= scroll.viewportHeight + 2, `${studentId} P03 card is clipped even though the page fits one viewport`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const expectedTask = page.locator(`[data-p1-task="${expectedTaskId}"]`);
  assert(await expectedTask.count() === 1, `${studentId} current task ${expectedTaskId} is missing`);
  assert(await page.locator('[data-p1-portfolio-link]').count() === 1, `${studentId} P1 page omitted its portfolio entry`);
  await page.screenshot({ path: path.join(outDir, `${studentId}-p1-project.png`), fullPage: true });
  checks.push({ name: `${studentId} P1 project chain`, status: 'passed', expectedTaskId, scroll });
  await page.close();
}

async function assertP1PortfolioPage(context, studentId, {
  viewportLabel,
  expectedVersion,
  expectedTaskScoreLabel,
  forbiddenTaskScore,
}) {
  const page = await context.newPage();
  const route = '/student/projects/p1/portfolio';
  const response = await page.goto(api(route), { waitUntil: 'networkidle' });
  assert(response?.ok(), `${studentId} P1 portfolio returned ${response?.status() ?? 'no response'}`);
  const portfolio = page.locator('[data-p1-portfolio="not-formed"]');
  await portfolio.waitFor({ state: 'visible', timeout: 15_000 });
  assert(await page.locator('[data-p1-portfolio-item]').count() === 3, `${studentId} portfolio did not render exactly three task outputs`);
  assert(await page.locator('[data-p1-package-unformed]').count() === 1, `${studentId} incomplete portfolio omitted 尚未形成`);
  assert(await page.locator('[data-p1-package-reference]').count() === 0, `${studentId} incomplete portfolio invented immutable package references`);
  assert(await page.locator('a[href="/student/projects/p1"]').count() >= 1, `${studentId} portfolio omitted the return-to-P1 entry`);
  const firstItemText = (await page.locator('[data-p1-portfolio-item="P01"]').innerText()).replace(/\s+/g, ' ');
  if (expectedVersion !== undefined) assert(firstItemText.includes(expectedVersion), `${studentId} portfolio omitted current ${expectedVersion}`);
  if (expectedTaskScoreLabel !== undefined) {
    assert(firstItemText.includes(expectedTaskScoreLabel), `${studentId} portfolio omitted truthful task score label ${expectedTaskScoreLabel}`);
  }
  if (forbiddenTaskScore !== undefined) {
    assert(!firstItemText.includes(forbiddenTaskScore), `${studentId} portfolio exposed obsolete task score ${forbiddenTaskScore}`);
  }
  const layout = await portfolio.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), viewportWidth: window.innerWidth };
  });
  if (layout.viewportWidth <= 760) {
    assert(layout.left >= -1 && layout.right <= layout.viewportWidth + 1, `${studentId} mobile portfolio overflows horizontally`);
    assert(layout.width >= layout.viewportWidth * .9, `${studentId} mobile portfolio uses less than 90% of its viewport`);
  }
  await page.screenshot({ path: path.join(outDir, `${studentId}-p1-portfolio-${viewportLabel}.png`), fullPage: true });
  checks.push({
    name: `${studentId} P1 portfolio ${viewportLabel}`,
    status: 'passed',
    route,
    packageStatus: 'not-formed',
    taskCount: 3,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(expectedTaskScoreLabel === undefined ? {} : { expectedTaskScoreLabel }),
    ...(forbiddenTaskScore === undefined ? {} : { forbiddenTaskScore }),
    layout,
  });
  await page.close();
}

async function assertLockedNodePage(context, route, prerequisiteNodeId) {
  const page = await context.newPage();
  const response = await page.goto(api(route), { waitUntil: 'networkidle' });
  assert(response?.ok(), `locked node explanation page returned ${response?.status() ?? 'no response'}`);
  const gate = page.locator('[data-node-route-state="locked"]');
  await gate.waitFor({ state: 'visible', timeout: 15_000 });
  const text = await gate.innerText();
  assert(text.includes(prerequisiteNodeId), `locked node page omitted prerequisite ${prerequisiteNodeId}`);
  assert(await page.locator('[data-scene-surface="student"]').count() === 0, 'locked node page leaked textbook content');
  checks.push({ name: 'student URL bypass fails closed', status: 'passed', route, prerequisiteNodeId });
  await page.close();
}

async function assertCapabilityGraph(context) {
  const page = await context.newPage();
  const response = await page.goto(api('/course'), { waitUntil: 'networkidle' });
  assert(response?.ok(), `capability graph returned ${response?.status() ?? 'no response'}`);
  await page.locator('[data-semantic-course-graph]').waitFor({ state: 'visible', timeout: 15_000 });
  const p03 = page.locator('[data-graph-node-id="P03"]');
  const p04 = page.locator('[data-graph-node-id="P04"]');
  assert(await p03.count() === 1, 'capability graph omitted P03');
  assert(await p04.getAttribute('aria-disabled') === 'true', 'P2+ graph node is not disabled');
  assert((await p04.textContent() ?? '').includes('后续开放'), 'P2+ graph node is not labelled 后续开放');
  await page.screenshot({ path: path.join(outDir, 'student-capability-graph-1920.png'), fullPage: true });
  checks.push({ name: 'P1 capability graph and P2+ boundary', status: 'passed' });
  await page.close();
}

async function assertIsolatedMutation(context) {
  const beforeResponse = await context.request.get(api('/api/snapshot?audience=student&sessionId=demo-class'));
  const before = await beforeResponse.json();
  let after = before;
  for (const sectionId of ['problem', 'figure', 'steps', 'correction', 'practice', 'output']) {
    const response = await context.request.post(api('/api/learning/nodes/P1T1-N02/events'), {
      data: {
        eventId: `runtime-audit:${before.me.studentId}:P1T1-N02:${sectionId}`,
        channel: 'self-study',
        eventType: 'section_completed',
        payload: { sectionId, completed: true },
        expectedVersion: after.me.studentVersion,
      },
    });
    assert(response.ok(), `isolated learning mutation returned ${response.status()}`);
    const afterResponse = await context.request.get(api('/api/snapshot?audience=student&sessionId=demo-class'));
    after = await afterResponse.json();
  }
  assert(after.snapshotVersion > before.snapshotVersion, 'isolated mutation did not advance the authoritative snapshot version');
  assert(after.me.studentVersion > before.me.studentVersion, 'isolated mutation did not advance the student snapshot version');
  checks.push({ name: 'isolated mutation', status: 'passed', snapshotVersion: after.snapshotVersion });
}

async function expectStatus(context, route, expected, name) {
  const response = await context.request.get(api(route));
  assert(response.status() === expected, `${name} expected ${expected}, received ${response.status()}`);
  checks.push({ name, status: 'passed', httpStatus: expected });
}

function assert(condition, message) {
  if (condition) return;
  failures.push(message);
  throw new Error(message);
}

function api(route) {
  return new URL(route.replace(/^\//, ''), baseUrl).toString();
}

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
