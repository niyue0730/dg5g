import { NextResponse } from 'next/server';
import { DemoLaunchService } from '@/platform/auth/demo-launch-service';
import {
  serializeSessionCookie,
  sessionCookieOptions,
} from '@/platform/auth/cookie';
import { getDatabase } from '@/platform/db/database';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (
    [...url.searchParams.keys()].some((key) => key !== 'ticket')
    || url.searchParams.getAll('ticket').length !== 1
  ) {
    return failure();
  }
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return failure();

  let launch;
  try {
    launch = new DemoLaunchService(getDatabase()).redeem({
      token: ticket,
      targetOrigin: url.origin,
    });
  } catch {
    return failure();
  }
  if (!launch || launch.actor.username !== 'student03') return failure();

  const response = NextResponse.redirect(
    new URL(launch.returnPath, url.origin),
    303,
  );
  response.headers.set(
    'Set-Cookie',
    serializeSessionCookie(
      launch.sessionToken,
      sessionCookieOptions(request),
    ),
  );
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function failure() {
  return NextResponse.json(
    { error: 'Demo launch ticket is invalid or expired' },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
