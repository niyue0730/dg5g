import type { CurriculumGraphNode, GraphData, SemanticEdge } from '@/platform/models';
import React, { useRef } from 'react';
import { nodeLearningStateLabel } from '@/platform/learning-status';
import { getNodeLearningPolicy } from '@/platform/learning-policy';
import { demoTaskScorePolicy } from '@/platform/learning-mastery';
import { projectFutureContentAccess, projectNodeAccess, projectTaskAccess, type NodeAccessProgress, type NodeAccessProjection } from '@/platform/node-access-projection';
import {
  isGraphNodeKeyboardActivation,
  isGraphNodePointerActivation,
  isGraphNodeSyntheticClick,
  type GraphNodePointerPoint,
} from './graph-node-activation';
import { edgeBoundaryPoints, placeEdgeLabel, routeSemanticEdge, semanticZoomLevel } from './graph-geometry';
import type {
  CanonicalGraphNodeProgress,
  CanonicalGraphTaskProgress,
  GraphSnapshotModel,
} from './graph-snapshot-model';

export const graphKindLabel: Record<CurriculumGraphNode['kind'], string> = {
  role: '岗位群',
  'work-task': '典型工作任务',
  capability: '核心能力',
  project: '课程项目',
  'textbook-task': '教材任务',
  skill: '技能与知识',
  activity: '学习活动',
  achievement: '成果回流',
};

const graphLayerLabelSafeRight = 82;
const graphLayerGuides = [
  { lines: ['岗位群'], y: 92 },
  { lines: ['典型工作', '任务'], y: 220 },
  { lines: ['核心能力'], y: 350 },
  { lines: ['课程项目'], y: 496 },
  { lines: ['教材任务', '与技能'], y: 640 },
  { lines: ['资源、活动', '与评价'], y: 920 },
] as const;

export function GraphLayerLabels() {
  return <g aria-hidden="true" className="graph-layer-labels" data-graph-layer-safe-right={graphLayerLabelSafeRight}>
    {graphLayerGuides.map(({ lines, y }) => <g data-graph-layer-label={lines.join('')} key={lines.join('')}>
      <circle cx="8" cy={y} r="4" />
      <path d={`M14 ${y}H24`} />
      <text fontSize="13" textAnchor="end" x={graphLayerLabelSafeRight}>
        {lines.map((line, index) => <tspan key={line} x={graphLayerLabelSafeRight} y={lines.length === 1 ? y + 5 : y - 2 + index * 14}>{line}</tspan>)}
      </text>
    </g>)}
  </g>;
}

export function GraphEdge({ edge, nodesById, obstacles: graphNodes, pathSet, showLabel }: { edge: SemanticEdge; nodesById: Map<string, CurriculumGraphNode>; obstacles: readonly CurriculumGraphNode[]; pathSet: Set<string>; showLabel: boolean }) {
  const source = nodesById.get(edge.from);
  const target = nodesById.get(edge.to);
  if (!source || !target) return null;
  const obstacles = graphNodes.filter((node) => node.id !== edge.from && node.id !== edge.to);
  const routed = routeSemanticEdge(source, target, obstacles);
  const boundary = edgeBoundaryPoints(source, target);
  const route = routed.points.length >= 2 ? routed : { points: [
    { x: boundary.x1, y: boundary.y1 },
    { x: boundary.x2, y: boundary.y2 },
  ] };
  const labelWidth = Math.max(44, edge.label.length * 13 + 14);
  const labelHeight = 20;
  const label = placeEdgeLabel(route, { width: labelWidth, height: labelHeight }, [source, target, ...obstacles]);
  const path = route.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const focused = pathSet.has(edge.from) && pathSet.has(edge.to);
  return <g className={`semantic-edge is-${edge.kind}${focused ? ' is-path' : ''}`}
    data-edge-id={edge.edgeId} data-edge-route={route.points.map((point) => `${point.x},${point.y}`).join(' ')}
    data-edge-source={edge.from} data-edge-target={edge.to}>
    <path d={path} markerEnd={`url(#arrow-${edge.kind})`} vectorEffect="non-scaling-stroke" />
    {showLabel && focused ? <g className="semantic-edge-label" data-edge-label={edge.edgeId}
      transform={`translate(${label.anchorX} ${label.anchorY})`}>
      <rect height={labelHeight} rx="4" width={labelWidth} x={-labelWidth / 2} y={-labelHeight / 2} />
      <text y="4">{edge.label}</text>
    </g> : null}
  </g>;
}

export function GraphNode({ node, selected, current, path, achievement, access, zoomLevel, onChoose, taskProgress }: {
  node: CurriculumGraphNode;
  selected: boolean;
  current: boolean;
  path: boolean;
  achievement: string;
  access: NodeAccessProjection;
  zoomLevel: ReturnType<typeof semanticZoomLevel>;
  onChoose: (node: CurriculumGraphNode) => void;
  taskProgress: CanonicalGraphTaskProgress[];
}) {
  const achievementTaskId = taskIdForAchievementNode(node);
  const achievementTask = achievementTaskId ? taskProgress.find((item) => item.taskId === achievementTaskId) : undefined;
  const taskScore = node.kind === 'achievement' ? achievementTask?.taskCompositeScore : undefined;
  const title = node.kind === 'achievement'
    ? `任务综合分 ${scoreLabel(taskScore, achievementTask?.origin)}`
    : node.title;
  const showSubtitle = zoomLevel === 'detail' && node.subtitle && !access.disabled;
  const pointerStart = useRef<GraphNodePointerPoint>();
  // D3 zoom suppresses the SVG click after its mouse gesture. Pointer events let
  // a short press activate while still distinguishing it from graph panning.
  function startPointer(event: React.PointerEvent<SVGGElement>) {
    if (event.button === 0) pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function finishPointer(event: React.PointerEvent<SVGGElement>) {
    const start = pointerStart.current;
    pointerStart.current = undefined;
    if (!start || !access.canNavigate) return;
    if (isGraphNodePointerActivation(start, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    })) onChoose(node);
  }
  function finishSyntheticClick(event: React.MouseEvent<SVGGElement>) {
    if (access.canNavigate && isGraphNodeSyntheticClick(event.detail)) onChoose(node);
  }
  return (
    <g
      aria-label={`${graphKindLabel[node.kind]}：${title}`}
      aria-disabled={!access.canNavigate}
      className={`curriculum-node is-${node.kind}${selected ? ' is-selected' : ''}${current ? ' is-current' : ''}${path ? ' is-path' : ''} is-${achievement}${access.disabled ? ' is-locked' : ''}`}
      data-graph-node-id={node.id}
      data-graph-node-label={access.label}
      data-graph-node-state={access.kind}
      onClick={finishSyntheticClick}
      onPointerCancel={() => { pointerStart.current = undefined; }}
      onPointerDownCapture={startPointer}
      onPointerUpCapture={finishPointer}
      onKeyDown={(event) => { if (access.canNavigate && isGraphNodeKeyboardActivation(event.key)) { event.preventDefault(); onChoose(node); } }}
      role="button"
      tabIndex={access.canNavigate ? 0 : -1}
      transform={`translate(${node.x} ${node.y})`}
    >
      {achievement === 'verified' ? <rect className="node-verified-ring" height={node.height + 10} rx="10" width={node.width + 10} x="-5" y="-5" /> : null}
      <rect height={node.height} rx="6" width={node.width} />
      <text className="node-title" textAnchor="middle" x={node.width / 2} y={showSubtitle || access.disabled ? node.height / 2 - 4 : node.height / 2 + 5}>{title}</text>
      {showSubtitle ? <text className="node-subtitle" textAnchor="middle" x={node.width / 2} y={node.height / 2 + 16}>{node.subtitle}</text> : null}
      {access.disabled ? <text className="node-lock-label" textAnchor="middle" x={node.width / 2} y={node.height / 2 + 15}>{access.label}</text> : null}
      {path ? <circle className="node-path-dot" cx="10" cy="10" r="4" /> : null}
      {access.disabled ? <path className="node-lock" d={`M${node.width - 24} 18v-4a5 5 0 0 1 10 0v4m-12 0h14v11h-14z`} /> : null}
    </g>
  );
}

export function achievementForNode(node: CurriculumGraphNode, access: NodeAccessProjection, progress: CanonicalGraphNodeProgress[] | undefined, tasks: CanonicalGraphTaskProgress[]) {
  if (access.kind !== 'open') return access.kind;
  if (node.kind === 'achievement') {
    const taskId = taskIdForAchievementNode(node);
    const task = tasks.find((item) => item.taskId === taskId);
    return task?.stateCompletionPercent === 100 ? 'mastered' : 'open';
  }
  const record = node.nodeId ? progress?.find((item) => item.nodeId === node.nodeId) : undefined;
  if (record?.learningState === 'achieved') return 'mastered';
  if (record?.learningState === 'teacher-verified') return 'verified';
  if (record?.learningState === 'formal-test-passed') return 'passed';
  if (record?.learningState === 'locked') return 'locked';
  return record?.learningState ?? access.state ?? 'open';
}

export function accessForCurriculumNode(
  node: CurriculumGraphNode,
  progress: readonly NodeAccessProgress[] | undefined,
): NodeAccessProjection {
  if (node.nodeId) return projectNodeAccess(node.nodeId, progress);
  if (node.taskId) return projectTaskAccess(node.taskId, progress);
  if (node.projectId) return projectFutureContentAccess(node.id);
  return { nodeId: node.id, kind: 'open', label: '可查看', disabled: false, canNavigate: true, prerequisiteNodeIds: [] };
}

export function taskIdForAchievementNode(node: CurriculumGraphNode): 'P01' | 'P02' | 'P03' | undefined {
  if (node.taskId) return node.taskId;
  const matched = node.id.match(/achievement-(p0[123])/i)?.[1]?.toUpperCase();
  return matched === 'P01' || matched === 'P02' || matched === 'P03' ? matched : undefined;
}

export function detailForNode(
  node: CurriculumGraphNode,
  access: NodeAccessProjection,
  graph: GraphData,
  progress: CanonicalGraphNodeProgress[] | undefined,
  tasks: CanonicalGraphTaskProgress[],
  heatmap: GraphSnapshotModel['nodeHeatmap'],
  projectCompositeScore?: number,
) {
  const ability = node.nodeId ? graph.nodes.find((item) => item.nodeId === node.nodeId) : undefined;
  const record = node.nodeId ? progress?.find((item) => item.nodeId === node.nodeId) : undefined;
  const task = node.taskId ? tasks.find((item) => item.taskId === node.taskId) : undefined;
  const nodeHeatmap = node.nodeId ? heatmap.find((item) => item.nodeId === node.nodeId) : undefined;
  const formalTestTitle = node.nodeId === 'P1T1-N02'
    ? '设备拓扑正式测试'
    : node.nodeId === 'P1T2-N02'
      ? '天线姿态正式测试'
      : node.nodeId === 'P1T3-N02'
        ? '复现场景正式测试'
        : '本节点不设正式测试';
  return {
    node,
    title: node.title,
    status: record?.learningState
      ? nodeLearningStateLabel[record.learningState]
      : task?.stateCompletionPercent === 100 ? '任务完成' : access.label,
    percent: record?.stateCompletionPercent ?? task?.stateCompletionPercent ?? 0,
    rows: ability ? [
      { label: '岗位任务', value: ({ P01: '室内信息采集', P02: '室外信息采集', P03: '投诉信息采集' } as const)[node.taskId ?? 'P01'] },
      { label: '学习目标', value: ability.goal },
      { label: '教材内容', value: ability.title },
      { label: '微练习', value: microPracticeLabel(node.nodeId) },
      { label: '正式节点测试', value: formalTestTitle },
      { label: '节点测试最高分', value: scoreLabel(record?.nodeTestHighestScore, record?.origin) },
      { label: '下一步', value: record?.nextRequirement ?? access.label },
      ...(nodeHeatmap ? [{ label: '班级状态分布', value: heatmapLabel(nodeHeatmap.stateCounts) }] : []),
    ] : [
      { label: '图谱层级', value: graphKindLabel[node.kind] },
      { label: '当前关系', value: node.subtitle ?? '沿课程能力主线展开' },
      ...(task ? [
        { label: '节点测试最高分', value: scoreLabel(task.nodeTestHighestScore, task.origin) },
        { label: '任务综合分', value: scoreLabel(task.taskCompositeScore, task.origin) },
        { label: '计分口径', value: demoTaskScorePolicy.label },
      ] : []),
      ...(node.projectId === 'P1' ? [{
        label: '项目综合分',
        value: scoreLabel(
          projectCompositeScore,
          tasks.some(({ origin }) => origin === 'user') ? 'user'
            : tasks.some(({ origin }) => origin === 'demo') ? 'demo' : undefined,
        ),
      }] : []),
    ],
  };
}

function scoreLabel(score: number | undefined, origin?: 'demo' | 'user'): string {
  return score === undefined ? '尚未形成' : `${score}分${origin === 'demo' ? ' · 演示数据' : ''}`;
}

function microPracticeLabel(nodeId?: string) {
  const assessmentRole = nodeId ? getNodeLearningPolicy(nodeId)?.assessmentRole : undefined;
  if (assessmentRole === 'node-test') return '对象与证据连线';
  if (assessmentRole === 'task-pixi') return '证据链翻卡';
  if (nodeId && new Set(['P1T1-N03', 'P1T2-N03', 'P1T3-N03']).has(nodeId)) return '专业步骤排序';
  return '关键证据选择';
}

function heatmapLabel(stateCounts: GraphSnapshotModel['nodeHeatmap'][number]['stateCounts']): string {
  const entries = Object.entries(stateCounts).filter(([, count]) => (count ?? 0) > 0);
  return entries.length === 0
    ? '尚未开始'
    : entries.map(([state, count]) => `${nodeLearningStateLabel[state as keyof typeof nodeLearningStateLabel]} ${count}人`).join(' · ');
}
