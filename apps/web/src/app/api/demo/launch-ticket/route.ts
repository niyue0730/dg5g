import { NextResponse } from 'next/server';
import { issueDemoStudentLaunch } from '@/features/demo-control/demo-student-launch-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return json({ error: 'Invalid demo launch request' }, 400);
  const launch = issueDemoStudentLaunch(request, body.returnPath);
  if (!launch.ok) return json({ error: launch.error }, launch.status);
  return json({
    launchUrl: launch.launchUrl,
    expiresAt: launch.expiresAt.toISOString(),
  }, 201);
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
