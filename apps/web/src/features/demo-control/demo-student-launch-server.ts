import { DemoLaunchService } from '@/platform/auth/demo-launch-service';
import { resolveTrustedDemoRequestOrigin } from '@/platform/auth/demo-request-origin';
import { safeNextForRole } from '@/platform/auth/redirects';
import { readActorFromRequest } from '@/platform/auth/server-actor';
import { getDatabase } from '@/platform/db/database';
import { DEMO_CLASS_ID, DEMO_TEACHER_ID } from '@/platform/db/demo-seed';
import { readDemoAudienceOrigins } from './demo-control-origins';
import { demoStepAddress } from './demo-control-model';

export type DemoStudentLaunchResult = {
  ok: true;
  launchUrl: string;
  expiresAt: Date;
} | {
  ok: false;
  status: number;
  error: string;
};

export function issueDemoStudentLaunch(
  request: Request,
  returnPath: string,
): DemoStudentLaunchResult {
  const actor = readActorFromRequest(request);
  if (!actor) return failure(401, 'Authentication required');
  if (
    actor.role !== 'teacher'
    || actor.userId !== DEMO_TEACHER_ID
    || actor.classId !== DEMO_CLASS_ID
  ) {
    return failure(403, 'Demo teacher role required');
  }

  const requestOrigin = resolveTrustedDemoRequestOrigin(request);
  if (!requestOrigin) {
    return failure(403, 'Cross-origin launch request rejected');
  }
  if (safeNextForRole(returnPath, 'student') !== returnPath) {
    return failure(400, 'Invalid student return path');
  }

  try {
    const targetAddress = demoStepAddress(
      { audience: 'student03', route: returnPath },
      requestOrigin,
      readDemoAudienceOrigins(),
    );
    const targetOrigin = new URL(targetAddress).origin;
    const launch = new DemoLaunchService(getDatabase()).issue({
      issuedByUserId: actor.userId,
      targetUsername: 'student03',
      targetOrigin,
      returnPath,
    });
    const launchUrl = new URL('/api/demo/launch/redeem', targetOrigin);
    launchUrl.searchParams.set('ticket', launch.token);
    return {
      ok: true,
      launchUrl: launchUrl.toString(),
      expiresAt: launch.expiresAt,
    };
  } catch {
    return failure(503, 'Demo launch service unavailable');
  }
}

function failure(status: number, error: string): DemoStudentLaunchResult {
  return { ok: false, status, error };
}
