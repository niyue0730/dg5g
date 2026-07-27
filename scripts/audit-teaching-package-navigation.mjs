#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChromium } from './utils/playwright-browser.mjs';

const baseUrl = normalizeBaseUrl(readArg('--base-url', 'http://127.0.0.1:3157/'));
const outDir = path.resolve(process.cwd(), readArg('--out', 'output/playwright/teaching-package-navigation'));
const password = process.env.DGBOOK_DEMO_PASSWORD ?? '123456';
const nodeTitles = {
  'P1T1-N01': '室内资源边界',
  'P1T1-N02': '设备拓扑',
  'P1T1-N03': '运行条件',
  'P1T1-N04': '资料归档',
  'P1T2-N01': '室外覆盖边界',
  'P1T2-N02': '天线姿态',
  'P1T2-N03': '场景与遮挡',
  'P1T2-N04': '风险路线',
  'P1T3-N01': '投诉事实边界',
  'P1T3-N02': '复现场景',
  'P1T3-N03': '网络证据关联',
  'P1T3-N04': '投诉调查单',
};

await mkdir(outDir, { recursive: true });
const browser = await launchChromium({ headless: true });
const report = { baseUrl, checkedAt: new Date().toISOString(), teacher: {}, student: {}, errors: [] };

try {
  const teacher = await loginContext('teacher01', { width: 1440, height: 900 });
  const student = await firstStudentWithLockedArchive();
  try {
    report.teacher = await auditTeacher(teacher);
    report.student = await auditStudentGate(student.context, student.username);
  } finally {
    await Promise.all([teacher.close(), student.context.close()]);
  }
} finally {
  await browser.close();
}

assert(report.errors.length === 0, `browser errors: ${JSON.stringify(report.errors)}`);
await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`teaching package navigation audit passed: ${path.join(outDir, 'report.json')}`);

async function auditTeacher(context) {
  const original = await apiJson(
    await context.request.get(url('/api/class-sessions/demo-class')),
    'teacher session',
  );
  const page = await context.newPage();
  observe(page, 'teacher');
  try {
    await page.goto(url('/teacher/sessions/demo-class'), { waitUntil: 'networkidle' });
    const root = page.locator('.teacher-console');
    await root.waitFor({ state: 'visible', timeout: 20_000 });
    await root.locator('[data-helper-state="online"]').waitFor({ state: 'visible', timeout: 20_000 });
    const onlineLabel = await root.locator('[data-helper-state="online"]').innerText();
    assert(/已连接学生设备\s*3\s*台/.test(onlineLabel), `teacher helper device count is not three: ${onlineLabel}`);

    const indoorBoundary = await visitNodePages(page, 'P1T1-N01', 5);
    await page.screenshot({ path: path.join(outDir, 'teacher-indoor-boundary-page-5.png'), fullPage: true });
    const archive = await visitNodePages(page, 'P1T1-N04', 5);
    await page.screenshot({ path: path.join(outDir, 'teacher-archive-page-5.png'), fullPage: true });

    const originalNodeId = original.session?.lessonState?.activeNodeId;
    const originalPageIndex = Number(original.session?.lessonState?.playback?.actionIndex ?? 0);
    if (originalNodeId && nodeTitles[originalNodeId]) {
      await selectTeacherNode(page, originalNodeId);
      for (let index = 0; index < originalPageIndex; index += 1) {
        const next = page.locator('[data-session-action="next-teaching-page"]');
        if (!await next.isEnabled()) break;
        await next.click();
        await page.waitForFunction(
          (expected) => document.querySelector('.teacher-console')?.getAttribute('data-teaching-page') === expected,
          teachingPageId(originalNodeId, index + 1),
        );
      }
    }
    return { onlineLabel, indoorBoundary, archive, restoredNodeId: originalNodeId, restoredPageIndex: originalPageIndex };
  } finally {
    await page.close();
  }
}

async function visitNodePages(page, nodeId, expectedCount) {
  await selectTeacherNode(page, nodeId);
  const pages = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const root = page.locator('.teacher-console');
    const pageId = await root.getAttribute('data-teaching-page');
    const title = await root.locator('.shared-classroom-scene h1').innerText();
    assert(pageId === teachingPageId(nodeId, index), `${nodeId} page ${index + 1} mismatch: ${pageId}`);
    pages.push({ pageId, title });
    if (index < expectedCount - 1) {
      const next = page.locator('[data-session-action="next-teaching-page"]');
      assert(await next.isEnabled(), `${nodeId} next page disabled at ${index + 1}`);
      await next.click();
      await page.waitForFunction(
        (expected) => document.querySelector('.teacher-console')?.getAttribute('data-teaching-page') === expected,
        teachingPageId(nodeId, index + 1),
        { timeout: 20_000 },
      );
    }
  }
  assert(new Set(pages.map(({ title }) => title)).size === expectedCount, `${nodeId} repeats teaching page titles`);
  return pages;
}

async function selectTeacherNode(page, nodeId) {
  const button = page.locator('.scene-slide-rail button').filter({ hasText: nodeTitles[nodeId] }).first();
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  assert(await button.isEnabled(), `${nodeId} teacher node button is disabled`);
  await button.click();
  await page.waitForFunction(
    (expected) => document.querySelector('.teacher-console')?.getAttribute('data-teaching-page') === expected,
    teachingPageId(nodeId, 0),
    { timeout: 20_000 },
  );
}

async function auditStudentGate(context, username) {
  const page = await context.newPage();
  observe(page, username);
  try {
    await page.goto(url('/learn/P1T1-N01'), { waitUntil: 'networkidle' });
    const archive = page.locator('[data-node-id="P1T1-N04"]');
    await archive.waitFor({ state: 'visible', timeout: 20_000 });
    assert(await archive.isEnabled(), 'locked archive entry is not navigable');
    await archive.click();
    await page.waitForURL(/\/learn\/P1T1-N04$/, { timeout: 20_000 });
    const gate = page.locator('[data-node-route-state="locked"]');
    await gate.waitFor({ state: 'visible', timeout: 20_000 });
    assert(await gate.locator('a[href="/learn/P1T1-N03"]').count() === 1, 'archive gate does not expose its prerequisite');
    assert(await page.locator('.learning-scene, [data-image2-learning-stage]').count() === 0, 'locked archive loaded learning content');
    await page.screenshot({ path: path.join(outDir, 'student-archive-prerequisite.png'), fullPage: true });
    return { username, route: new URL(page.url()).pathname, routeState: await gate.getAttribute('data-node-route-state') };
  } finally {
    await page.close();
  }
}

async function firstStudentWithLockedArchive() {
  for (const username of ['student01', 'student02', 'student03']) {
    const context = await loginContext(username, { width: 1440, height: 900 });
    const snapshot = await apiJson(await context.request.get(url('/api/learning/me')), `${username} learning snapshot`);
    const archive = snapshot.nodes?.find(({ nodeId }) => nodeId === 'P1T1-N04');
    if (archive?.state === 'locked') return { context, username };
    await context.close();
  }
  throw new Error('No demo student has a locked P1T1-N04 route for the navigation audit.');
}

async function loginContext(username, viewport) {
  const context = await browser.newContext({ viewport });
  const response = await context.request.post(url('/api/auth/login'), { data: { username, password } });
  assert(response.ok(), `login failed for ${username}: ${response.status()}`);
  return context;
}

function observe(page, role) {
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ role, type: 'console', message: message.text() });
  });
  page.on('pageerror', (error) => report.errors.push({ role, type: 'pageerror', message: String(error?.message ?? error) }));
  page.on('response', (response) => {
    if (response.status() >= 400) report.errors.push({ role, type: 'http', status: response.status(), url: response.url() });
  });
}

async function apiJson(response, label) {
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `${label} failed: ${response.status()} ${String(body.error ?? '')}`.trim());
  return body;
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function teachingPageId(nodeId, zeroBasedIndex) {
  if (nodeId !== 'P1T1-N02') return `${nodeId}-S${String(zeroBasedIndex + 1).padStart(2, '0')}`;
  const lesson = zeroBasedIndex < 6 ? 1 : 2;
  const page = zeroBasedIndex % 6 + 1;
  return `P01-L${lesson}-P${String(page).padStart(2, '0')}`;
}

function normalizeBaseUrl(value) {
  const normalized = value.endsWith('/') ? value : `${value}/`;
  return new URL(normalized).toString();
}

function url(route) {
  return new URL(route, baseUrl).toString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
