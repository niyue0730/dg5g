import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GraphLayerLabels } from './semantic-graph-elements.tsx';

test('graph layer labels stay inside the left safe area without shrinking text', () => {
  const html = renderToStaticMarkup(<svg><GraphLayerLabels /></svg>);

  assert.match(html, /data-graph-layer-safe-right="82"/);
  assert.match(html, /text-anchor="end"/);
  assert.match(html, /font-size="13"/);
  assert.match(html, /<tspan[^>]*>教材任务<\/tspan><tspan[^>]*>与技能<\/tspan>/);
  assert.match(html, /<tspan[^>]*>资源、活动<\/tspan><tspan[^>]*>与评价<\/tspan>/);
});
