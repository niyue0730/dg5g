import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('the root layout installs the final text legibility and drag-scroll layer', () => {
  const layout = source('../../app/layout.tsx');
  assert.match(layout, /import '\.\/content-legibility\.css'/);
  assert.match(layout, /<PointerDragScroll \/>/);
});

test('demo task labels wrap and fixed workspaces expose draggable scrollbars', () => {
  const css = source('../../app/content-legibility.css');
  for (const selector of [
    '.scene-slide-rail > button strong',
    '.scene-rail li button strong',
    '.shared-classroom-scene > footer strong',
    '.scene-follow-path button strong',
    '.teacher-new-lesson button small',
    '.graph-resource-links :is(a, button) strong',
    '.p1-task-rail strong',
    '.p1-portfolio-item h3',
    '.demo-control-steps button strong',
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /white-space:\s*normal/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /::-webkit-scrollbar-thumb/);
  assert.match(css, /\.teacher-inspector-panel/);
  assert.match(css, /\.self-study-glossary/);
  assert.match(css, /\.public-platform-flow/);
  assert.match(css, /learning-workspace\.is-path-open\s*\{[^}]*grid-template-rows:\s*84px/);
  assert.match(css, /\.semantic-graph-svg\s*\{[^}]*cursor:\s*grab/);
});

test('pointer dragging scrolls overflowing rails without breaking ordinary clicks', () => {
  const support = source('../../app/pointer-drag-scroll.tsx');
  assert.match(support, /dragThreshold = 6/);
  assert.match(support, /surface\.scrollLeft = state\.startScrollLeft - deltaX/);
  assert.match(support, /surface\.scrollTop = state\.startScrollTop - deltaY/);
  assert.match(support, /'\.teacher-inspector-panel'/);
  assert.match(support, /'\.self-study-textbook-body'/);
  assert.match(support, /'\.public-platform-flow'/);
  assert.match(support, /if \(!suppressClick\) return/);
  assert.match(support, /event\.preventDefault\(\)/);
});
