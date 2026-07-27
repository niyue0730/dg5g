import Link from 'next/link';
import { Icon } from '../../ui/foundation/icons.tsx';
import { demoTaskScorePolicy } from '../../platform/learning-mastery.ts';
import type { StudentHomeViewModel } from './student-home-model.ts';
import { RoleHomeHeader } from './role-home-header.tsx';

export function StudentHome({ model }: { model: StudentHomeViewModel }) {
  const facts = model.authoritativeFacts;
  return (
    <main className="role-home-shell role-home-student"
      data-class-size={facts?.classSize ?? 0}
      data-classroom-revision={facts?.classroomRevision ?? 0}
      data-formal-passed={facts?.formalPassed ?? 0}
      data-formal-submitted={facts?.formalSubmitted ?? 0}
      data-motion="paused"
      data-primary-action-policy="exactly-one"
      data-snapshot-version={facts?.snapshotVersion ?? 0}
      data-student-home data-ui-surface="dark">
      <RoleHomeHeader displayName={model.displayName} role="student" />
      {model.kind === 'ready' ? <StudentReady model={model} /> : <StudentBlocked model={model} />}
    </main>
  );
}

function StudentReady({ model }: { model: Extract<StudentHomeViewModel, { kind: 'ready' }> }) {
  const modeLabel = model.primaryAction.mode === 'classroom-follow' ? '课堂跟随' : '自主学习';
  return (
    <div className="role-home-body student-home-grid">
      <section className="role-home-card student-primary-path" data-student-current-task={model.current.task.id} data-student-home-primary-path>
        <div className="role-home-card-head">
          <div>
            <span className="role-home-kicker">我正在学什么</span>
            <p>{model.current.project.id} · {model.current.project.title}</p>
          </div>
          <span className="role-home-state is-current">{modeLabel}</span>
        </div>

        <div className="student-current-path" aria-label="当前学习位置">
          <span><small>当前项目</small><strong>{model.current.project.title}</strong></span>
          <Icon name="arrow" size={17} />
          <span><small>当前任务</small><strong>{model.current.task.id} · {model.current.task.title}</strong></span>
          <Icon name="arrow" size={17} />
          <span className="is-focus"><small>当前能力节点</small><strong>{model.current.node.id} · {model.current.node.title}</strong></span>
        </div>

        <h1>{model.current.node.title}</h1>
        <p className="student-home-lead">先看清任务，再进入正文；能力图谱保留为辅助入口。</p>

        <div className="student-question-grid">
          <article>
            <span><Icon name="target" size={19} />为什么学</span>
            <p>{model.current.why}</p>
          </article>
          <article>
            <span><Icon name="arrow" size={19} />下一步做什么</span>
            <p>{model.progress.nextRequirement}</p>
          </article>
          <article className="is-wide">
            <span><Icon name="check" size={19} />做到什么算完成</span>
            <p>{model.current.completionStandard}</p>
          </article>
        </div>

        <div className="student-primary-actions">
          <Link
            className="role-home-primary"
            data-primary-action
            data-role-home-primary
            href={model.primaryAction.href}
            aria-label="继续学习"
          >
            <Icon name={model.primaryAction.mode === 'classroom-follow' ? 'follow' : 'play'} size={21} />
            {model.primaryAction.label}
            <Icon name="arrow" size={19} />
          </Link>
          <small>{model.classroomName ? `正在进行：${model.classroomName}` : '从个人阅读位置继续，课堂进度不会覆盖这里。'}</small>
        </div>
      </section>

      <aside className="student-home-side">
        <section className="role-home-card student-progress-card" data-student-home-progress>
          <div className="role-home-card-head">
            <div><span className="role-home-kicker">学习进度</span><h2>{model.progress.stateLabel}{model.progress.stateOrigin === 'demo' ? <small>演示数据</small> : null}</h2></div>
            <strong className="student-progress-value">{model.progress.completionPercent}%</strong>
          </div>
          <div className="role-home-progress" aria-label={`节点完成度 ${model.progress.completionPercent}%`}>
            <i style={{ width: `${model.progress.completionPercent}%` }} />
          </div>
          <dl className="student-score-list">
            <Score demo={model.progress.nodeTestScoreOrigin === 'demo'} label="节点测试最高分" value={model.progress.nodeTestHighestScore} />
            <Score demo={model.progress.taskScoreOrigin === 'demo'} label="任务综合分" value={model.progress.taskCompositeScore} />
            <Score demo={model.progress.projectScoreOrigin === 'demo'} label="项目综合分" value={model.progress.projectCompositeScore} />
          </dl>
          <small className="student-score-policy">任务综合分：{demoTaskScorePolicy.label}；两项齐全后形成。</small>
        </section>

        <section className="role-home-card student-output-card">
          <span className="role-home-kicker">职业化成果</span>
          <h2>{model.taskOutput}</h2>
          <p>完成本任务后汇入项目级成果：</p>
          <strong><Icon name="briefcase" size={19} />{model.projectOutcome}</strong>
        </section>

        <nav className="role-home-card student-recommendations" data-student-home-recommendations aria-label="查看其他任务和课程能力图谱">
          <span className="role-home-kicker">其他入口</span>
          {model.secondaryActions.map((action) => (
            <Link href={action.href} key={action.label}>
              <Icon name={action.icon} size={19} />
              <span><strong>{action.label}</strong><small>{action.label === '课程能力图谱' ? '查看完整课程关系' : '保留当前学习位置'}</small></span>
              <Icon name="arrow" size={17} />
            </Link>
          ))}
        </nav>
      </aside>
    </div>
  );
}

function Score({ demo, label, value }: { demo?: boolean; label: string; value?: number }) {
  return <div><dt>{label}</dt><dd>{value === undefined ? '尚未形成' : Math.round(value)}{demo ? <small>演示数据</small> : null}</dd></div>;
}

function StudentBlocked({ model }: { model: Extract<StudentHomeViewModel, { kind: 'blocked' }> }) {
  return (
    <div className="role-home-body role-home-blocked">
      <section className="role-home-card">
        <Icon name="lock" size={34} />
        <span className="role-home-kicker">学习门禁</span>
        <h1>{model.blocker.title}</h1>
        <p>{model.blocker.detail}</p>
        {model.blocker.requiredNodeIds.length ? <small>需要先完成：{model.blocker.requiredNodeIds.join('、')}</small> : null}
        <nav>{model.secondaryActions.map((action) => <Link href={action.href} key={action.label}>{action.label}</Link>)}</nav>
      </section>
    </div>
  );
}
