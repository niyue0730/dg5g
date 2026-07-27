import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const client = readFileSync(new URL('./demo-control-client.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../app/teacher/demo-control/page.tsx', import.meta.url), 'utf8');

test('hidden demo control is teacher-authorized and absent from product navigation', () => {
  assert.match(page, /requireClassRole\('teacher'\)/);
  assert.match(page, /readTeacherWorkbenchSnapshot/);
  assert.doesNotMatch(client, /password|123456|studentId=/);
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
