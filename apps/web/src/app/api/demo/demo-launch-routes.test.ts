import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  AuthService,
  DEFAULT_SESSION_TTL_SECONDS,
} from '../../../platform/auth/auth-service.ts';
import { AUTH_COOKIE_NAME } from '../../../platform/auth/cookie.ts';
import { closeDatabase } from '../../../platform/db/database.ts';
import { seedDemo } from '../../../platform/db/demo-seed.ts';
import { migrateDatabase } from '../../../platform/db/migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../../platform/db/test-database.ts';
import { POST as issueLaunch } from './launch-ticket/route.ts';
import { GET as redeemLaunch } from './launch/redeem/route.ts';
import { POST as startPresenter } from './presenter-session/route.ts';

let fixture: TestDatabase;

before(() => {
  fixture = createTestDatabase();
  migrateDatabase(fixture.database);
  seedDemo(fixture.database);
  process.env.DGBOOK_SQLITE_PATH = fixture.databasePath;
  delete process.env.DGBOOK_DEMO_STUDENT_ORIGIN;
  closeDatabase();
});

after(() => {
  closeDatabase();
  delete process.env.DGBOOK_SQLITE_PATH;
  fixture.cleanup();
});

test('teacher opens a one-use localhost student launch without exposing credentials', async () => {
  const teacher = new AuthService(fixture.database).login({
    username: 'teacher01',
    password: '123456',
  });
  assert.ok(teacher);
  const response = await issueLaunch(new Request('http://127.0.0.1:3157/api/demo/launch-ticket', {
    method: 'POST',
    headers: {
      cookie: `${AUTH_COOKIE_NAME}=${teacher.token}`,
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3157',
    },
    body: JSON.stringify({
      audience: 'student03',
      returnPath: '/student/projects/p1',
    }),
  }));
  assert.equal(response.status, 201);
  const payload = await response.json() as {
    launchUrl: string;
    expiresAt: string;
  };
  assert.match(payload.launchUrl, /^http:\/\/localhost:3157\/api\/demo\/launch\/redeem\?ticket=/);
  assert.equal(/password|123456|student03/i.test(payload.launchUrl), false);
  assert.ok(Number.isFinite(Date.parse(payload.expiresAt)));

  const redeemed = await redeemLaunch(new Request(payload.launchUrl));
  assert.equal(redeemed.status, 303);
  assert.equal(redeemed.headers.get('location'), 'http://localhost:3157/student/projects/p1');
  assert.match(redeemed.headers.get('set-cookie') ?? '', new RegExp(`^${AUTH_COOKIE_NAME}=`));
  assert.match(redeemed.headers.get('set-cookie') ?? '', /HttpOnly/i);
  assert.match(
    redeemed.headers.get('set-cookie') ?? '',
    new RegExp(`Max-Age=${DEFAULT_SESSION_TTL_SECONDS}`),
  );
  assert.match(redeemed.headers.get('referrer-policy') ?? '', /no-referrer/i);

  const sessionToken = (redeemed.headers.get('set-cookie') ?? '')
    .split(';', 1)[0]
    ?.split('=', 2)[1];
  assert.equal(
    new AuthService(fixture.database).readActor(sessionToken)?.username,
    'student03',
  );
  assert.equal((await redeemLaunch(new Request(payload.launchUrl))).status, 410);
});

test('launch issuance rejects non-teachers, cross-origin calls and authority fields', async () => {
  const student = new AuthService(fixture.database).login({
    username: 'student01',
    password: '123456',
  });
  const teacher = new AuthService(fixture.database).login({
    username: 'teacher01',
    password: '123456',
  });
  assert.ok(student);
  assert.ok(teacher);

  const body = JSON.stringify({ audience: 'student03', returnPath: '/student/home' });
  const studentResponse = await issueLaunch(new Request('http://127.0.0.1:3157/api/demo/launch-ticket', {
    method: 'POST',
    headers: {
      cookie: `${AUTH_COOKIE_NAME}=${student.token}`,
      'content-type': 'application/json',
    },
    body,
  }));
  assert.equal(studentResponse.status, 403);

  const crossOrigin = await issueLaunch(new Request('http://127.0.0.1:3157/api/demo/launch-ticket', {
    method: 'POST',
    headers: {
      cookie: `${AUTH_COOKIE_NAME}=${teacher.token}`,
      'content-type': 'application/json',
      origin: 'https://evil.example',
    },
    body,
  }));
  assert.equal(crossOrigin.status, 403);

  const authorityField = await issueLaunch(new Request('http://127.0.0.1:3157/api/demo/launch-ticket', {
    method: 'POST',
    headers: {
      cookie: `${AUTH_COOKIE_NAME}=${teacher.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audience: 'student03',
      returnPath: '/student/home',
      targetUsername: 'teacher01',
    }),
  }));
  assert.equal(authorityField.status, 400);
});

test('loopback demo start creates an eight-hour teacher01 session without a password', async () => {
  const response = await startPresenter(new Request(
    'http://localhost:3157/api/demo/presenter-session',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3157',
      },
      body: '{}',
    },
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { home: '/teacher/demo-control' });
  const cookie = response.headers.get('set-cookie') ?? '';
  assert.match(cookie, new RegExp(`^${AUTH_COOKIE_NAME}=`));
  assert.match(cookie, new RegExp(`Max-Age=${DEFAULT_SESSION_TTL_SECONDS}`));
  assert.doesNotMatch(cookie, /Secure/i);

  const sessionToken = cookie.split(';', 1)[0]?.split('=', 2)[1];
  assert.equal(
    new AuthService(fixture.database).readActor(sessionToken)?.username,
    'teacher01',
  );
});

test('public demo start requires the enabled private presenter key and same origin', async () => {
  const previousEnabled = process.env.DGBOOK_DEMO_AUTO_LOGIN;
  const previousKey = process.env.DGBOOK_DEMO_PRESENTER_KEY;
  const key = 'public-demo-presenter-key-32-chars-minimum';
  try {
    process.env.DGBOOK_DEMO_AUTO_LOGIN = '1';
    process.env.DGBOOK_DEMO_PRESENTER_KEY = key;

    const accepted = await startPresenter(new Request(
      'https://teacher.demo.example.com/api/demo/presenter-session',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://teacher.demo.example.com',
        },
        body: JSON.stringify({ key }),
      },
    ));
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get('set-cookie') ?? '', /Secure/i);
    assert.match(
      accepted.headers.get('set-cookie') ?? '',
      new RegExp(`Max-Age=${DEFAULT_SESSION_TTL_SECONDS}`),
    );

    const wrongKey = await startPresenter(new Request(
      'https://teacher.demo.example.com/api/demo/presenter-session',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://teacher.demo.example.com',
        },
        body: JSON.stringify({ key: `${key}-wrong` }),
      },
    ));
    assert.equal(wrongKey.status, 404);

    const crossOrigin = await startPresenter(new Request(
      'https://teacher.demo.example.com/api/demo/presenter-session',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example',
        },
        body: JSON.stringify({ key }),
      },
    ));
    assert.equal(crossOrigin.status, 403);
  } finally {
    if (previousEnabled === undefined) delete process.env.DGBOOK_DEMO_AUTO_LOGIN;
    else process.env.DGBOOK_DEMO_AUTO_LOGIN = previousEnabled;
    if (previousKey === undefined) delete process.env.DGBOOK_DEMO_PRESENTER_KEY;
    else process.env.DGBOOK_DEMO_PRESENTER_KEY = previousKey;
  }
});
