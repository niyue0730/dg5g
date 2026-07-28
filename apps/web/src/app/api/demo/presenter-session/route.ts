import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  serializeSessionCookie,
  sessionCookieOptions,
} from '@/platform/auth/cookie';
import { issueDemoPresenterSession } from '@/platform/auth/demo-presenter-session';
import { resolveTrustedDemoRequestOrigin } from '@/platform/auth/demo-request-origin';
import { getDatabase } from '@/platform/db/database';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestOrigin = resolveTrustedDemoRequestOrigin(request);
  if (!requestOrigin) {
    return json({ error: 'Cross-origin demo start rejected' }, 403);
  }

  const body = await readBody(request);
  if (!body || !presenterAccessAllowed(new URL(requestOrigin), body.key)) {
    return json({ error: 'Demo start unavailable' }, 404);
  }

  try {
    const session = issueDemoPresenterSession(getDatabase());
    const response = json({ home: '/teacher/demo-control' }, 200);
    response.headers.set(
      'Set-Cookie',
      serializeSessionCookie(
        session.token,
        sessionCookieOptions(request),
      ),
    );
    return response;
  } catch {
    return json({ error: 'Demo start unavailable' }, 503);
  }
}

async function readBody(request: Request): Promise<{ key?: string } | null> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || Array.isArray(body) || typeof body !== 'object') return null;
    const keys = Object.keys(body);
    if (keys.some((key) => key !== 'key') || typeof body.key === 'number') return null;
    if (body.key !== undefined && typeof body.key !== 'string') return null;
    return typeof body.key === 'string' ? { key: body.key } : {};
  } catch {
    return null;
  }
}

function presenterAccessAllowed(url: URL, suppliedKey?: string): boolean {
  if (isLoopback(url.hostname)) return suppliedKey === undefined || suppliedKey.length === 0;
  if (process.env.DGBOOK_DEMO_AUTO_LOGIN !== '1') return false;
  const expected = process.env.DGBOOK_DEMO_PRESENTER_KEY?.trim();
  if (!expected || expected.length < 32 || !suppliedKey) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(suppliedKey, 'utf8');
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
