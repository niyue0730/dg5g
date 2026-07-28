import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import {
  resolveActorForUser,
  type AuthenticatedActor,
  type AuthenticatedRole,
  type AuthenticatedUserRow,
} from './actor.ts';
import { DEFAULT_SESSION_TTL_SECONDS } from './auth-service.ts';
import { safeNextForRole } from './redirects.ts';
import { SessionRepository } from './session-repository.ts';

export const DEMO_LAUNCH_TTL_SECONDS = 60;
const DEMO_LAUNCH_TOKEN_BYTES = 32;

export interface IssuedDemoLaunch {
  token: string;
  expiresAt: Date;
  targetOrigin: string;
  returnPath: string;
}

export interface RedeemedDemoLaunch {
  actor: AuthenticatedActor;
  sessionToken: string;
  sessionExpiresAt: Date;
  returnPath: string;
}

export interface DemoLaunchServiceOptions {
  now?: () => Date;
  randomToken?: () => string;
}

export class DemoLaunchService {
  private readonly database: AppDatabase;
  private readonly sessions: SessionRepository;
  private readonly now: () => Date;
  private readonly randomToken: () => string;

  constructor(database: AppDatabase, options: DemoLaunchServiceOptions = {}) {
    this.database = database;
    this.sessions = new SessionRepository(database);
    this.now = options.now ?? (() => new Date());
    this.randomToken = options.randomToken
      ?? (() => randomBytes(DEMO_LAUNCH_TOKEN_BYTES).toString('base64url'));
  }

  issue(input: {
    issuedByUserId: string;
    targetUsername: string;
    targetOrigin: string;
    returnPath: string;
  }): IssuedDemoLaunch {
    const now = this.now();
    const targetOrigin = normalizeTargetOrigin(input.targetOrigin);
    const returnPath = normalizeStudentReturnPath(input.returnPath);
    const issuer = this.database.prepare(`
      SELECT role, is_active AS isActive
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(input.issuedByUserId) as { role: AuthenticatedRole; isActive: number } | undefined;
    if (!issuer || issuer.role !== 'teacher' || issuer.isActive !== 1) {
      throw new Error('Only an active teacher can issue a demo launch.');
    }
    const target = this.database.prepare(`
      SELECT id AS userId
      FROM users
      WHERE username = ? COLLATE NOCASE
        AND role = 'student'
        AND is_active = 1
      LIMIT 1
    `).get(input.targetUsername) as { userId: string } | undefined;
    if (!target) throw new Error('Demo launch target is unavailable.');

    const token = this.randomToken();
    if (!isCanonicalLaunchToken(token)) throw new Error('Demo launch token generator returned an invalid token.');
    const expiresAt = new Date(now.getTime() + DEMO_LAUNCH_TTL_SECONDS * 1_000);
    this.database.transaction(() => {
      this.database.prepare(`
        DELETE FROM demo_launch_tickets
        WHERE julianday(expires_at) <= julianday(?)
          OR consumed_at IS NOT NULL
      `).run(now.toISOString());
      this.database.prepare(`
        INSERT INTO demo_launch_tickets (
          id, token_hash, issued_by_user_id, target_user_id,
          target_origin, return_path, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        digestLaunchToken(token),
        input.issuedByUserId,
        target.userId,
        targetOrigin,
        returnPath,
        expiresAt.toISOString(),
        now.toISOString(),
      );
    })();
    return { token, expiresAt, targetOrigin, returnPath };
  }

  redeem(input: { token: string; targetOrigin: string }): RedeemedDemoLaunch | null {
    if (!isCanonicalLaunchToken(input.token)) return null;
    const now = this.now();
    const targetOrigin = normalizeTargetOrigin(input.targetOrigin);

    return this.database.transaction(() => {
      const row = this.database.prepare(`
        SELECT
          demo_launch_tickets.id AS ticketId,
          demo_launch_tickets.return_path AS returnPath,
          users.id AS userId,
          users.username AS username,
          users.display_name AS displayName,
          users.role AS role,
          users.is_active AS isActive
        FROM demo_launch_tickets
        INNER JOIN users ON users.id = demo_launch_tickets.target_user_id
        WHERE demo_launch_tickets.token_hash = ?
          AND demo_launch_tickets.target_origin = ?
          AND demo_launch_tickets.consumed_at IS NULL
          AND julianday(demo_launch_tickets.expires_at) > julianday(?)
        LIMIT 1
      `).get(
        digestLaunchToken(input.token),
        targetOrigin,
        now.toISOString(),
      ) as {
        ticketId: string;
        returnPath: string;
        userId: string;
        username: string;
        displayName: string;
        role: AuthenticatedRole;
        isActive: number;
      } | undefined;
      if (!row || row.role !== 'student' || row.isActive !== 1) return null;

      const consumed = this.database.prepare(`
        UPDATE demo_launch_tickets
        SET consumed_at = ?
        WHERE id = ? AND consumed_at IS NULL
      `).run(now.toISOString(), row.ticketId);
      if (consumed.changes !== 1) return null;

      const user: AuthenticatedUserRow = {
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        isActive: true,
      };
      const actor = resolveActorForUser(this.database, user);
      if (!actor || actor.role !== 'student') throw new Error('Demo launch target has no valid class membership.');
      const sessionExpiresAt = new Date(now.getTime() + DEFAULT_SESSION_TTL_SECONDS * 1_000);
      const session = this.sessions.createSession({
        userId: actor.userId,
        now,
        expiresAt: sessionExpiresAt,
      });
      return {
        actor,
        sessionToken: session.token,
        sessionExpiresAt,
        returnPath: row.returnPath,
      };
    })();
  }
}

function normalizeTargetOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Demo launch target origin is invalid.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Demo launch target must be an origin.');
  }
  const loopback = url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]';
  const allowInsecureHttp = process.env.DGBOOK_DEMO_ALLOW_INSECURE_HTTP === '1';
  const permittedHttp = url.protocol === 'http:' && (loopback || allowInsecureHttp);
  if (url.protocol !== 'https:' && !permittedHttp) {
    throw new Error('Demo launch target must use HTTPS.');
  }
  return url.origin;
}

function normalizeStudentReturnPath(value: string): string {
  const safe = safeNextForRole(value, 'student');
  if (safe !== value) throw new Error('Demo launch return path is invalid.');
  return safe;
}

function digestLaunchToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isCanonicalLaunchToken(token: string): boolean {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const decoded = Buffer.from(token, 'base64url');
  return decoded.byteLength === DEMO_LAUNCH_TOKEN_BYTES && decoded.toString('base64url') === token;
}
