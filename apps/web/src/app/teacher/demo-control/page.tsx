import type { Metadata } from 'next';
import { DemoControlClient } from '../../../features/demo-control/demo-control-client.tsx';
import { readTeacherWorkbenchSnapshot } from '../../../features/home/role-home-read-model.ts';
import { requireClassRole } from '../../../platform/auth/server-actor.ts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '内部演示控制台 · DGBook' };

export default async function DemoControlPage() {
  const actor = await requireClassRole('teacher');
  const snapshot = readTeacherWorkbenchSnapshot(actor);
  return (
    <DemoControlClient
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
