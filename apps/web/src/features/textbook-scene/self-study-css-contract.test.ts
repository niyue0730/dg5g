import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cssUrl = new URL('../../app/self-study-textbook.css', import.meta.url);
const figureLegibilityCssUrl = new URL('../../app/self-study-figure-legibility.css', import.meta.url);
const figureCssUrl = new URL('../../app/annotated-engineering-figure.css', import.meta.url);
const outputCssUrl = new URL('../../app/professional-output.css', import.meta.url);
const classroomCssUrl = new URL('../../app/student-classroom-runtime.css', import.meta.url);
const layoutUrl = new URL('../../app/layout.tsx', import.meta.url);
const textbookCssUrl = new URL('../../app/digital-textbook-v4.css', import.meta.url);
const textbookSceneCssUrl = new URL('../../app/textbook-scene.css', import.meta.url);
const authCssUrl = new URL('../../app/auth.css', import.meta.url);

test('the six-section textbook owns a responsive Image2 engineering stage', async () => {
  const [css, figureLegibilityCss, layout] = await Promise.all([
    readFile(cssUrl, 'utf8'),
    readFile(figureLegibilityCssUrl, 'utf8'),
    readFile(layoutUrl, 'utf8'),
  ]);
  assert.match(layout, /import '\.\/self-study-textbook\.css'/);
  assert.match(layout, /import '\.\/self-study-figure-legibility\.css'/);
  for (const selector of [
    '.self-study-renderer',
    '.self-study-head nav',
    '.self-study-sections',
    '.self-study-glossary',
    '.self-study-evidence-rules',
    '.self-study-examples',
    '.self-study-correction-layout',
    '.self-study-practice-card',
    '.self-study-output-template',
  ]) assert.match(css, new RegExp(selector.replaceAll('.', '\\.')));
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /touch-action: pan-x/);
  assert.match(css, /\.self-study-renderer \.self-study-footer[\s\S]{0,100}position: relative/);
  assert.match(css, /\.textbook-scene-shell\.is-learning \.learning-workspace\.is-path-open/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /max-width: 100vw/);
  assert.match(figureLegibilityCss, /@media \(max-width: 1100px\)[\s\S]*?\.self-study-workspace > \.self-study-glossary\s*\{[\s\S]*?display:\s*flex/);
  assert.match(figureLegibilityCss, /@media \(max-width: 900px\)[\s\S]*?\.learning-workspace\.is-path-open,[\s\S]*?grid-template-rows:\s*84px minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});

test('mobile learning surfaces have one bounded scroller, safe output actions, and no artificial follow gap', async () => {
  const [selfStudyCss, figureCss, outputCss, classroomCss] = await Promise.all([
    readFile(cssUrl, 'utf8'),
    readFile(figureCssUrl, 'utf8'),
    readFile(outputCssUrl, 'utf8'),
    readFile(classroomCssUrl, 'utf8'),
  ]);
  assert.match(selfStudyCss, /\.self-study-textbook-body\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(selfStudyCss, /@media \(max-width: 760px\)[\s\S]*?\.self-study-section\.is-active/);
  assert.match(selfStudyCss, /@media \(max-width: 760px\)[\s\S]*?overflow-x:\s*hidden/);
  assert.match(selfStudyCss, /@media \(max-width: 760px\)[\s\S]*?\.textbook-scene-shell:has\(\.self-study-renderer\) \.scene-location\s*\{[\s\S]*?display:\s*none/);
  assert.doesNotMatch(figureCss, /min-width:\s*680px/);
  assert.match(outputCss, /\.professional-output-fields \[data-output-field\]:last-child[\s\S]*?(?:margin-bottom|padding-bottom):\s*(?:1[6-9]|[2-9]\d)px/);
  assert.match(outputCss, /scroll-margin-bottom:\s*(?:1[6-9]|[2-9]\d|1\d\d)px/);
  assert.doesNotMatch(classroomCss, /\.classroom-follow-current\s*\{[\s\S]{0,120}?min-height:\s*520px/);
  assert.match(classroomCss, /@media \(max-width: 720px\)[\s\S]*?\.classroom-self-status,[\s\S]*?\.classroom-entry-status[\s\S]*?min-height:\s*0/);
  assert.match(classroomCss, /\[data-classroom-connection="online"\]::after[\s\S]*?content:\s*'在线'/);
});

test('the formal challenge stacks the game and evidence panels at 390px', async () => {
  const [css, sceneCss] = await Promise.all([
    readFile(textbookCssUrl, 'utf8'),
    readFile(textbookSceneCssUrl, 'utf8'),
  ]);

  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.challenge-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.challenge-game-stage\s*\{[^}]*min-width:\s*0/);
  assert.match(sceneCss, /@media \(max-width: 760px\)[\s\S]*?\.skill-game-replay-frame\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(sceneCss, /@media \(max-width: 760px\)[\s\S]*?\.skill-game-replay-frame dl,\.skill-game-replay-frame > button\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(sceneCss, /@media \(max-width: 760px\)[\s\S]*?\.skill-game-replay-frame > button\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/);
});

test('the 390px learning topbar removes its account min-content overflow source', async () => {
  const css = await readFile(authCssUrl, 'utf8');

  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*?\.scene-topbar \.account-menu-identity\s*\{[^}]*display:\s*none/,
  );
});
