import { Icon, type IconName } from '../../ui/foundation/icons.tsx';
import type { DeepSelfStudyContent, SelfStudyDocument } from './self-study-types.ts';
import { AnnotatedEngineeringFigure } from './annotated-engineering-figure.tsx';

export function ProblemSection({ document }: { document: SelfStudyDocument }) {
  const { content } = document;
  const question = content.kind === 'deep' ? content.taskQuestion : document.nodeGoal;
  return (
    <div className="self-study-problem-grid">
      <div className="self-study-copy-block">
        <span>案例背景</span>
        <h2 id={`${document.nodeId}-problem-title`}>{question}</h2>
        {content.kind === 'deep' && content.beginnerScaffold ? (
          <BeginnerScaffold scaffold={content.beginnerScaffold} />
        ) : null}
        {content.caseBackground.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        {content.kind === 'deep' ? (
          <aside><strong>必要前置知识</strong><ul>{content.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul></aside>
        ) : null}
      </div>
    </div>
  );
}

function BeginnerScaffold({ scaffold }: { scaffold: NonNullable<DeepSelfStudyContent['beginnerScaffold']> }) {
  return (
    <aside className="self-study-beginner-scaffold" data-beginner-scaffold="three-question">
      <header>
        <Icon name="spark" size={18} />
        <div>
          <span>新手先看这里</span>
          <strong>{scaffold.simpleMission}</strong>
        </div>
      </header>
      <p className="self-study-beginner-analogy">{scaffold.analogy}</p>
      <div className="self-study-beginner-questions">
        {scaffold.threeQuestions.map((question, index) => (
          <article data-beginner-question={question.id} key={question.id}>
            <span>{index + 1}</span>
            <h3>{question.question}</h3>
            <p><b>{question.evidenceType}</b>：{question.proves}</p>
            <small>不能证明：{question.cannotProve}</small>
            <ul>{question.outputFields.map((field) => <li key={field}>{field}</li>)}</ul>
          </article>
        ))}
      </div>
      <footer>
        <strong>做到什么算完成</strong>
        <ul>{scaffold.completionStandard.map((item) => <li key={item}>{item}</li>)}</ul>
      </footer>
    </aside>
  );
}

export function SelfStudyGlossary({ terms }: { terms: Array<{ term: string; definition: string }> }) {
  return (
    <aside className="self-study-glossary" data-self-study-glossary>
      <header><Icon name="book" size={18} /><span>术语查询</span></header>
      {terms.map(({ term, definition }) => (
        <details data-self-study-term={term} key={term}><summary>{term}</summary><p>{definition}</p></details>
      ))}
    </aside>
  );
}

export function FigureSection({ document }: { document: SelfStudyDocument }) {
  const { content } = document;
  const figureKind = content.kind === 'deep'
    ? content.annotatedFigures[0]?.kind
    : content.relationshipFigure.kind;
  const figureLabel = figureKind === 'indoor-scope-boundary'
    ? '采集边界工程图'
    : '带标注的工程关系图';
  return (
    <div className={`self-study-figure-layout ${content.kind === 'deep' ? 'has-evidence-support' : 'is-full-width'}`}>
      <div>
        <span>{figureLabel}</span>
        <h2 id={`${document.nodeId}-figure-title`}>{content.kind === 'deep' ? '从图中找到判断所需证据' : '关系图与证据位置'}</h2>
        {content.kind === 'deep'
          ? content.annotatedFigures.map((figure, index) => (
            <div data-self-study-figure={figure.kind} key={`${figure.kind}-${index}`}>
              <AnnotatedEngineeringFigure evidenceLabels={figure.evidenceLabels} kind={figure.kind} />
            </div>
          ))
          : <RelationshipEvidenceFigure evidenceLabels={content.relationshipFigure.evidenceLabels} figureKind={content.relationshipFigure.kind} />}
      </div>
      {content.kind === 'deep' ? (
        <div className="self-study-figure-support">
          <aside className="self-study-evidence-rules">
            <span>判断依据</span>
            {content.evidenceRules.map((rule) => (
              <article key={rule.claim}>
                <strong>{rule.claim}</strong>
                <ul>{rule.requiredEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
                <p><Icon name="link" size={14} />为什么：{rule.reason}</p>
              </article>
            ))}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function RelationshipEvidenceFigure({ figureKind, evidenceLabels }: { figureKind: string; evidenceLabels: string[] }) {
  const descriptor = figureDescriptor(figureKind);
  if (descriptor.kind === 'indoor-scope-boundary') {
    const taskSegments = (evidenceLabels[0] ?? '').split(' / ');
    const taskLineOne = taskSegments.slice(0, 2).join(' / ');
    const taskLineTwo = taskSegments.slice(2).join(' / ');
    const [exclusionScope = evidenceLabels[3], exclusionReason = ''] = (evidenceLabels[3] ?? '').split('；');
    return (
      <figure
        className="self-study-engineering-figure is-indoor-scope-boundary"
        data-indoor-scope-boundary-figure="true"
        data-self-study-figure={descriptor.kind}
      >
        <figcaption><Icon name={descriptor.icon} size={20} /><span>{descriptor.title}</span></figcaption>
        <div className="self-study-scope-map" aria-label="室内采集范围工程关系图">
          <svg data-scope-engineering-map="true" role="img" viewBox="0 0 920 320">
            <title>HY-01室内采集范围关系图</title>
            <desc>任务单要求采集01号机房K01到K04，本图同时标出共享他网机柜和02号机房排除区。</desc>
            <defs>
              <marker id="scope-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                <path d="M0 0 8 4 0 8Z" />
              </marker>
            </defs>
            <rect className="scope-site" data-scope-zone="site" height="224" rx="22" width="780" x="80" y="90" />
            <text className="scope-site-label" x="105" y="118">HY-01 站点现场</text>
            <rect className="scope-room is-in-scope" data-scope-zone="target-room" height="175" rx="18" width="510" x="130" y="130" />
            <text className="scope-room-label" x="155" y="160">01号机房 · 本次进入</text>
            <rect className="scope-room is-out-scope" data-scope-zone="excluded-room" height="175" rx="18" width="140" x="690" y="130" />
            <text className="scope-room-label" x="710" y="160">02号机房</text>
            <rect className="scope-collection-boundary" data-scope-zone="collection-zone" height="100" rx="12" width="280" x="165" y="180" />
            <rect className="scope-boundary-label-box" data-scope-boundary-label="collection" height="20" rx="6" width="178" x="175" y="185" />
            <text className="scope-boundary-label" x="187" y="200">本运营商采集区 · K01-K04</text>
            {['K01', 'K02', 'K03', 'K04'].map((rack, index) => (
              <g data-scope-rack={rack} key={rack} transform={`translate(${185 + index * 60} 215)`}>
                <rect className="scope-rack is-target" height="48" rx="9" width="42" />
                <text x="21" y="31">{rack}</text>
              </g>
            ))}
            <rect className="scope-rack-exclusion-zone" data-scope-zone="excluded-rack-zone" height="100" rx="12" width="110" x="490" y="180" />
            <rect className="scope-rack-exclusion-label-box" data-scope-boundary-label="excluded-rack" height="20" rx="6" width="82" x="504" y="185" />
            <text className="scope-rack-exclusion-label" x="516" y="200">排除对象</text>
            <g data-scope-rack="other-operator" transform="translate(522 215)">
              <rect className="scope-rack is-excluded" height="48" rx="9" width="46" />
              <text x="23" y="19">他网</text>
              <text x="23" y="40">柜</text>
            </g>
            <path className="scope-flow" d="M120 78V90" data-scope-flow="task-to-site" markerEnd="url(#scope-arrow)" />
            <path className="scope-flow" d="M375 78V130" data-scope-flow="identity-to-room" markerEnd="url(#scope-arrow)" />
            <path className="scope-reject-flow" d="M745 78V130" data-scope-flow="exclude-to-room" markerEnd="url(#scope-arrow)" />
            <path className="scope-reject-flow" d="M650 78V105H545V180" data-scope-flow="exclude-to-rack" markerEnd="url(#scope-arrow)" />
            <g className="scope-callout" data-scope-callout="task" transform="translate(20 8)">
              <rect height="70" rx="14" width="200" />
              <text className="scope-callout-title" x="18" y="23">任务单</text>
              <text x="18" y="43">{taskLineOne}</text>
              {taskLineTwo ? <text x="18" y="63">{taskLineTwo}</text> : null}
            </g>
            <g className="scope-callout" data-scope-callout="identity" transform="translate(240 8)">
              <rect height="70" rx="14" width="270" />
              <text className="scope-callout-title" x="18" y="24">现场身份</text>
              <text x="18" y="50">{evidenceLabels[1]}</text>
            </g>
            <g className="scope-callout is-warn" data-scope-callout="exclusion" transform="translate(590 8)">
              <rect height="70" rx="14" width="310" />
              <text className="scope-callout-title" x="18" y="22">排除区</text>
              <text x="18" y="42">{exclusionScope}</text>
              {exclusionReason ? <text x="18" y="62">{exclusionReason}</text> : null}
            </g>
          </svg>
          <ol className="self-study-scope-map-legend">
            <li><strong>采集</strong><span>只进入任务单和现场门牌都能证明的01号机房K01—K04。</span></li>
            <li><strong>排除</strong><span>他网机柜、02号机房不属于本次范围，必须写出排除证据。</span></li>
            <li><strong>复核</strong><span>任何照片都要能回到站点、机房、柜号三层关系。</span></li>
          </ol>
        </div>
      </figure>
    );
  }
  return (
    <figure className={`self-study-engineering-figure is-${descriptor.kind}`} data-self-study-figure={descriptor.kind}>
      <figcaption><Icon name={descriptor.icon} size={20} /><span>{descriptor.title}</span></figcaption>
      <div>
        {evidenceLabels.map((label, index) => (
          <article key={`${label}-${index}`}>
            <span>{index + 1}</span>
            <Icon name={descriptor.stepIcons[index % descriptor.stepIcons.length]!} size={24} />
            <strong>{label}</strong>
            {index < evidenceLabels.length - 1 ? <Icon name="arrow" size={17} /> : null}
          </article>
        ))}
      </div>
    </figure>
  );
}

export function StepsSection({ document }: { document: SelfStudyDocument }) {
  const { content } = document;
  const examples = content.kind === 'deep'
    ? content.examples
    : [{ title: '完整示例', evidence: content.example.evidence, reasoning: content.reasoningSteps, conclusion: content.example.conclusion }];
  return (
    <div className="self-study-steps-layout">
      <div>
        <span>逐步推理</span>
        <h2 id={`${document.nodeId}-steps-title`}>证据 → 判断 → 结论</h2>
        <ol className="self-study-reasoning">
          {content.reasoningSteps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}
        </ol>
      </div>
      <div className="self-study-examples">
        {examples.map((example, index) => (
          <article data-self-study-example={index + 1} key={`${example.title}-${index}`}>
            <header><Icon name="check" size={17} /><strong>{example.title}</strong></header>
            <div><span>证据</span><ul>{example.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><span>推理</span><ol>{example.reasoning.map((item) => <li key={item}>{item}</li>)}</ol></div>
            <p><strong>结论：</strong>{example.conclusion}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function figureDescriptor(kind: string): { kind: string; title: string; icon: IconName; stepIcons: IconName[] } {
  if (kind === 'topology') return { kind, title: '设备位置—身份—连接方向证据链', icon: 'bbu', stepIcons: ['room', 'bbu', 'link'] };
  if (kind === 'antenna') return { kind, title: '天线方位角—下倾角—挂高证据链', icon: 'aau', stepIcons: ['radio', 'target', 'gps'] };
  if (kind === 'complaint') return { kind, title: '投诉条件—复现动作—网络留痕证据链', icon: 'complaint', stepIcons: ['gps', 'complaint', 'log', 'signaling'] };
  if (kind === 'indoor-scope-boundary') return { kind, title: '任务单—机房入口—机柜范围—排除对象关系图', icon: 'room', stepIcons: ['file', 'room', 'bbu', 'close'] };
  return { kind, title: '节点对象与证据关系图', icon: 'layers', stepIcons: ['target', 'link', 'file'] };
}
