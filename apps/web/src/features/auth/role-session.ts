import type { PublicActor } from '../../platform/auth/actor.ts';
import { roleHomes } from '../../platform/auth/redirects.ts';

export type WebRole = 'student' | 'teacher';

export interface DemoIdentity {
  role: WebRole;
  account: string;
  displayName: string;
  studentId?: string;
}

export interface DemoAccountShortcut {
  username: string;
  label: string;
  role: WebRole;
}

export const demoAccountShortcuts: readonly DemoAccountShortcut[] = [
  { username: 'teacher01', label: '张老师', role: 'teacher' },
  { username: 'student01', label: '学生一 · 从零学习', role: 'student' },
  { username: 'student02', label: '学生二 · 退回修订', role: 'student' },
  { username: 'student03', label: '学生三 · 完整演示', role: 'student' },
] as const;

export const roleHome = roleHomes;

export const roleLabel: Record<WebRole, string> = {
  student: '学生',
  teacher: '教师',
};

let cachedActor: PublicActor | null = null;

export async function fetchCurrentActor(signal?: AbortSignal): Promise<PublicActor | null> {
  try {
    const response = await fetch('/api/auth/me', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    if (!response.ok) {
      cachedActor = null;
      return null;
    }
    const payload = await response.json() as { actor?: unknown };
    cachedActor = parsePublicActor(payload.actor);
    return cachedActor;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    cachedActor = null;
    return null;
  }
}

export async function logoutCurrentActor(): Promise<void> {
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Logout failed: ${response.status}`);
  } finally {
    cachedActor = null;
  }
}

/**
 * Presentation-only compatibility for older scene components. The value is
 * populated exclusively from `/api/auth/me`; it is never authorization state.
 */
export function readDemoIdentity(): DemoIdentity | null {
  if (!cachedActor) return null;
  return {
    role: cachedActor.role,
    account: cachedActor.username,
    displayName: cachedActor.displayName,
    ...(cachedActor.role === 'student' ? { studentId: cachedActor.userId } : {}),
  };
}

function parsePublicActor(value: unknown): PublicActor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const actor = value as Record<string, unknown>;
  if (
    typeof actor.userId !== 'string'
    || typeof actor.username !== 'string'
    || typeof actor.displayName !== 'string'
    || (actor.role !== 'student' && actor.role !== 'teacher')
  ) {
    return null;
  }
  return {
    userId: actor.userId,
    username: actor.username,
    displayName: actor.displayName,
    role: actor.role,
  };
}
