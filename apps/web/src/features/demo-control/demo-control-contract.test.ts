import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const client = readFileSync(new URL('./demo-control-client.tsx', import.meta.url), 'utf8');
const startClient = readFileSync(new URL('./demo-start-client.tsx', import.meta.url), 'utf8');
const startPage = readFileSync(new URL('../../app/demo/start/page.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../app/teacher/demo-control/page.tsx', import.meta.url), 'utf8');

test('hidden demo control is teacher-authorized and absent from product navigation', () => {
  assert.match(page, /readServerActor\(\)/);
  assert.match(page, /redirect\('\/demo\/start'\)/);
  assert.match(page, /actor\.role !== 'teacher'/);
  assert.match(page, /readTeacherWorkbenchSnapshot/);
  assert.doesNotMatch(`${client}\n${startClient}\n${page}`, /password|123456|studentId=/);
  assert.match(client, /不进入业务导航/);
});

test('demo control reuses authoritative reset and lesson protocols', () => {
  assert.match(client, /\/api\/demo\/reset/);
  assert.match(client, /RESET_THREE_DEMO_STUDENTS/);
  assert.match(client, /\/api\/class-sessions\/\$\{encodeURIComponent\(sessionId\)\}\/lesson/);
  assert.match(client, /expectedRevision: current\.revision/);
  assert.match(client, /response\.status === 409/);
  assert.match(client, /await readClassroom\(sessionId\)/);
});

test('student steps open in a reusable isolated role window', () => {
  assert.match(client, /resolveStepTarget\(step, window\.location\.origin, audienceOrigins\)/);
  assert.match(client, /demoWindowName\(step\.audience\)/);
  assert.match(client, /打开学生窗口/);
  assert.match(client, /checkRoleWindows\(window\.location\.origin, audienceOrigins\)/);
  assert.match(client, /教师\/学生已隔离/);
  assert.match(client, /navigator\.clipboard\.writeText/);
});

test('demo control receives server-validated public role origins', () => {
  assert.match(page, /readDemoAudienceOrigins/);
  assert.match(page, /audienceOrigins=\{audienceOrigins\}/);
});

test('one click performs one native navigation through the student launch route', () => {
  assert.match(client, /window\.open\(address, windowName\)/);
  assert.match(client, /\/api\/demo\/launch\/student03/);
  assert.match(client, /launchUrl\.searchParams\.set\('returnPath', returnPath\)/);
  assert.match(client, /launchUrl\.searchParams\.set\('sourceOrigin', currentOrigin\)/);
  assert.doesNotMatch(client, /roleWindow\.location\.(?:href|replace)/);
  assert.doesNotMatch(client, /window\.open\('(?:about:blank)?', windowName\)/);
  assert.doesNotMatch(client, /\/api\/demo\/launch-ticket/);
  assert.match(client, /学生三窗口已自动登录并进入当前阶段/);
});

test('demo start exchanges a stripped launch key for a teacher session', () => {
  assert.match(startPage, /dynamic = 'force-dynamic'/);
  assert.match(startPage, /revalidate = 0/);
  assert.match(startClient, /location\.hash\.slice\(1\)/);
  assert.match(startClient, /URLSearchParams\(location\.search\)\.get\('k'\)/);
  assert.match(startClient, /searchParams\.delete\('k'\)/);
  assert.match(startClient, /window\.history\.replaceState/);
  assert.match(startClient, /\/api\/demo\/presenter-session/);
  assert.match(startClient, /window\.location\.replace\(body\.home\)/);
  assert.doesNotMatch(startClient, /localStorage|sessionStorage|document\.cookie/);
});
