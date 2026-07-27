'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ui/foundation/icons.tsx';
import {
  selfStudySectionDefinitions,
  type SelfStudyDocument,
  type SelfStudySectionId,
} from './self-study-types.ts';
import { FigureSection, ProblemSection, SelfStudyGlossary, StepsSection } from './self-study-primary-sections.tsx';
import { PracticeSection, requiredPracticeIdsFor } from './self-study-practice-section.tsx';
import { CorrectionSection, OutputSection } from './self-study-secondary-sections.tsx';

export function SelfStudyRenderer({ document, completed, saving, onComplete, initialSection = 'problem', focusedActivityId }: {
  document: SelfStudyDocument;
  completed: boolean;
  saving: boolean;
  onComplete: () => void;
  initialSection?: SelfStudySectionId;
  focusedActivityId?: string;
}) {
  const [activeSection, setActiveSection] = useState<SelfStudySectionId>(initialSection);
  const [passedPracticeIds, setPassedPracticeIds] = useState<string[]>([]);
  const textbookBodyRef = useRef<HTMLDivElement>(null);
  const activeIndex = selfStudySectionDefinitions.findIndex(({ id }) => id === activeSection);
  const activeDefinition = selfStudySectionDefinitions[activeIndex]!;
  const nextDefinition = selfStudySectionDefinitions[activeIndex + 1];
  const requiredPracticeIds = useMemo(() => requiredPracticeIdsFor(document), [document]);
  const practiceComplete = completed || requiredPracticeIds.every((id) => passedPracticeIds.includes(id));
  const isTaskEvidenceNode = document.nodeId.endsWith('-N04');

  useEffect(() => {
    setActiveSection(initialSection);
    setPassedPracticeIds([]);
  }, [document.nodeId, initialSection]);

  useEffect(() => {
    const onPlaybackTarget = (event: Event) => {
      const targetId = (event as CustomEvent<{ targetId?: string }>).detail?.targetId;
      const section = selfStudySectionDefinitions.find(({ playbackTarget }) => playbackTarget === targetId);
      if (section) setActiveSection(section.id);
    };
    window.addEventListener('dgbook:playback-target', onPlaybackTarget);
    return () => window.removeEventListener('dgbook:playback-target', onPlaybackTarget);
  }, []);

  useEffect(() => {
    if (!textbookBodyRef.current) return;
    textbookBodyRef.current.scrollTop = 0;
    textbookBodyRef.current.scrollLeft = 0;
  }, [activeSection, document.nodeId]);

  function moveSection(offset: number) {
    const nextIndex = Math.max(0, Math.min(selfStudySectionDefinitions.length - 1, activeIndex + offset));
    setActiveSection(selfStudySectionDefinitions[nextIndex]!.id);
  }

  function markPracticePassed(practiceId: string) {
    setPassedPracticeIds((current) => current.includes(practiceId) ? current : [...current, practiceId]);
  }

  return (
    <article
      className="learning-scene self-study-renderer"
      data-image2-learning-stage="true"
      data-learning-unit={document.sourceKnowledgeUnitId}
      data-motion="paused"
      data-node-id={document.nodeId}
      data-primary-action-policy="exactly-one"
      data-remediation-activity={focusedActivityId}
      data-practice-evaluation="server"
      data-self-study-node={document.nodeId}
      data-self-study-renderer={document.nodeId}
    >
      <header className="learning-scene-head self-study-head">
        <div><span>{document.taskId} · {document.nodeId}</span><h1>{document.nodeTitle}</h1></div>
        <nav aria-label="自学内容六段导航">
          {selfStudySectionDefinitions.map(({ id, label }, index) => (
            <button
              aria-current={activeSection === id ? 'step' : undefined}
              className={activeSection === id ? 'is-active' : index < activeIndex ? 'is-past' : ''}
              data-self-study-section-tab={id}
              key={id}
              onClick={() => setActiveSection(id)}
              type="button"
            >
              <i>{index + 1}</i><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="learning-unit-output"><small>本节点记录</small><strong>整理到 {document.taskOutputTitle}</strong></div>
      </header>

      <div className="self-study-workspace">
        <div className="self-study-sections self-study-textbook-body" ref={textbookBodyRef}>
          <StudySection active={activeSection === 'problem'} document={document} id="problem"><ProblemSection document={document} /></StudySection>
          <StudySection active={activeSection === 'figure'} document={document} id="figure"><FigureSection document={document} /></StudySection>
          <StudySection active={activeSection === 'steps'} document={document} id="steps"><StepsSection document={document} /></StudySection>
          <StudySection active={activeSection === 'correction'} document={document} id="correction"><CorrectionSection document={document} /></StudySection>
          <StudySection active={activeSection === 'practice'} document={document} id="practice">
            <PracticeSection
              document={document}
              focusedActivityId={focusedActivityId}
              onPass={markPracticePassed}
              passedIds={passedPracticeIds}
            />
          </StudySection>
          <StudySection active={activeSection === 'output'} document={document} id="output"><OutputSection document={document} /></StudySection>
        </div>
        <SelfStudyGlossary terms={document.content.glossary} />
      </div>

      <footer className="learning-scene-footer self-study-footer">
        <div className="self-study-section-position">
          <button aria-label="返回上一学习段" className="self-study-previous"
            disabled={activeIndex === 0} onClick={() => moveSection(-1)} type="button">
            <Icon name="arrow" size={16} />上一段
          </button>
          <span>第 {activeIndex + 1} 段 / {selfStudySectionDefinitions.length} · {activeDefinition.label}</span>
        </div>
        <span><Icon name={completed ? 'check' : practiceComplete ? 'spark' : 'target'} size={17} />{isTaskEvidenceNode && !completed ? '本节点以成果表提交和教师复核为准' : completed ? '本节点学习记录已保存' : practiceComplete ? '必做练习已通过，可保存学习记录' : '可自由阅读；通过必做练习后保存学习记录'}</span>
        {activeSection === 'output' ? (
          <button data-primary-action="true" disabled={!practiceComplete || saving} onClick={onComplete} type="button">
            {saving ? '正在保存' : completed ? '继续下一节点' : isTaskEvidenceNode ? '去填写成果表' : '保存本节点学习记录'}<Icon name="arrow" size={17} />
          </button>
        ) : (
          <button className="is-next" data-primary-action="true"
            disabled={!nextDefinition} onClick={() => moveSection(1)} type="button">
            {nextDefinition ? `继续：${nextDefinition.label}` : '已经读完'}<Icon name="arrow" size={17} />
          </button>
        )}
      </footer>
    </article>
  );
}

function StudySection({ id, active, document, children }: {
  id: SelfStudySectionId;
  active: boolean;
  document: SelfStudyDocument;
  children: ReactNode;
}) {
  const definition = selfStudySectionDefinitions.find((item) => item.id === id)!;
  return (
    <section
      aria-labelledby={`${document.nodeId}-${id}-title`}
      className={`self-study-section is-${id}${active ? ' is-active' : ''}`}
      data-playback-target={definition.playbackTarget}
      data-self-study-section={id}
      hidden={!active}
    >
      {children}
    </section>
  );
}
