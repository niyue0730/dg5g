import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { requireSelfStudyDocument, selfStudySectionDefinitions } from './self-study-content.ts';
import { SelfStudyRenderer } from './self-study-renderer.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('resolves all self-study text through validated P1 generated content', () => {
  const document = requireSelfStudyDocument('P1T1-N02');

  assert.equal(document.taskId, 'P01');
  assert.equal(document.nodeId, 'P1T1-N02');
  assert.equal(document.nodeTitle, '设备拓扑');
  assert.equal(document.content.kind, 'deep');
  assert.deepEqual(selfStudySectionDefinitions.map(({ id, label }) => [id, label]), [
    ['problem', '问题'],
    ['figure', '看图'],
    ['steps', '步骤'],
    ['correction', '纠偏'],
    ['practice', '练习'],
    ['output', '记录'],
  ]);

  const source = readFileSync(new URL('./self-study-content.ts', import.meta.url), 'utf8');
  assert.match(source, /loadP1DemoContent/);
  assert.doesNotMatch(source, /readFileSync|JSON\.parse|demoTaskProfiles/);
});

test('renders the P03 deep textbook with six navigable sections and no N02 output submission', () => {
  const document = requireSelfStudyDocument('P1T3-N02');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.match(html, /data-self-study-node="P1T3-N02"/);
  for (const segment of ['problem', 'figure', 'steps', 'correction', 'practice', 'output']) {
    assert.match(html, new RegExp(`data-self-study-section="${segment}"`));
  }
  assert.match(html, /data-self-study-figure="complaint"/);
  assert.equal((html.match(/data-self-study-example=/g) ?? []).length, 2);
  assert.equal((html.match(/data-self-study-counterexample=/g) ?? []).length, 2);
  assert.match(html, /data-practice-level="foundation"/);
  assert.match(html, /data-practice-level="application"/);
  assert.match(html, /data-practice-level="transfer"/);
  assert.match(html, /错误反馈/);
  assert.match(html, /重新作答/);
  assert.match(html, /迁移练习/);
  assert.match(html, /节点整理记录模板/);
  assert.match(html, /评价标准/);
  assert.doesNotMatch(html, /提交任务成果|evidence_submitted|服务端规则|可汇入/);
});

test('the self-study surface exposes one primary continuation and a bounded textbook scroller', () => {
  const document = requireSelfStudyDocument('P1T1-N02');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );
  const source = readFileSync(new URL('./self-study-renderer.tsx', import.meta.url), 'utf8');

  assert.match(html, /<article[^>]*data-motion="paused"/);
  assert.match(html, /data-primary-action-policy="exactly-one"/);
  assert.match(html, /class="self-study-sections self-study-textbook-body"/);
  assert.equal((html.match(/data-primary-action="true"/g) ?? []).length, 1);
  assert.match(html, /data-primary-action="true"[^>]*>继续：/);
  assert.match(html, /class="self-study-previous"/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.equal((html.match(/<button[^>]*data-self-study-section-tab=/g) ?? []).length, 6);
  assert.equal((source.match(/data-primary-action="true"/g) ?? []).length, 2, 'next and output branches each own their primary action');
  assert.match(source, /textbookBodyRef\.current\.scrollTop = 0/);
  assert.doesNotMatch(source, /scrollIntoView/);
});

test('P1T1-N02 renders the beginner three-question scaffold inside the problem section', () => {
  const document = requireSelfStudyDocument('P1T1-N02');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.equal((html.match(/data-beginner-scaffold="three-question"/g) ?? []).length, 1);
  assert.equal((html.match(/data-beginner-question=/g) ?? []).length, 3);
  assert.match(html, /data-beginner-question="where"/);
  assert.match(html, /data-beginner-question="who"/);
  assert.match(html, /data-beginner-question="connects-to"/);
  assert.match(html, /在哪里/);
  assert.match(html, /是谁/);
  assert.match(html, /连到哪/);
  assert.match(html, /做到什么算完成/);
  assert.equal((html.match(/data-self-study-section-tab=/g) ?? []).length, 6);
});

test('the renderer owns one persistent terminology lookup across all six sections', () => {
  const document = requireSelfStudyDocument('P1T1-N02');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.match(html, /data-self-study-figure="topology"/);
  assert.equal((html.match(/data-self-study-glossary="true"/g) ?? []).length, 1);
  assert.match(html, /class="self-study-workspace"/);
});

test('the same renderer adapts a standard node without falling back to summary-only content', () => {
  const document = requireSelfStudyDocument('P1T1-N01');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.equal(document.content.kind, 'standard');
  assert.match(html, /data-self-study-node="P1T1-N01"/);
  assert.match(html, /关系图/);
  assert.match(html, /结构化节点记录/);
  assert.match(html, /重新作答/);
});

test('P1T1-N01 renders an engineering scope relation figure instead of plain text cards', () => {
  const document = requireSelfStudyDocument('P1T1-N01');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.match(html, /data-self-study-figure="indoor-scope-boundary"/);
  assert.match(html, /data-indoor-scope-boundary-figure="true"/);
  assert.match(html, /class="self-study-figure-layout is-full-width"/);
  assert.match(html, /任务单/);
  assert.match(html, /机房入口/);
  assert.match(html, /机柜范围/);
  assert.match(html, /排除对象/);
  assert.match(html, /data-scope-callout="task"/);
  assert.match(html, /data-scope-callout="identity"/);
  assert.match(html, /data-scope-callout="exclusion"/);
  assert.match(html, /data-scope-boundary-label="collection"/);
  assert.match(html, /data-scope-zone="collection-zone"/);
  assert.match(html, /data-scope-zone="excluded-rack-zone"/);
  assert.match(html, /data-scope-boundary-label="excluded-rack"/);
  assert.match(html, /data-scope-flow="identity-to-room"/);
  assert.match(html, /data-scope-flow="exclude-to-rack"/);
  assert.doesNotMatch(html, /data-scope-flow="collection-to-boundary"/);
  assert.match(html, /<text x="25" y="24">他网<\/text>/);
  assert.match(html, /<text x="25" y="50">柜<\/text>/);
  const css = readFileSync(new URL('../../app/self-study-textbook.css', import.meta.url), 'utf8');
  assert.match(css, /\.self-study-figure-layout\.is-full-width\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const scopeCss = readFileSync(new URL('../../app/self-study-scope-map.css', import.meta.url), 'utf8');
  assert.match(scopeCss, /\.self-study-engineering-figure\s*>\s*\.self-study-scope-map\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(scopeCss, /\.self-study-scope-map svg\s*\{[\s\S]*?height:\s*auto[\s\S]*?aspect-ratio:\s*23\s*\/\s*8/);
  assert.doesNotMatch(scopeCss, /\.self-study-scope-map svg\s*\{[^}]*min-height/);
  assert.match(scopeCss, /@media \(max-width: 760px\)[\s\S]*?\.self-study-scope-map svg\s*\{[\s\S]*?display:\s*none/);
});

test('P1T1-N02 practice cards are labelled as must-do optional and challenge layers', () => {
  const document = requireSelfStudyDocument('P1T1-N02');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.match(html, /必做练习/);
  assert.match(html, /选做练习/);
  assert.match(html, /挑战练习/);
  assert.match(html, /data-practice-level-tab="foundation"/);
  assert.match(html, /data-practice-level-tab="application"/);
  assert.match(html, /data-practice-level-tab="transfer"/);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
  const practiceSource = readFileSync(new URL('./self-study-practice-section.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('./self-study-renderer.tsx', import.meta.url), 'utf8');
  assert.match(practiceSource, /hidden=\{activeLevel !== level\}/);
  assert.match(rendererSource, /requiredPracticeIdsFor\(document\)/);
});

test('record templates hug their content instead of stretching into an empty panel', () => {
  const css = readFileSync(new URL('../../app/self-study-textbook.css', import.meta.url), 'utf8');
  assert.match(css, /\.self-study-output-template\s*\{[\s\S]*?align-self:\s*start/);
});

test('P1T1-N04 output copy treats the current page as the task result page', () => {
  const document = requireSelfStudyDocument('P1T1-N04');
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.doesNotMatch(html, /任务级证据表在 P01 的 N04 节点/);
  assert.match(html, /当前就是P01的任务成果页/);
  assert.match(html, /填写、保存、提交、退回修订/);
});

test('all twelve node record templates expose student-facing Chinese field labels', () => {
  const nodeIds = [
    'P1T1-N01', 'P1T1-N02', 'P1T1-N03', 'P1T1-N04',
    'P1T2-N01', 'P1T2-N02', 'P1T2-N03', 'P1T2-N04',
    'P1T3-N01', 'P1T3-N02', 'P1T3-N03', 'P1T3-N04',
  ] as const;

  for (const nodeId of nodeIds) {
    const html = renderToStaticMarkup(
      <SelfStudyRenderer
        completed={false}
        document={requireSelfStudyDocument(nodeId)}
        onComplete={() => undefined}
        saving={false}
      />,
    );
    const labels = [...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1]);

    assert.ok(labels.length > 0, `${nodeId} should render record fields`);
    assert.ok(labels.every((label) => /[\u3400-\u9fff]/u.test(label)), `${nodeId} leaked an internal field key: ${labels.join(', ')}`);
  }

  const expectedN02Labels = {
    'P1T1-N02': ['站点与机房', '位置证据', '设备身份依据', '连接方向依据', '复核结论'],
    'P1T2-N02': ['扇区标识', '方位角记录', '下倾角记录', '挂高记录', '现场环境', '复核结论'],
    'P1T3-N02': ['投诉基本信息', '复现条件', '业务侧证据', '网络侧证据', '对照分析', '复核结论'],
  } as const;

  for (const [nodeId, expectedLabels] of Object.entries(expectedN02Labels)) {
    const html = renderToStaticMarkup(
      <SelfStudyRenderer
        completed={false}
        document={requireSelfStudyDocument(nodeId)}
        onComplete={() => undefined}
        saving={false}
      />,
    );
    for (const label of expectedLabels) assert.match(html, new RegExp(`<dt>${label}</dt>`));
  }
});

test('unknown internal record keys use a safe student-facing fallback', () => {
  const source = requireSelfStudyDocument('P1T1-N01');
  assert.equal(source.content.kind, 'standard');
  if (source.content.kind !== 'standard') return;

  const document = {
    ...source,
    content: {
      ...source.content,
      nodeRecordTemplate: { mysteryInternalField: '待填写' },
    },
  };
  const html = renderToStaticMarkup(
    <SelfStudyRenderer completed={false} document={document} onComplete={() => undefined} saving={false} />,
  );

  assert.match(html, /<dt>其他记录项<\/dt>/);
  assert.doesNotMatch(html, /mysteryInternalField/);
});
