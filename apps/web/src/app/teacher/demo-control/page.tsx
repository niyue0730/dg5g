import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DemoControlClient } from '../../../features/demo-control/demo-control-client.tsx';
import { readDemoAudienceOrigins } from '../../../features/demo-control/demo-control-origins.ts';
import { readTeacherWorkbenchSnapshot } from '../../../features/home/role-home-read-model.ts';
import { homeForRole } from '../../../platform/auth/redirects.ts';
import { readServerActor } from '../../../platform/auth/server-actor.ts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '内部演示控制台 · DGBook' };

export default async function DemoControlPage() {
  const actor = readServerActor();
  if (!actor) redirect('/demo/start');
  if (actor.role !== 'teacher') redirect(homeForRole(actor.role));
  const snapshot = readTeacherWorkbenchSnapshot(actor);
  const audienceOrigins = readDemoAudienceOrigins();
  return (
    <DemoControlClient
      audienceOrigins={audienceOrigins}
      displayName={actor.displayName}
      initialClassroom={{
        ...(snapshot.lastPosition?.nodeId ? { activeNodeId: snapshot.lastPosition.nodeId } : {}),
        revision: snapshot.classroom.revision,
        sessionStatus: snapshot.classroom.status,
      }}
      sessionId={snapshot.classroom.id}
    />
  );
}
