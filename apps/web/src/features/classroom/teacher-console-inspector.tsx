import { OutputReviewPanel } from '@/features/review/output-review-panel';
import { TeacherSkillPulse } from '@/features/skill-tree/teacher-skill-pulse';
import { Icon } from '@/ui/foundation/icons';
import { demoTaskScorePolicy } from '@/platform/learning-mastery';
import type { TeacherConsoleViewProps } from './teacher-console-view-props';

export function TeacherConsoleInspector({ p }: { p: TeacherConsoleViewProps }) {
  if (!p.inspectorOpen) return null;
  return (
    <>
    <button aria-label="关闭教师检查器背景层" className="teacher-inspector-backdrop"
      data-teacher-inspector-backdrop onClick={p.closeInspector} tabIndex={-1} type="button" />
    <aside aria-label="授课与学情检查器" aria-modal="true" className="teacher-inspector scene-teacher-inspector"
      data-selected-tab={p.inspectorTab} data-teacher-inspector role="dialog">
      <header>
        <div><span>教师私有</span><strong>授课与学情检查器</strong></div>
        <button aria-label="收起检查器" onClick={p.closeInspector} type="button">
          <Icon name="close" size={16} />
        </button>
      </header>
      <nav className="teacher-inspector-tabs" aria-label="教师检查器视图">
        {([['script', '讲稿'], ['learning', '学情'], ['review', '批阅']] as const)
          .map(([tab, label]) => (
            <button aria-pressed={p.inspectorTab === tab} data-teacher-inspector-tab={tab}
              key={tab} onClick={() => p.setInspectorTab(tab)} type="button">
              {label}
            </button>
          ))}
      </nav>
      <div className="teacher-inspector-panel is-script" hidden={p.inspectorTab !== 'script'}>
        {p.teachingPage ? (
          <>
            <section className="teacher-script" data-teaching-script={p.teachingPage.id}>
              <span>第{p.teachingPage.lessonNumber}课时 · 第{p.teachingPage.pageNumber}页 · 建议{p.teachingPage.suggestedMinutes}分钟</span>
              <strong>{p.teachingPage.title}</strong>
              <p><b>讲</b><span>{p.teachingPage.teacherExplanation}</span></p>
            </section>
            <section className="teacher-question">
              <span>结合案例提问</span>
              <strong>{p.teachingPage.caseQuestion}</strong>
              <p><b>典型答案</b>{p.teachingPage.typicalAnswer}</p>
            </section>
            <section className="teacher-question">
              <span>常见错误与追问</span>
              <ul>{p.teachingPage.commonErrors.map((item) => <li key={item}>{item}</li>)}</ul>
              <ol>{p.teachingPage.followUpPrompts.map((item) => <li key={item}>{item}</li>)}</ol>
            </section>
            <section className="teacher-question">
              <span>学生动作</span>
              <p>{p.teachingPage.studentAction}</p>
              <small>过渡语：{p.teachingPage.transition}</small>
            </section>
          </>
        ) : (
          <>
            <section className="teacher-script">
              <span>讲解脚本</span>
              {p.teacherScript.map((line, index) => <p key={line}><b>{index + 1}</b>{line}</p>)}
            </section>
            <section className="teacher-question">
              <span>提问与节点依据</span>
              <strong>{p.unit.question}</strong>
              <p>{p.unit.summary}</p>
              <small>常见错误：{p.unit.counterexample}</small>
            </section>
          </>
        )}
      </div>
      <div className="teacher-inspector-panel is-learning" hidden={p.inspectorTab !== 'learning'}>
        <section className="teacher-formal-analytics" data-formal-test-analytics>
          <span>正式测试学情{p.classScores.demoData ? <small> · 演示数据</small> : null}</span>
          <div className="teacher-score-kpis">
            <div><small>已提交</small><strong>{p.formalAssessment.submittedCount}/{p.formalAssessment.eligibleCount}</strong></div>
            <div><small>节点测试均分</small><strong>{scoreLabel(p.classScores.activeNodeTestAverageScore)}</strong></div>
            <div><small>达标率</small><strong>{percentLabel(p.formalAssessment.passRatePercent)}</strong></div>
          </div>
          <div className="teacher-score-kpis" data-authoritative-score-kinds="node-task-project">
            <div><small>节点测试最高分</small><strong>{scoreLabel(p.classScores.activeNodeTestHighestScore)}</strong></div>
            <div><small>任务综合平均分</small><strong>{scoreLabel(p.classScores.activeTaskCompositeAverageScore)}</strong></div>
            <div><small>项目综合平均分</small><strong>{scoreLabel(p.classScores.projectCompositeAverageScore)}</strong></div>
          </div>
          <small className="teacher-score-policy">任务综合分按“{demoTaskScorePolicy.label}”计算，教师确认成果后形成。</small>
          <strong>成绩分布</strong>
          <div className="teacher-score-distribution">
            {p.classScores.distribution.map((band) => (
              <i key={band.range} title={`${distributionLabel(band.range)}: ${band.count}`}>
                <b>{band.count}</b><small>{distributionLabel(band.range)}</small>
              </i>
            ))}
          </div>
          <strong>能力薄弱点</strong>
          <div className="teacher-ability-heat"><i>设备识别</i><i>端口链路</i><i>证据核验</i></div>
        </section>
        <section className="teacher-supervision-panel" data-teacher-supervision="p1">
          <span>课堂关注</span>
          <div><strong>{p.rosterStats.needsHelp}</strong><small>需要关注</small></div>
          <div><strong>{p.rosterStats.submitted}</strong><small>已提交</small></div>
          <p>{p.submittedAnswers[0] ?? '等待学生提交'}</p>
        </section>
        <div className="teacher-self-study-snapshot"
          data-self-study-state={p.session.selfStudyState ?? 'not_started'}
          data-self-study-answers={p.session.selfStudyAnswers?.length ?? 0}>
          <span>自学证据</span><p>{p.session.selfStudyAnswers?.[0] ?? '暂无新记录'}</p>
        </div>
        <div className="teacher-answer-snapshot" data-submission-answers={p.submittedAnswers.length}>
          <span>课堂提交</span><p>{p.submittedAnswers[0] ?? '等待学生提交'}</p>
        </div>
        <TeacherSkillPulse nodeId={p.unit.capabilityNodeId} />
        <section className={`teacher-delivery-status is-${p.helperReady ? 'online' : 'offline'}`}
          data-command-delivery-state={deliveryState(p)}>
          <span>指令回执</span>
          <strong>{p.helperReady
            ? `已应用 ${p.deliveryStats.applied} · 等待 ${p.deliveryStats.pending} · 失败 ${p.deliveryStats.failed}`
            : '启动课堂助手后才能控制学生屏幕'}</strong>
          <small>{p.connection.state === 'online'
            ? `课堂连接正常 · ${p.onlineStudentDeviceCount} 台学生设备已连接`
            : `会话状态：${p.connection.state}`}</small>
        </section>
      </div>
      <div className="teacher-inspector-panel is-review" hidden={p.inspectorTab !== 'review'}>
        <OutputReviewPanel />
      </div>
    </aside>
    </>
  );
}

function deliveryState(p: TeacherConsoleViewProps): 'offline' | 'failed' | 'waiting' | 'applied' {
  if (!p.helperReady) return 'offline';
  if (p.deliveryStats.failed) return 'failed';
  return p.deliveryStats.pending ? 'waiting' : 'applied';
}

function scoreLabel(value: number | undefined): string {
  return value === undefined ? '尚未形成' : String(value);
}

function percentLabel(value: number | undefined): string {
  return value === undefined ? '尚未形成' : `${value}%`;
}

function distributionLabel(range: TeacherConsoleViewProps['classScores']['distribution'][number]['range']): string {
  if (range === 'pass-89') return '达标-89';
  if (range === '60-below-pass') return '60-达标线以下';
  if (range === 'below-60') return '60以下';
  return range;
}
