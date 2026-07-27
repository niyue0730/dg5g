import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { demoAccountShortcuts, roleHome } from './role-session.ts';

test('offers exactly the four seeded usernames without embedding shortcut passwords', () => {
  assert.deepEqual(
    demoAccountShortcuts.map(({ username, role }) => [username, role]),
    [
      ['teacher01', 'teacher'],
      ['student01', 'student'],
      ['student02', 'student'],
      ['student03', 'student'],
    ],
  );
  assert.equal(demoAccountShortcuts.some((shortcut) => 'password' in shortcut), false);
  assert.deepEqual(roleHome, {
    student: '/student/home',
    teacher: '/teacher/workbench',
  });
});

test('login and role gates use server auth and contain no browser-trusted identity path', () => {
  const roleSession = source('./role-session.ts');
  const loginPage = source('./login-page.tsx');
  const roleGate = source('./role-gate.tsx');
  const rootPage = source('../../app/page.tsx');
  const courseOverview = source('../textbook-scene/course-overview.tsx');
  const nextConfig = source('../../../next.config.mjs');

  for (const [name, value] of Object.entries({ roleSession, loginPage, roleGate, rootPage })) {
    assert.doesNotMatch(value, /localStorage|sessionStorage|x-dgbook-class-role|[?&]role=/, name);
  }
  assert.match(loginPage, /\/api\/auth\/login/);
  assert.doesNotMatch(loginPage, /writeDemoIdentity|demoIdentityFor/);
  assert.match(roleGate, /fetchCurrentActor/);
  assert.doesNotMatch(roleGate, /readDemoIdentity/);
  assert.match(rootPage, /readServerActor/);
  assert.match(rootPage, /redirect\(/);
  assert.match(courseOverview, /<AccountMenu\s+displayName=\{displayName\}\s+role=\{role\}/);
  assert.doesNotMatch(courseOverview, /readDemoIdentity|logoutCurrentActor|clearDemoIdentity/);
  assert.match(nextConfig, /source: '\/teacher', destination: '\/teacher\/workbench'/);
  assert.doesNotMatch(nextConfig, /destination: '\/\?role=/);
});

test('login explains demo credentials without client-side role or account shortcuts', () => {
  const loginPage = source('./login-page.tsx');

  for (const credential of ['student01', 'student02', 'student03', 'teacher01', '123456']) {
    assert.match(loginPage, new RegExp(credential), `missing demo credential hint: ${credential}`);
  }

  assert.match(loginPage, /data-login-role="gateway"/, 'login remains a server-role gateway');
  assert.doesNotMatch(loginPage, /chooseRole|data-login-role-option|data-login-role=\{/);
  assert.doesNotMatch(loginPage, /demoAccountShortcuts|roleLabel|WebRole/);
  assert.doesNotMatch(loginPage, /body:\s*JSON\.stringify\(\{[\s\S]*?\brole\s*:/);
  assert.match(loginPage, /router\.replace\(payload\.home\)/, 'the server response selects the destination role home');
  assert.match(loginPage, /requestLoginWithRetry/, 'login retries a transient gateway failure once');
  assert.match(loginPage, /\[502, 503, 504\]/, 'only transient gateway failures are retried');
  assert.match(loginPage, /DEFAULT_ACCOUNT = 'student03'/, 'the complete P1 persona is the default demo account');
  assert.match(loginPage, /student03 · P1全部内容与成果/, 'the login surface names the no-exercise showcase account');
});

test('every protected server page authorizes before loading protected data', () => {
  const contracts = [
    {
      name: 'course',
      value: source('../../app/course/page.tsx'),
      guard: /await requireUser\(\)/,
      protectedLoad: /await getCapabilityGraph\(/,
    },
    {
      name: 'student self study',
      value: source('../../app/learn/[nodeId]/page.tsx'),
      guard: /await requireClassRole\(['"]student['"]\)/,
      protectedLoad: /(?:classifyNodeRoute|await getCapabilityGraph)\(/,
    },
    {
      name: 'teacher session',
      value: source('../../app/teacher/sessions/[sessionId]/page.tsx'),
      guard: /await requireClassRole\(['"]teacher['"]\)/,
      protectedLoad: /(?:isActiveDemoSession|await getTeacherSession)\(/,
    },
    {
      name: 'student classroom',
      value: source('../../app/classroom/[sessionId]/page.tsx'),
      guard: /await requireClassRole\(['"]student['"]\)/,
      protectedLoad: /loadStudentFollowPage\(getDatabase\(\), actor, params\.sessionId\)/,
    },
    {
      name: 'projector',
      value: source('../../app/present/[sessionId]/page.tsx'),
      guard: /await requireClassRole\(['"]teacher['"]\)/,
      protectedLoad: /(?:isActiveDemoSession|await getProjectorState)\(/,
    },
  ];

  for (const contract of contracts) {
    const guardIndex = contract.value.search(contract.guard);
    const protectedLoadIndex = contract.value.search(contract.protectedLoad);
    assert.notEqual(guardIndex, -1, `${contract.name} is missing its server guard`);
    assert.notEqual(protectedLoadIndex, -1, `${contract.name} is missing its protected loader`);
    assert.ok(guardIndex < protectedLoadIndex, `${contract.name} loads protected data before authorization`);
  }

  const classroom = source('../../app/classroom/[sessionId]/page.tsx');
  assert.doesNotMatch(classroom, /searchParams|\.student\b/, 'student identity must not come from the URL');
  assert.match(classroom, /actor\.studentId/, 'the classroom page must use the authenticated student identity');
});

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
