'use client';

import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { curriculumFocusPath } from '@/platform/fixtures/curriculum-graph-fixtures';
import type { CurriculumGraphNode, GraphData, ResourceCard } from '@/platform/models';
import type { P1TaskId } from '@/platform/learning-policy';
import { Icon } from '@/ui/foundation/icons';
import { semanticZoomLevel } from './graph-geometry';
import { GraphMinimap } from './graph-minimap';
import { fitP1PathViewport } from './graph-viewport-fit';
import {
  dispatchCurriculumGraphNode,
  type CourseGraphNodeAction,
} from './course-graph-navigation';
import type {
  CanonicalGraphNodeProgress,
  CanonicalGraphTaskProgress,
  GraphSnapshotModel,
} from './graph-snapshot-model';
import { accessForCurriculumNode, achievementForNode, detailForNode, graphKindLabel, GraphEdge, GraphLayerLabels, GraphNode } from './semantic-graph-elements';

type ViewTransform = { x: number; y: number; k: number };
type GraphMode = 'path' | 'overview' | 'achievement';
export type GraphMotionState = 'active' | 'paused' | 'reduced';

const world = { width: 1560, height: 1080 };
const revealRank = { overview: 0, route: 1, detail: 2 } as const;
export function SemanticCourseGraph({
  actorMode,
  graph,
  heatmap,
  selectedNodeId,
  progress,
  projectCompositeScore,
  taskProgress,
  motionState,
  onInteraction,
  onNodeSelect,
  onResourceSelect,
  onTaskSelect,
}: {
  actorMode: GraphSnapshotModel['mode'];
  graph: GraphData;
  heatmap: GraphSnapshotModel['nodeHeatmap'];
  selectedNodeId: string;
  progress: CanonicalGraphNodeProgress[] | undefined;
  projectCompositeScore?: number;
  taskProgress: CanonicalGraphTaskProgress[];
  motionState: GraphMotionState;
  onInteraction: () => void;
  onNodeSelect: (nodeId: string, action: CourseGraphNodeAction) => void;
  onResourceSelect?: (nodeId: string, resource: ResourceCard) => void;
  onTaskSelect: (taskId: P1TaskId) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [mode, setMode] = useState<GraphMode>('path');
  const [selectedId, setSelectedId] = useState(selectedNodeId);
  const [query, setQuery] = useState('');
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, k: .72 });
  const [viewport, setViewport] = useState({ width: 1100, height: 760 });
  const pathSet = useMemo(() => new Set(curriculumFocusPath), []);
  const nodesById = useMemo(() => new Map(graph.curriculumNodes.map((node) => [node.id, node])), [graph.curriculumNodes]);
  const accessById = useMemo(() => new Map(graph.curriculumNodes.map((node) => [node.id, accessForCurriculumNode(node, progress)])), [graph.curriculumNodes, progress]);
  const selected = nodesById.get(selectedId) ?? graph.curriculumNodes.find((node) => node.nodeId === selectedNodeId);
  const selectedAccess = selected
    ? accessById.get(selected.id)!
    : { nodeId: selectedNodeId, kind: 'unavailable' as const, label: '学习状态不可用', disabled: true, canNavigate: false, prerequisiteNodeIds: [] };
  const zoomLevel = semanticZoomLevel(transform.k);
  const visibleNodes = useMemo(() => graph.curriculumNodes.filter((node) => {
    if (node.id === selected?.id || pathSet.has(node.id)) return true;
    // Keep the complete P1 sample focused, plus P04 as the explicit disabled
    // boundary that tells learners where the course continues after the demo.
    if (mode === 'path') return /^(?:P0[1-4]|P1T[123]-N0[1234]|practice-p01|game-|evidence-|achievement-p0)/.test(node.id);
    if (mode === 'overview') return node.revealAt === 'overview' || revealRank[node.revealAt] <= revealRank[zoomLevel];
    if (mode === 'achievement') return node.kind === 'achievement' || node.kind === 'activity' || node.kind === 'skill' || node.revealAt === 'overview';
    return revealRank[node.revealAt] <= revealRank[zoomLevel];
  }), [graph.curriculumNodes, mode, pathSet, selected?.id, zoomLevel]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => graph.semanticEdges.filter((edge) => {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return false;
    return true;
  }), [graph.semanticEdges, visibleIds]);

  useEffect(() => {
    const match = graph.curriculumNodes.find((node) => node.nodeId === selectedNodeId);
    if (match) setSelectedId(match.id);
  }, [graph.curriculumNodes, selectedNodeId]);

  useEffect(() => {
    const svg = svgRef.current;
    const container = mainRef.current;
    const worldGroup = worldRef.current;
    if (!svg || !container || !worldGroup) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .extent((): [[number, number], [number, number]] => [[0, 0], [Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1)]])
      .scaleExtent([.42, 1.55])
      .translateExtent([[-260, -180], [world.width + 260, world.height + 180]])
      .on('start', onInteraction)
      .on('zoom', (event: { transform: ZoomTransform }) => {
        select(worldGroup).attr('transform', event.transform.toString());
        setTransform({ x: event.transform.x, y: event.transform.y, k: event.transform.k });
      });
    zoomRef.current = behavior;
    select(svg).call(behavior);
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 1100;
      const height = entry?.contentRect.height ?? 760;
      setViewport({ width, height });
      fitGraphMode(behavior, svg, width, height, mode);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      select(svg).on('.zoom', null);
      zoomRef.current = null;
    };
  }, [mode, onInteraction]);

  function resetOverview() {
    if (zoomRef.current && svgRef.current) fitOverview(zoomRef.current, svgRef.current, viewport.width, viewport.height);
  }

  function zoomBy(factor: number) {
    const behavior = zoomRef.current;
    const svg = svgRef.current;
    if (!behavior || !svg) return;
    select(svg).call(behavior.scaleBy, factor);
  }

  function focusNode(node: CurriculumGraphNode) {
    setSelectedId(node.id);
    const behavior = zoomRef.current;
    const svg = svgRef.current;
    if (!behavior || !svg) return;
    const scale = Math.max(1.02, transform.k);
    const x = viewport.width / 2 - (node.x + node.width / 2) * scale;
    const y = viewport.height / 2 - (node.y + node.height / 2) * scale;
    select(svg).call(behavior.transform, zoomIdentity.translate(x, y).scale(scale));
  }

  function chooseNode(node: CurriculumGraphNode) {
    const access = accessById.get(node.id);
    if (!access || !access.canNavigate) return;
    focusNode(node);
    dispatchCurriculumGraphNode(node, { onNodeSelect, onTaskSelect });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim().toLowerCase();
    if (!normalized) return;
    const found = graph.curriculumNodes.find((node) => `${node.id}${node.title}${node.subtitle ?? ''}`.toLowerCase().includes(normalized));
    if (found) focusNode(found);
  }

  const detail = selected ? detailForNode(selected, selectedAccess, graph, progress, taskProgress, heatmap, projectCompositeScore) : null;
  const selectedResources = selected?.nodeId
    ? resourcesForActor(graph.bindings.filter(({ nodeId }) => nodeId === selected.nodeId), actorMode)
    : [];
  const selectedResourceNodeId = selected?.nodeId;
  return (
    <section className={`semantic-graph-shell is-${mode} is-${actorMode}`} data-graph-density={mode}
      data-primary-action-policy={detail && (detail.node.nodeId || detail.node.taskId) && selectedAccess.canNavigate ? 'exactly-one' : 'none'}
      data-semantic-course-graph data-motion={motionState} ref={shellRef}>
      <aside className="graph-mode-rail" aria-label="图谱视图">
        <strong>课程能力图谱</strong>
        <button aria-pressed={mode === 'path'} onClick={() => setMode('path')} type="button"><Icon name="follow" size={21} /><span>{actorMode === 'teacher' ? '课堂路径' : '我的路径'}</span></button>
        <button aria-pressed={mode === 'overview'} onClick={() => setMode('overview')} type="button"><Icon name="map" size={21} /><span>课程全图</span></button>
        <button aria-pressed={mode === 'achievement'} onClick={() => setMode('achievement')} type="button"><Icon name="chart" size={21} /><span>{actorMode === 'teacher' ? '能力热力' : '学习成绩'}</span></button>
      </aside>

      <div className="semantic-graph-main" ref={mainRef}>
        <form className="graph-search" onSubmit={search}>
          <Icon name="target" size={17} /><input aria-label="搜索岗位、能力或教材节点" onChange={(event) => setQuery(event.target.value)} placeholder="搜索岗位、能力或教材节点" value={query} /><button type="submit">定位</button>
        </form>
        <div className="graph-zoom-controls">
          <button aria-label="缩小图谱" onClick={() => zoomBy(.82)} type="button">−</button>
          <span>{Math.round(transform.k * 100)}%</span>
          <button aria-label="放大图谱" onClick={() => zoomBy(1.2)} type="button">+</button>
          <button onClick={resetOverview} type="button">返回全景</button>
        </div>
        <svg aria-label="5G网络优化课程能力图谱" className="semantic-graph-svg" ref={svgRef} role="img">
          <title>5G网络优化课程能力图谱</title>
          <desc>从岗位群、典型工作任务、核心能力、课程项目到教材任务，并通过关联资源、学习活动和评价结果形成闭环的可缩放语义图谱。</desc>
          <defs>
            <pattern height="40" id="graph-grid" patternUnits="userSpaceOnUse" width="40"><path d="M40 0H0V40" fill="none" stroke="#143951" strokeWidth="1" /></pattern>
            {(['prerequisite', 'evidence', 'output', 'review', 'assessment'] as const).map((kind) => (
              <marker id={`arrow-${kind}`} key={kind} markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4"><path d="M0 0 8 4 0 8Z" /></marker>
            ))}
          </defs>
          <rect fill="url(#graph-grid)" height="100%" width="100%" />
          <g ref={worldRef}>
            <GraphLayerLabels />
            <g className="semantic-edge-layer">
              {visibleEdges.map((edge) => <GraphEdge edge={edge} key={edge.edgeId} nodesById={nodesById} obstacles={visibleNodes} pathSet={pathSet} showLabel={mode === 'path' || zoomLevel === 'detail'} />)}
            </g>
            <g className="curriculum-node-layer">
              {visibleNodes.map((node) => { const access = accessById.get(node.id)!; return (
                <GraphNode
                  access={access}
                  achievement={achievementForNode(node, access, progress, taskProgress)}
                  current={node.nodeId === selectedNodeId}
                  key={node.id}
                  node={node}
                  onChoose={chooseNode}
                  path={pathSet.has(node.id)}
                  selected={node.id === selected?.id}
                  taskProgress={taskProgress}
                  zoomLevel={zoomLevel}
                />
              ); })}
            </g>
          </g>
        </svg>
        <div className="graph-legend" aria-label="连线图例"><span className="is-prerequisite">前置</span><span className="is-evidence">资源与活动</span><span className="is-assessment">评价成绩</span></div>
        <GraphMinimap nodes={graph.curriculumNodes} transform={transform} viewport={viewport} />
      </div>

      <aside className="graph-detail-panel" data-selected-graph-node={selected?.id ?? ''}>
        {detail ? <>
          <header><span>{graphKindLabel[detail.node.kind]}</span><h2>{detail.title}</h2><small>{detail.node.id}</small></header>
          <dl>{detail.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          <div className="graph-detail-score"><span>当前状态</span><strong>{detail.status}</strong><i><b style={{ width: `${detail.percent}%` }} /></i></div>
          {selectedResources.length ? (
            <section className="graph-resource-links" data-graph-resource-count={selectedResources.length}>
              <header><span>关联资源</span><strong>{selectedResources.length} 项可用资源</strong></header>
              <div>
                {selectedResources.map((resource) => actorMode === 'teacher' && selectedResourceNodeId && onResourceSelect ? (
                  <button data-graph-resource={resource.resourceId}
                    key={resource.resourceId}
                    onClick={() => onResourceSelect(selectedResourceNodeId, resource)}
                    type="button">
                    <Icon name={resourceIcon(resource)} size={17} />
                    <span><strong>{resource.title}</strong><small>{resourceTypeLabel[resource.type]}</small></span>
                    <Icon name="arrow" size={15} />
                  </button>
                ) : (
                  <a data-graph-resource={resource.resourceId} href={resource.routeTarget.href}
                    key={resource.resourceId}>
                    <Icon name={resourceIcon(resource)} size={17} />
                    <span><strong>{resource.title}</strong><small>{resourceTypeLabel[resource.type]}</small></span>
                    <Icon name="arrow" size={15} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          {(detail.node.nodeId || detail.node.taskId) ? <button data-primary-action={selectedAccess.canNavigate ? '' : undefined} disabled={!selectedAccess.canNavigate} onClick={() => { if (selectedAccess.canNavigate) chooseNode(detail.node); }} title={selectedAccess.label} type="button">{actorMode === 'teacher' ? '进入授课' : selectedAccess.kind === 'locked' ? '查看解锁条件' : detail.node.action === 'formal-test' ? '进入正式测试' : '继续学习'}<Icon name="arrow" size={18} /></button> : null}
        </> : null}
      </aside>
    </section>
  );
}

const resourceTypeLabel: Record<ResourceCard['type'], string> = {
  'student-page': '完整教材正文',
  activity: '课堂跟学活动',
  'teacher-slide': '教师授课页',
  projector: '全班投屏页',
  table: '学习记录表',
};

function resourcesForActor(
  resources: ResourceCard[],
  actorMode: GraphSnapshotModel['mode'],
): ResourceCard[] {
  const visibleTypes: ResourceCard['type'][] = actorMode === 'teacher'
    ? ['teacher-slide', 'projector']
    : ['student-page', 'activity'];
  return resources.filter(({ type }) => visibleTypes.includes(type)).slice(0, 2);
}

function resourceIcon(resource: ResourceCard): 'book' | 'follow' | 'teacher' | 'projector' | 'file' {
  if (resource.type === 'student-page') return 'book';
  if (resource.type === 'activity') return 'follow';
  if (resource.type === 'teacher-slide') return 'teacher';
  if (resource.type === 'projector') return 'projector';
  return 'file';
}

function fitOverview(behavior: ZoomBehavior<SVGSVGElement, unknown>, svg: SVGSVGElement, width: number, height: number) {
  const scale = Math.max(.42, Math.min(.86, Math.min((width - 22) / world.width, (height - 22) / world.height)));
  const x = (width - world.width * scale) / 2;
  const y = (height - world.height * scale) / 2;
  select(svg).call(behavior.transform, zoomIdentity.translate(x, y).scale(scale));
}

function fitGraphMode(behavior: ZoomBehavior<SVGSVGElement, unknown>, svg: SVGSVGElement, width: number, height: number, mode: GraphMode) {
  if (mode === 'overview') {
    fitOverview(behavior, svg, width, height);
    return;
  }
  const transform = fitP1PathViewport(width, height);
  select(svg).call(behavior.transform, zoomIdentity.translate(transform.x, transform.y).scale(transform.k));
}
