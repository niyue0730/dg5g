#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchChromium } from './utils/playwright-browser.mjs';

const baseUrl = normalizeBaseUrl(readArg('--base-url', 'http://127.0.0.1:3157/'));
const outDir = path.resolve(process.cwd(), readArg('--out', 'output/playwright/self-study-closure'));
const allowLocalMutation = process.argv.includes('--allow-local-mutation');
const isolatedSqlite = readArg('--isolated-sqlite', '');
const demoPassword = process.env.DGBOOK_DEMO_PASSWORD ?? '123456';
const mutationMode = validateMutationMode({ baseUrl, allowLocalMutation, isolatedSqlite });
const report = {
  tool: 'audit-self-study-closure',
  baseUrl,
  mode: mutationMode ? 'isolated-local-mutation' : 'read-only',
  checkpoints: [],
  errors: [],
  blockingIssues: [],
};

await mkdir(outDir, { recursive: true });
const browser = await launchChromium({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
observeContext(studentContext, 'student');
observeContext(teacherContext, 'teacher');

try {
  await login(studentContext, 'student01');
  await login(teacherContext, 'teacher01');
  let studentSnapshot = await requestJson(studentContext, 'GET', '/api/learning/me');
  const classSnapshot = await requestJson(teacherContext, 'GET', '/api/learning/class/demo-class');
  report.checkpoints.push({
    name: 'actor-scoped-snapshots',
    studentId: studentSnapshot.studentId,
    studentVersion: studentSnapshot.version,
    classId: classSnapshot.classId,
    classVersion: classSnapshot.version,
    classStudentIds: classSnapshot.students?.map(({ studentId }) => studentId) ?? [],
  });

  if (mutationMode) {
    const scopeAttempt = await requestJson(
      studentContext,
      'POST',
      '/api/learning/activities/P1T1-N01-micro-01/attempts',
      {
        attemptId: `self-study-audit-scope-${randomUUID()}`,
        expectedVersion: 0,
        response: {
          assignments: {
            'room-01-cabinets': 'in-scope',
            'shared-operator-cabinet': 'out-of-scope',
            'room-02-cabinets': 'out-of-scope',
          },
          reasons: {
            'shared-operator-cabinet': '柜门标识属于其他运营商，不能混入本次任务台账。',
            'room-02-cabinets': '02号机房不在任务单指定的01号机房范围内，本次排除。',
          },
        },
      },
    );
    if (!scopeAttempt.passed) throw new Error('N01 scope activity did not pass server evaluation.');
    studentSnapshot = await requestJson(studentContext, 'GET', '/api/learning/me');

    for (const sectionId of ['problem', 'figure', 'steps', 'correction', 'practice', 'output']) {
      studentSnapshot = await requestJson(
        studentContext,
        'POST',
        '/api/learning/nodes/P1T1-N01/events',
        {
          eventId: `self-study-audit-n01-${sectionId}-${randomUUID()}`,
          channel: 'self-study',
          eventType: 'section_completed',
          payload: { sectionId, completed: true },
          expectedVersion: studentSnapshot.version,
        },
      );
    }

    for (const sectionId of ['problem', 'figure', 'steps', 'correction', 'practice', 'output']) {
      studentSnapshot = await requestJson(
        studentContext,
        'POST',
        '/api/learning/nodes/P1T1-N02/events',
        {
          eventId: `self-study-audit-${sectionId}-${randomUUID()}`,
          channel: 'self-study',
          eventType: 'section_completed',
          payload: { sectionId, completed: true },
          expectedVersion: studentSnapshot.version,
        },
      );
    }

    const practices = [
      {
        activityId: 'P1T1-N02-foundation-01',
        response: {
          assignments: {
            'room-overview': 'location',
            'device-nameplate': 'identity',
            'two-ended-port-trace': 'link',
          },
        },
      },
      {
        activityId: 'P1T1-N02-application-01',
        response: { order: ['bbu-port', 'odf-in', 'odf-out', 'aau-port'] },
      },
      {
        activityId: 'P1T1-N02-transfer-01',
        response: {
          fields: {
            siteId: 'HY-01',
            roomId: '01',
            cabinetId: 'K02',
            deviceId: 'BBU-01',
            nearPort: 'BBU-1/0',
            farPort: 'AAU-1',
          },
        },
      },
    ];
    const practiceResults = [];
    for (const practice of practices) {
      const result = await requestJson(
        studentContext,
        'POST',
        `/api/learning/activities/${practice.activityId}/attempts`,
        {
          attemptId: `self-study-audit-${practice.activityId}-${randomUUID()}`,
          expectedVersion: 0,
          response: practice.response,
        },
      );
      if (!result.passed) throw new Error(`${practice.activityId} did not pass server evaluation.`);
      practiceResults.push(practice.activityId);
      studentSnapshot = await requestJson(studentContext, 'GET', '/api/learning/me');
    }

    const issued = await requestJson(
      studentContext,
      'GET',
      '/api/learning/nodes/P1T1-N02/assessment',
    );
    if (!issued.attemptToken) throw new Error('Formal assessment did not issue an attempt token.');
    const diagnostic = await requestJson(
      studentContext,
      'POST',
      '/api/learning/nodes/P1T1-N02/assessment',
      {
        answers: {
          evidenceClassification: 'nameplate-photo',
          linkReconstruction: ['source-device', 'source-port', 'cable-label', 'peer-port', 'peer-device'],
          defectiveOutputRevision: ['restore-source', 'add-photo-index', 'record-direction'],
          professionalConclusion: {
            confirmedFact: '设备铭牌和序列号清晰，源端端口照片已确认。',
            evidenceGap: '对端端口照片模糊，存在证据缺口，暂时无法确认。',
            risk: '证据不足会导致链路判断错误并影响成果交付。',
            action: '重新拍摄对端端口，补齐照片索引后复核链路方向。',
          },
        },
      },
      { 'x-assessment-token': issued.attemptToken },
    );
    studentSnapshot = await requestJson(studentContext, 'GET', '/api/learning/me');
    const node = studentSnapshot.nodes?.find(({ nodeId }) => nodeId === 'P1T1-N02');
    report.checkpoints.push({
      name: 'isolated-self-study-write',
      version: studentSnapshot.version,
      state: node?.state,
      completedSections: node?.completedSections ?? [],
      attemptCount: node?.attempts?.length ?? 0,
      bestFormalScore: node?.bestFormalScore,
      scopeActivityPassed: scopeAttempt.passed,
      practiceActivities: practiceResults,
      formalScore: diagnostic.totalScore,
    });
  }

  const studentPage = await studentContext.newPage();
  await studentPage.goto(new URL('/learn/P1T1-N02', baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await studentPage.locator('body').waitFor({ state: 'visible', timeout: 10_000 });
  const routeState = await studentPage.locator('[data-node-route-state]').getAttribute('data-node-route-state').catch(() => null);
  report.checkpoints.push({ name: 'student-learning-page', routeState, url: studentPage.url() });
  await studentPage.screenshot({ path: path.join(outDir, 'student-learning.png'), fullPage: true });

  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(new URL('/teacher/workbench', baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await teacherPage.locator('body').waitFor({ state: 'visible', timeout: 10_000 });
  report.checkpoints.push({ name: 'teacher-workbench', url: teacherPage.url() });
  await teacherPage.screenshot({ path: path.join(outDir, 'teacher-workbench.png'), fullPage: true });
} catch (error) {
  report.blockingIssues.push({ code: 'audit-runtime-error', message: String(error?.message ?? error) });
} finally {
  await Promise.all([studentContext.close(), teacherContext.close()]);
  await browser.close();
}

collectBlockingIssues();
await writeFile(
  path.join(outDir, 'self-study-closure-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(report, null, 2));
if (report.blockingIssues.length) process.exit(1);

async function login(context, username) {
  const response = await context.request.post(new URL('/api/auth/login', baseUrl).toString(), {
    data: { username, password: demoPassword },
  });
  if (!response.ok()) throw new Error(`Login failed for ${username}: ${response.status()}`);
}

async function requestJson(context, method, route, data, headers = {}) {
  const response = await context.request.fetch(new URL(route, baseUrl).toString(), {
    method,
    headers,
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) {
    throw new Error(`${method} ${route} failed: ${response.status()} ${String(body.error ?? '')}`.trim());
  }
  return body;
}

function observeContext(context, role) {
  context.on('page', (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push({ role, type: 'console', text: message.text() });
    });
    page.on('pageerror', (error) => {
      report.errors.push({ role, type: 'pageerror', text: String(error?.message ?? error) });
    });
  });
}

function collectBlockingIssues() {
  const checkpoints = Object.fromEntries(report.checkpoints.map((checkpoint) => [checkpoint.name, checkpoint]));
  const actor = checkpoints['actor-scoped-snapshots'];
  if (actor?.studentId !== 'stu-01'
    || actor?.classId !== 'demo-class'
    || actor?.classStudentIds?.join(',') !== 'stu-01,stu-02,stu-03') {
    report.blockingIssues.push({ code: 'actor-scoped-snapshot-invalid', checkpoint: actor });
  }
  if (checkpoints['student-learning-page']?.routeState !== null) {
    report.blockingIssues.push({ code: 'student-learning-page-not-open', checkpoint: checkpoints['student-learning-page'] });
  }
  if (mutationMode) {
    const mutation = checkpoints['isolated-self-study-write'];
    const sections = mutation?.completedSections ?? [];
    const practiceActivities = mutation?.practiceActivities ?? [];
    if (!['problem', 'figure', 'steps', 'correction', 'practice', 'output']
      .every((sectionId) => sections.includes(sectionId))
      || mutation?.scopeActivityPassed !== true
      || !['P1T1-N02-foundation-01', 'P1T1-N02-application-01', 'P1T1-N02-transfer-01']
        .every((activityId) => practiceActivities.includes(activityId))
      || (mutation?.bestFormalScore ?? -1) < 80) {
      report.blockingIssues.push({ code: 'isolated-self-study-write-invalid', checkpoint: mutation });
    }
  }
  if (report.errors.length) report.blockingIssues.push({ code: 'browser-errors', errors: report.errors });
}

function validateMutationMode({ baseUrl: value, allowLocalMutation: allow, isolatedSqlite: sqlite }) {
  if (!allow) return false;
  const host = new URL(value).hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Mutable self-study audit is permitted only against a loopback URL.');
  }
  if (!sqlite) throw new Error('--isolated-sqlite is required with --allow-local-mutation.');
  const resolvedSqlite = path.resolve(sqlite);
  const configuredSqlite = process.env.DGBOOK_SQLITE_PATH
    ? path.resolve(process.env.DGBOOK_SQLITE_PATH)
    : '';
  if (configuredSqlite !== resolvedSqlite) {
    throw new Error('--isolated-sqlite must equal DGBOOK_SQLITE_PATH for the audited local server.');
  }
  const allowedRoots = [path.resolve(os.tmpdir()), path.resolve(process.cwd(), 'output')];
  if (!allowedRoots.some((root) => isWithin(root, resolvedSqlite)) || !/\.sqlite$/i.test(resolvedSqlite)) {
    throw new Error('Mutable audit SQLite must be a .sqlite file under the OS temp or workspace output directory.');
  }
  return true;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readArg(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
