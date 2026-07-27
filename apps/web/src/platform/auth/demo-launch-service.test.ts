import assert from 'node:assert/strict';
import test from 'node:test';
import { seedDemo } from '../db/demo-seed.ts';
import { migrateDatabase } from '../db/migrations.ts';
import { createTestDatabase } from '../db/test-database.ts';
import {
  DEMO_LAUNCH_TTL_SECONDS,
  DemoLaunchService,
} from './demo-launch-service.ts';
import { DEFAULT_SESSION_TTL_SECONDS } from './auth-service.ts';

const token = Buffer.alloc(32, 7).toString('base64url');

test('one teacher ticket creates one student03 session for the bound origin and path', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    const now = new Date('2026-07-27T08:00:00.000Z');
    const service = new DemoLaunchService(fixture.database, {
      now: () => now,
      randomToken: () => token,
    });
    const issued = service.issue({
      issuedByUserId: 'teacher-01',
      targetUsername: 'student03',
      targetOrigin: 'https://student.demo.example.com',
      returnPath: '/student/projects/p1',
    });
    assert.equal(issued.token, token);
    assert.equal(
      issued.expiresAt.toISOString(),
      new Date(now.getTime() + DEMO_LAUNCH_TTL_SECONDS * 1_000).toISOString(),
    );

    const redeemed = service.redeem({
      token,
      targetOrigin: 'https://student.demo.example.com',
    });
    assert.equal(redeemed?.actor.username, 'student03');
    assert.equal(redeemed?.actor.role, 'student');
    assert.equal(redeemed?.returnPath, '/student/projects/p1');
    assert.equal(
      redeemed?.sessionExpiresAt.toISOString(),
      new Date(now.getTime() + DEFAULT_SESSION_TTL_SECONDS * 1_000).toISOString(),
    );
    assert.equal(service.redeem({
      token,
      targetOrigin: 'https://student.demo.example.com',
    }), null);
  } finally {
    fixture.cleanup();
  }
});

test('demo launch rejects wrong origins, expired tickets and cross-role paths', () => {
  const fixture = createTestDatabase();
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    let now = new Date('2026-07-27T08:00:00.000Z');
    const service = new DemoLaunchService(fixture.database, {
      now: () => now,
      randomToken: () => token,
    });
    assert.throws(() => service.issue({
      issuedByUserId: 'teacher-01',
      targetUsername: 'student03',
      targetOrigin: 'https://student.demo.example.com',
      returnPath: '/teacher/workbench',
    }), /return path is invalid/i);
    service.issue({
      issuedByUserId: 'teacher-01',
      targetUsername: 'student03',
      targetOrigin: 'https://student.demo.example.com',
      returnPath: '/student/home',
    });
    assert.equal(service.redeem({
      token,
      targetOrigin: 'https://teacher.demo.example.com',
    }), null);
    now = new Date('2026-07-27T08:01:01.000Z');
    assert.equal(service.redeem({
      token,
      targetOrigin: 'https://student.demo.example.com',
    }), null);
  } finally {
    fixture.cleanup();
  }
});
