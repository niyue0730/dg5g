'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AccountMenu } from '@/features/auth/account-menu';
import type { WebRole } from '@/features/auth/role-session';
import {
  projectGraphSnapshot,
  type GraphSnapshotModel,
} from '@/features/capability-map/graph-snapshot-model';
import type { GraphAuthoritativeSnapshot } from '@/platform/authoritative-snapshot';
import { getNodeLearningPolicy, type P1TaskId } from '@/platform/learning-policy';
import type { GraphData, ResourceCard } from '@/platform/models';
import { Icon } from '@/ui/foundation/icons';
import { startTeacherLesson } from '@/features/workbench/teacher-start-lesson-client';
import { CourseGraphStage } from './course-graph-stage';
import {
  activateTeacherGraphNode,
  navigateStudentGraphNode,
  type CourseGraphNodeAction,
} from '@/features/capability-map/course-graph-navigation';

type CourseMotionState = 'active' | 'paused' | 'reduced';

async function readGraphSnapshot(): Promise<GraphSnapshotModel> {
  const response = await fetch('/api/snapshot?audience=graph', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Graph snapshot failed: ${response.status}`);
  return projectGraphSnapshot(await response.json() as GraphAuthoritativeSnapshot);
}

function ignoreGraphInteraction() {
  // The course overview owns navigation; graph interaction telemetry is optional here.
}

export function CourseOverview({ displayName, graph, initialSnapshot, role }: {
  displayName: string;
  graph: GraphData;
  initialSnapshot: GraphSnapshotModel;
  role: WebRole;
}) {
  const router = useRouter();
  const [motionState, setMotionState] = useState<CourseMotionState>('active');
  const [snapshot, setSnapshot] = useState<GraphSnapshotModel>(initialSnapshot);
  const [navigationStatus, setNavigationStatus] = useState('');

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) setMotionState('reduced');
    const handleReducedMotion = (event: MediaQueryListEvent) => setMotionState((current) => (
      event.matches ? 'reduced' : current === 'reduced' ? 'active' : current
    ));
    reducedMotion.addEventListener('change', handleReducedMotion);
    let active = true;
    const refresh = () => readGraphSnapshot()
      .then((next) => { if (active) setSnapshot(next); })
      .catch(() => undefined);
    void refresh();
    const interval = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      reducedMotion.removeEventListener('change', handleReducedMotion);
    };
  }, []);

  async function prepareTeacherNode(nodeId: string, navigate: (href: string) => void) {
    setNavigationStatus(`正在定位到 ${nodeId}…`);
    try {
      await activateTeacherGraphNode({
        initialRevision: snapshot.authoritativeFacts.classroomRevision,
        start: (expectedRevision) => startTeacherLesson({
          sessionId: snapshot.sessionId,
          nodeId,
          expectedRevision,
          navigate,
        }),
        refreshRevision: async () => {
          const next = await readGraphSnapshot();
          setSnapshot(next);
          return next.authoritativeFacts.classroomRevision;
        },
      });
      setNavigationStatus('');
    } catch (error) {
      setNavigationStatus(error instanceof Error ? error.message : '课堂节点定位失败，请重试。');
      throw error;
    }
  }

  function openNode(nodeId: string, action: CourseGraphNodeAction = 'learn') {
    if (snapshot.mode === 'teacher') {
      void prepareTeacherNode(nodeId, (href) => router.push(href)).catch(() => undefined);
      return;
    }
    navigateStudentGraphNode((href) => router.push(href), nodeId, action);
  }

  function openResource(nodeId: string, resource: ResourceCard) {
    if (snapshot.mode === 'student') {
      router.push(resource.routeTarget.href);
      return;
    }

    if (resource.type === 'projector') {
      const projectorWindow = window.open('about:blank', 'dgbook-graph-projector');
      if (!projectorWindow) {
        setNavigationStatus('浏览器阻止了投屏窗口，请允许此站点打开新窗口。');
        return;
      }
      void prepareTeacherNode(nodeId, () => {
        projectorWindow.location.replace(resource.routeTarget.href);
      }).catch(() => projectorWindow.close());
      return;
    }

    void prepareTeacherNode(nodeId, (href) => router.push(href)).catch(() => undefined);
  }

  function openTask(taskId: P1TaskId) {
    openNode(({ P01: 'P1T1-N01', P02: 'P1T2-N01', P03: 'P1T3-N01' } as const)[taskId]);
  }

  const actorMode = snapshot.mode;
  const selectedNodeId = snapshot.selectedNodeId ?? '';
  const selectedTaskId = getNodeLearningPolicy(selectedNodeId)?.taskId ?? 'P01';
  const facts = snapshot.authoritativeFacts;

  return (
    <main className="course-overview" data-course-home data-motion={motionState}
      data-class-size={facts.classSize}
      data-classroom-revision={facts.classroomRevision}
      data-formal-passed={facts.formalPassed}
      data-formal-submitted={facts.formalSubmitted}
      data-graph-progress={snapshot.nodes.length}
      data-role-overlay={actorMode}
      data-snapshot-version={facts.snapshotVersion}
      data-ui-surface="dark">
      <header className="overview-topbar">
        <div className="scene-brand"><span>DG</span><strong>5G网络优化（高级）</strong><small>课程能力图谱</small></div>
        <div className="overview-breadcrumb"><strong>课程全图</strong><span>/</span><small>{actorMode === 'teacher' ? '课堂热力视图' : '我的能力路径'}</small></div>
        <nav aria-label="课程图谱控制">
          <button aria-label={motionState === 'active' ? '暂停动效' : '开启动效'} className="scene-icon-button" onClick={() => setMotionState((value) => value === 'active' ? 'paused' : 'active')} type="button"><Icon name={motionState === 'active' ? 'pause' : 'play'} size={18} /></button>
          <AccountMenu displayName={displayName} role={role} />
        </nav>
      </header>
      {navigationStatus ? <p aria-live="polite" className="course-graph-navigation-status">{navigationStatus}</p> : null}
      <section className="overview-stage">
        <CourseGraphStage
          actorMode={actorMode}
          graph={graph}
          heatmap={snapshot.nodeHeatmap}
          mode="course-map"
          motionEnabled={motionState === 'active'}
          motionState={motionState}
          onInteraction={ignoreGraphInteraction}
          onNodeSelect={openNode}
          onResourceSelect={openResource}
          onTaskSelect={openTask}
          progress={snapshot.nodes}
          projectCompositeScore={snapshot.projectCompositeScore}
          selectedNodeId={selectedNodeId}
          taskId={selectedTaskId}
          taskProgress={snapshot.tasks}
        />
      </section>
    </main>
  );
}
