import assert from 'node:assert/strict';
import test from 'node:test';
import { readDemoAudienceOrigins, validateDemoOrigin } from './demo-control-origins.ts';

test('demo audience origins accept HTTPS public hosts and HTTP loopback hosts', () => {
  assert.equal(
    validateDemoOrigin('DGBOOK_DEMO_STUDENT_ORIGIN', 'https://student.demo.example.com'),
    'https://student.demo.example.com',
  );
  assert.equal(
    validateDemoOrigin('DGBOOK_DEMO_STUDENT_ORIGIN', 'http://localhost:3157'),
    'http://localhost:3157',
  );
  assert.deepEqual(
    readDemoAudienceOrigins({
      DGBOOK_DEMO_TEACHER_ORIGIN: 'https://teacher.demo.example.com',
      DGBOOK_DEMO_STUDENT_ORIGIN: 'https://student.demo.example.com',
      DGBOOK_DEMO_PROJECTOR_ORIGIN: 'https://screen.demo.example.com',
    }),
    {
      teacher: 'https://teacher.demo.example.com',
      student03: 'https://student.demo.example.com',
      projector: 'https://screen.demo.example.com',
    },
  );
});

test('demo audience origins reject unsafe or path-bearing public URLs', () => {
  assert.throws(
    () => validateDemoOrigin('DGBOOK_DEMO_STUDENT_ORIGIN', 'http://student.demo.example.com'),
    /必须使用HTTPS/,
  );
  assert.throws(
    () => validateDemoOrigin('DGBOOK_DEMO_STUDENT_ORIGIN', 'https://student.demo.example.com/login'),
    /只能配置协议、主机名和端口/,
  );
  assert.throws(
    () => validateDemoOrigin('DGBOOK_DEMO_STUDENT_ORIGIN', 'student.demo.example.com'),
    /必须是完整URL/,
  );
});
