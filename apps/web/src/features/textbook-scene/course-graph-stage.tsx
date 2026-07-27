'use client';

import { SemanticCourseGraph, type GraphMotionState } from '@/features/capability-map/semantic-course-graph';
import type {
  CanonicalGraphNodeProgress,
  CanonicalGraphTaskProgress,
  GraphSnapshotModel,
} from '@/features/capability-map/graph-snapshot-model';
import type { GraphData, ResourceCard, TextbookSceneMode } from '@/platform/models';
import type { P1TaskId } from '@/platform/learning-policy';
import type { CourseGraphNodeAction } from '@/features/capability-map/course-graph-navigation';
import {
  projectNodeAccess,
  projectTaskAccess,
  type NodeAccessProjection,
} from '@/platform/node-access-projection';

type CourseGraphStageProps = {
  actorMode: GraphSnapshotModel['mode'];
  graph: GraphData;
  heatmap: GraphSnapshotModel['nodeHeatmap'];
  mode: TextbookSceneMode;
  motionEnabled: boolean;
  motionState?: GraphMotionState;
  onInteraction: () => void;
  onNodeSelect: (nodeId: string, action: CourseGraphNodeAction) => void;
  onResourceSelect?: (nodeId: string, resource: ResourceCard) => void;
  onTaskSelect: (taskId: P1TaskId) => void;
  progress: CanonicalGraphNodeProgress[] | undefined;
  projectCompositeScore?: number;
  selectedNodeId: string;
  taskId: P1TaskId;
  taskProgress: CanonicalGraphTaskProgress[];
};

export function CourseGraphStage(p: CourseGraphStageProps) {
  function chooseWhenNavigable(access: NodeAccessProjection, choose: () => void) {
    if (!access.canNavigate) return;
    choose();
  }

  function selectNode(nodeId: string, action: CourseGraphNodeAction) {
    const access = projectNodeAccess(nodeId, p.progress);
    chooseWhenNavigable(access, () => p.onNodeSelect(nodeId, action));
  }

  function selectTask(taskId: P1TaskId) {
    const access = projectTaskAccess(taskId, p.progress);
    chooseWhenNavigable(access, () => p.onTaskSelect(taskId));
  }

  return <SemanticCourseGraph
    actorMode={p.actorMode}
    graph={p.graph}
    heatmap={p.heatmap}
    motionState={p.motionState ?? (p.motionEnabled ? 'active' : 'paused')}
    onInteraction={p.onInteraction}
    onNodeSelect={selectNode}
    onResourceSelect={p.onResourceSelect}
    onTaskSelect={selectTask}
    progress={p.progress}
    projectCompositeScore={p.projectCompositeScore}
    selectedNodeId={p.selectedNodeId}
    taskProgress={p.taskProgress}
  />;
}
