import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { graphData } from '../../platform/fixtures/capability-fixtures.ts';
import { nodeLearningPolicies } from '../../platform/learning-policy.ts';
import { SemanticCourseGraph } from './semantic-course-graph.tsx';

const { createElement } = React;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('CourseGraphStage uses one SemanticCourseGraph product at every viewport', () => {
  const stage = source('../textbook-scene/course-graph-stage.tsx');
  assert.doesNotMatch(stage, /@xyflow\/react|ReactFlow|MobileCoursePath|data-mobile-course-path/);
  assert.match(stage, /return <SemanticCourseGraph/);
  assert.match(stage, /motionState=/);
});

test('semantic graph preserves full detail and one learn action on mobile', () => {
  const graph = source('./semantic-course-graph.tsx');
  const css = source('../../app/capability-map.css');
  const themeCss = source('../../app/digital-textbook-v4.css');
  assert.match(graph, /data-semantic-course-graph/);
  assert.match(graph, /className="semantic-graph-svg"/);
  assert.match(graph, /className="graph-detail-panel"/);
  assert.match(graph, /data-primary-action-policy=/);
  assert.match(graph, /selectedAccess\.canNavigate \? '' : undefined/);
  assert.doesNotMatch(graph, /专家图谱|graph-expert-reference/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.semantic-graph-shell[\s\S]*\.graph-detail-panel/);
  assert.doesNotMatch(css, /@media \(max-width: 760px\)[\s\S]*\.graph-detail-panel\s*\{[^}]*display:\s*none/);
  assert.match(
    themeCss,
    /@media \(max-width: 900px\)[\s\S]*\.semantic-graph-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*\}[\s\S]*\.graph-detail-panel\s*\{[^}]*max-width:\s*100%[^}]*\}/,
  );
});

test('semantic graph supports explicit active paused and reduced motion states', () => {
  const overview = source('../textbook-scene/course-overview.tsx');
  const graph = source('./semantic-course-graph.tsx');
  const css = source('../../app/capability-map.css');
  assert.match(overview, /'active' \| 'paused' \| 'reduced'/);
  assert.match(graph, /data-motion=\{motionState\}/);
  assert.match(css, /\[data-motion="reduced"\][\s\S]*animation:\s*none/);
});

test('semantic zoom uses the measured viewport instead of unresolved percentage SVG lengths', () => {
  const graph = source('./semantic-course-graph.tsx');
  assert.match(graph, /\.extent\(\(\): \[\[number, number\], \[number, number\]\] => \[\[0, 0\], \[/);
  assert.match(graph, /container\.clientWidth/);
  assert.match(graph, /container\.clientHeight/);
});

test('the default learning path renders complete P1 plus one explicit unopened-course boundary', () => {
  const html = renderToStaticMarkup(createElement(SemanticCourseGraph, {
    actorMode: 'student',
    graph: graphData,
    heatmap: [],
    selectedNodeId: 'P1T1-N02',
    progress: [],
    taskProgress: [],
    motionState: 'paused',
    onInteraction() {},
    onNodeSelect() {},
    onTaskSelect() {},
  }));

  for (const taskId of ['P01', 'P02', 'P03']) {
    assert.match(html, new RegExp(`data-graph-node-id="${taskId}"`), `${taskId} task entry`);
  }
  for (const task of [1, 2, 3]) {
    for (const node of [1, 2, 3, 4]) {
      const nodeId = `P1T${task}-N0${node}`;
      assert.match(html, new RegExp(`data-graph-node-id="${nodeId}"`), nodeId);
    }
  }

  assert.match(
    html,
    /aria-disabled="true"[^>]*data-graph-node-id="P04"[^>]*data-graph-node-label="后续开放"[^>]*data-graph-node-state="unavailable"/,
  );
  assert.doesNotMatch(html, /data-graph-node-id="P05"/, 'the focused path keeps only the next future boundary');
  assert.match(html, /data-graph-resource="R-P1T1-N02-SELF"/);
  assert.match(html, /href="\/learn\/P1T1-N02"/);
  assert.match(html, /data-graph-resource="R-P1T1-N02-FOLLOW"/);
  assert.match(html, /href="\/classroom\/demo-class"/);
});

test('teacher graph resources are exact-node commands instead of generic navigation links', () => {
  const progress = nodeLearningPolicies.map(({ nodeId }) => ({
    nodeId,
    learningState: 'available' as const,
    stateCompletionPercent: 0,
    nextRequirement: '选择节点进入授课',
  }));
  const html = renderToStaticMarkup(createElement(SemanticCourseGraph, {
    actorMode: 'teacher',
    graph: graphData,
    heatmap: [],
    selectedNodeId: 'P1T1-N02',
    progress,
    taskProgress: [],
    motionState: 'paused',
    onInteraction() {},
    onNodeSelect() {},
    onResourceSelect() {},
    onTaskSelect() {},
  }));

  for (const resourceId of ['R-P1T1-N02-TEACHER', 'R-P1T1-N02-PRESENT']) {
    assert.match(
      html,
      new RegExp(`<button[^>]*data-graph-resource="${resourceId}"`),
      `${resourceId} is an authoritative teacher command`,
    );
    assert.doesNotMatch(
      html,
      new RegExp(`<a[^>]*data-graph-resource="${resourceId}"`),
      `${resourceId} does not bypass node activation with a static link`,
    );
  }
});
