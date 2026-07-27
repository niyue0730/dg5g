import assert from 'node:assert/strict';
import test from 'node:test';
import {
  demoAudienceLabel,
  demoControlSteps,
  demoStepAddress,
  demoStepOrigin,
  demoTotalDurationSeconds,
  demoWindowName,
} from './demo-control-model.ts';

test('demo control defines one bounded nine-step narrative over real product routes', () => {
  assert.equal(demoControlSteps.length, 9);
  assert.deepEqual(demoControlSteps.map(({ order }) => order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(new Set(demoControlSteps.map(({ id }) => id)).size, 9);
  assert.equal(new Set(demoControlSteps.map(({ route }) => route)).size, 9);
  assert.equal(demoTotalDurationSeconds, 570);
  assert.ok(demoTotalDurationSeconds <= 600);
  assert.deepEqual(
    demoControlSteps.map(({ route }) => route),
    [
      '/platform',
      '/student/home',
      '/student/projects/p1',
      '/course',
      '/learn/P1T1-N02',
      '/teacher/sessions/demo-class',
      '/present/demo-class',
      '/classroom/demo-class',
      '/student/projects/p1/portfolio',
    ],
  );
});

test('classroom demonstration steps prepare the same golden capability node', () => {
  const prepared = demoControlSteps.filter(({ prepareNodeId }) => prepareNodeId);
  assert.ok(prepared.length >= 5);
  assert.deepEqual(new Set(prepared.map(({ prepareNodeId }) => prepareNodeId)), new Set(['P1T1-N02']));
  assert.equal(demoControlSteps.find(({ id }) => id === 'teacher')?.audience, 'teacher');
  assert.equal(demoControlSteps.find(({ id }) => id === 'student-follow')?.audience, 'student03');
  assert.equal(demoAudienceLabel('projector'), '投屏窗口');
});

test('student steps use one isolated loopback origin and reusable role window', () => {
  const studentStep = demoControlSteps.find(({ id }) => id === 'student-home')!;
  const teacherStep = demoControlSteps.find(({ id }) => id === 'teacher')!;
  assert.equal(
    demoStepAddress(studentStep, 'http://127.0.0.1:3157'),
    'http://localhost:3157/student/home',
  );
  assert.equal(
    demoStepAddress(studentStep, 'http://localhost:3157'),
    'http://127.0.0.1:3157/student/home',
  );
  assert.equal(
    demoStepAddress(teacherStep, 'http://127.0.0.1:3157'),
    'http://127.0.0.1:3157/teacher/sessions/demo-class',
  );
  assert.equal(demoWindowName('student03'), 'dgbook-student03-demo');
  assert.equal(demoWindowName('projector'), 'dgbook-projector-demo');
});

test('public deployment uses configured role origins and rejects a shared student hostname', () => {
  const studentStep = demoControlSteps.find(({ id }) => id === 'student-home')!;
  const projectorStep = demoControlSteps.find(({ id }) => id === 'projector')!;
  const origins = {
    student03: 'https://student.demo.example.com',
    projector: 'https://screen.demo.example.com',
  };
  assert.equal(
    demoStepAddress(studentStep, 'https://teacher.demo.example.com', origins),
    'https://student.demo.example.com/student/home',
  );
  assert.equal(
    demoStepOrigin(projectorStep, 'https://teacher.demo.example.com', origins),
    'https://screen.demo.example.com',
  );
  assert.throws(
    () => demoStepAddress(studentStep, 'https://demo.example.com'),
    /必须配置独立的学生端域名/,
  );
  assert.throws(
    () => demoStepAddress(studentStep, 'https://demo.example.com', {
      student03: 'https://demo.example.com:444',
    }),
    /必须使用不同主机名/,
  );
});
