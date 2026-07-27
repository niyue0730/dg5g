import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

type FigureKind = 'topology' | 'antenna' | 'complaint';
type FigureModule = {
  AnnotatedEngineeringFigure: (props: { kind: FigureKind; evidenceLabels?: readonly string[] }) => React.ReactNode;
  engineeringFigureSpecs: Record<FigureKind, {
    objects: Array<{ id: string }>;
    connectors: Array<{ sourceId: string; targetId: string }>;
    labels: Array<{ id: string; title: string; text: string }>;
  }>;
  validateEngineeringFigureSpec: (kind: FigureKind) => string[];
};

const sourceUrl = new URL('./annotated-engineering-figure.tsx', import.meta.url);
const stylesheetUrl = new URL('../../app/annotated-engineering-figure.css', import.meta.url);

async function loadFigureModule(): Promise<FigureModule> {
  assert.equal(existsSync(sourceUrl), true, 'annotated engineering figure component must exist');
  return await import(sourceUrl.href) as FigureModule;
}

test('all engineering figure geometry stays in bounds without object or label collisions', async () => {
  const figures = await loadFigureModule();
  for (const kind of ['topology', 'antenna', 'complaint'] as const) {
    assert.deepEqual(figures.validateEngineeringFigureSpec(kind), [], kind);
    const spec = figures.engineeringFigureSpecs[kind];
    const objectIds = new Set(spec.objects.map((item) => item.id));
    assert.ok(spec.connectors.length >= 2);
    for (const connector of spec.connectors) {
      assert.ok(objectIds.has(connector.sourceId));
      assert.ok(objectIds.has(connector.targetId));
    }
  }
});

test('topology figure explains location, identity, and connection direction evidence', async () => {
  const figures = await loadFigureModule();
  const markup = renderToStaticMarkup(createElement(figures.AnnotatedEngineeringFigure, {
    kind: 'topology',
    evidenceLabels: ['位置证据', '身份铭牌', '端口与光纤方向'],
  }));
  for (const marker of ['rack-location', 'device-identity', 'connection-direction']) {
    assert.match(markup, new RegExp(`data-figure-label="${marker}"`));
  }
  assert.match(markup, /src="\/media\/5g\/p01-n02-topology-stage-v1\.png"/);
  assert.match(markup, /端口与光纤方向/);
});

test('all figure kinds derive a compact mobile evidence list from the shared specification', async () => {
  const figures = await loadFigureModule();
  for (const kind of ['topology', 'antenna', 'complaint'] as const) {
    const markup = renderToStaticMarkup(createElement(figures.AnnotatedEngineeringFigure, { kind }));
    assert.equal((markup.match(/data-mobile-evidence-list=/g) ?? []).length, 1, kind);
    for (const item of figures.engineeringFigureSpecs[kind].labels) {
      assert.match(markup, new RegExp(`data-mobile-evidence="${item.id}"`), kind);
      assert.match(markup, new RegExp(item.title), kind);
      assert.match(markup, new RegExp(item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), kind);
    }
  }
});

test('antenna figure exposes azimuth, down-tilt, and mounting-height evidence', async () => {
  const figures = await loadFigureModule();
  const markup = renderToStaticMarkup(createElement(figures.AnnotatedEngineeringFigure, { kind: 'antenna' }));
  for (const marker of ['azimuth-evidence', 'downtilt-evidence', 'height-evidence']) {
    assert.match(markup, new RegExp(`data-figure-label="${marker}"`));
  }
});

test('complaint figure is a same-condition reproduction scene and never falls back to a coverage route', async () => {
  const figures = await loadFigureModule();
  const markup = renderToStaticMarkup(createElement(figures.AnnotatedEngineeringFigure, { kind: 'complaint' }));
  for (const marker of ['complaint-record', 'same-location', 'same-business', 'same-device', 'reproduction-record']) {
    assert.match(markup, new RegExp(`data-figure-object="${marker}"`));
  }
  assert.doesNotMatch(markup, /coverage-route|覆盖路线/);
});

test('engineering figure stylesheet preserves readable dark-engineering labels at responsive widths', () => {
  assert.equal(existsSync(stylesheetUrl), true);
  const css = readFileSync(stylesheetUrl, 'utf8');
  for (const marker of ['.annotated-engineering-figure', '.engineering-label-layer', '.engineering-connector-layer', '@media (max-width: 760px)']) {
    assert.match(css, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /\.engineering-mobile-evidence\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 900px\)[\s\S]*?\.engineering-figure-canvas svg\s*\{[\s\S]*?min-width:\s*100%/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.engineering-figure-canvas svg\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.engineering-mobile-evidence\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.engineering-mobile-evidence\s*\{[\s\S]*?order:\s*2/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.engineering-figure-canvas\s*\{[\s\S]*?order:\s*3/);
  assert.doesNotMatch(css, /min-width:\s*680px/);
  assert.doesNotMatch(css, /purple|#(?:7c3aed|8b5cf6|a855f7)/i);
});
