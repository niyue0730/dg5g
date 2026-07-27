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

test('student steps copy a real route instead of opening under the teacher cookie', () => {
  assert.match(client, /const canOpenHere = step\.audience !== 'student03'/);
  assert.match(client, /navigator\.clipboard\.writeText/);
  assert.match(client, /请在student03窗口打开/);
});
