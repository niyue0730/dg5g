import { NextResponse } from 'next/server';
import { readDemoAudienceOrigins } from '@/features/demo-control/demo-control-origins';
import { demoStepAddress } from '@/features/demo-control/demo-control-model';
import { DemoLaunchService } from '@/platform/auth/demo-launch-service';
import { resolveTrustedDemoRequestOrigin } from '@/platform/auth/demo-request-origin';
import { safeNextForRole } from '@/platform/auth/redirects';
import { readActorFromRequest } from '@/platform/auth/server-actor';
import { getDatabase } from '@/platform/db/database';
import { DEMO_CLASS_ID, DEMO_TEACHER_ID } from '@/platform/db/demo-seed';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const actor = readActorFromRequest(request);
  if (!actor) return json({ error: 'Authentication required' }, 401);
  if (
    actor.role !== 'teacher'
    || actor.userId !== DEMO_TEACHER_ID
    || actor.classId !== DEMO_CLASS_ID
  ) {
    return json({ error: 'Demo teacher role required' }, 403);
  }

  const requestOrigin = resolveTrustedDemoRequestOrigin(request);
  if (!requestOrigin) {
    return json({ error: 'Cross-origin launch request rejected' }, 403);
  }

  const body = await readBody(request);
  if (!body) return json({ error: 'Invalid demo launch request' }, 400);
  if (safeNextForRole(body.returnPath, 'student') !== body.returnPath) {
    return json({ error: 'Invalid student return path' }, 400);
  }

  try {
    const targetAddress = demoStepAddress(
      { audience: 'student03', route: body.returnPath },
      requestOrigin,
      readDemoAudienceOrigins(),
    );
    const targetOrigin = new URL(targetAddress).origin;
    const launch = new DemoLaunchService(getDatabase()).issue({
      issuedByUserId: actor.userId,
      targetUsername: 'student03',
      targetOrigin,
      returnPath: body.returnPath,
    });
    const launchUrl = new URL('/api/demo/launch/redeem', targetOrigin);
    launchUrl.searchParams.set('ticket', launch.token);
    return json({
      launchUrl: launchUrl.toString(),
      expiresAt: launch.expiresAt.toISOString(),
    }, 201);
  } catch {
    return json({ error: 'Demo launch service unavailable' }, 503);
  }
}

async function readBody(request: Request): Promise<{
  audience: 'student03';
  returnPath: string;
} | null> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || Array.isArray(body) || typeof body !== 'object') return null;
    if (
      Object.keys(body).sort().join(',') !== 'audience,returnPath'
      || body.audience !== 'student03'
      || typeof body.returnPath !== 'string'
    ) {
      return null;
    }
    return { audience: 'student03', returnPath: body.returnPath };
  } catch {
    return null;
  }
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
