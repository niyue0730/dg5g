import type { AppDatabase } from '../db/database.ts';
import { DEMO_CLASS_ID, DEMO_TEACHER_ID } from '../db/demo-seed.ts';
import {
  resolveActorForUser,
  type AuthenticatedUserRow,
} from './actor.ts';
import { DEFAULT_SESSION_TTL_SECONDS } from './auth-service.ts';
import { SessionRepository } from './session-repository.ts';

export function issueDemoPresenterSession(
  database: AppDatabase,
  now = new Date(),
): {
  token: string;
  expiresAt: Date;
} {
  const row = database.prepare(`
    SELECT
      id AS userId,
      username,
      display_name AS displayName,
      role,
      is_active AS isActive
    FROM users
    WHERE id = ? AND username = 'teacher01' COLLATE NOCASE
    LIMIT 1
  `).get(DEMO_TEACHER_ID) as {
    userId: string;
    username: string;
    displayName: string;
    role: 'teacher' | 'student';
    isActive: number;
  } | undefined;
  if (!row || row.role !== 'teacher' || row.isActive !== 1) {
    throw new Error('Demo presenter account is unavailable.');
  }

  const user: AuthenticatedUserRow = {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isActive: true,
  };
  const actor = resolveActorForUser(database, user);
  if (
    !actor
    || actor.role !== 'teacher'
    || actor.userId !== DEMO_TEACHER_ID
    || actor.classId !== DEMO_CLASS_ID
  ) {
    throw new Error('Demo presenter does not own the demo classroom.');
  }

  const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_TTL_SECONDS * 1_000);
  const session = new SessionRepository(database).createSession({
    userId: actor.userId,
    now,
    expiresAt,
  });
  return { token: session.token, expiresAt };
}
