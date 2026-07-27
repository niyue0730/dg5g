'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/foundation/icons.tsx';
import {
  demoAudienceLabel,
  demoControlSteps,
  demoStepAddress,
  demoStepOrigin,
  demoTotalDurationSeconds,
  demoWindowName,
  type DemoAudience,
  type DemoAudienceOrigins,
  type DemoControlStep,
} from './demo-control-model.ts';

interface ClassroomStatus {
  activeNodeId?: string;
  revision: number;
  sessionStatus: string;
}

interface HealthItem {
  id: string;
  label: string;
  state: 'idle' | 'checking' | 'healthy' | 'error';
  detail: string;
}

const idleHealth: HealthItem[] = [
  { id: 'actor', label: '教师身份', state: 'idle', detail: '待检查' },
  { id: 'classroom', label: '课堂会话', state: 'idle', detail: '待检查' },
  { id: 'snapshot', label: '数据快照', state: 'idle', detail: '待检查' },
  { id: 'build', label: '页面服务', state: 'idle', detail: '待检查' },
  { id: 'windows', label: '角色窗口', state: 'idle', detail: '待检查' },
];

export function DemoControlClient({
  audienceOrigins,
  displayName,
  initialClassroom,
  sessionId,
}: {
  audienceOrigins: DemoAudienceOrigins;
  displayName: string;
  initialClassroom: ClassroomStatus;
  sessionId: string;
}) {
  const roleWindows = useRef<Partial<Record<DemoAudience, Window>>>({});
  const [currentOrigin, setCurrentOrigin] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [classroom, setClassroom] = useState(initialClassroom);
  const [health, setHealth] = useState(idleHealth);
  const [pending, setPending] = useState<'reset' | 'health' | 'step' | 'open'>();
  const [message, setMessage] = useState('先检查系统、恢复基线，再分别打开教师和学生常驻窗口。');
  const step = demoControlSteps[stepIndex]!;
  const stepTarget = currentOrigin
    ? resolveStepTarget(step, currentOrigin, audienceOrigins)
    : undefined;

  useEffect(() => {
    setCurrentOrigin(window.location.origin);
  }, []);

  async function runHealthCheck() {
    if (pending) return;
    setPending('health');
    setHealth((items) => items.map((item) => ({ ...item, state: 'checking', detail: '检查中' })));
    try {
      const checks = await Promise.all([
        checkEndpoint('actor', '教师身份', '/api/auth/me', (body) => actorIsTeacher(body)),
        checkEndpoint(
          'classroom',
          '课堂会话',
          `/api/class-sessions/${encodeURIComponent(sessionId)}`,
          (body) => Boolean(classroomFrom(body)),
        ),
        checkEndpoint(
          'snapshot',
          '数据快照',
          `/api/snapshot?audience=teacher&sessionId=${encodeURIComponent(sessionId)}`,
          (body) => Boolean(body && typeof body === 'object'),
        ),
        checkEndpoint('build', '页面服务', '/api/build-info', (body) => Boolean(body && typeof body === 'object')),
        Promise.resolve(checkRoleWindows(window.location.origin, audienceOrigins)),
      ]);
      setHealth(checks);
      const current = await readClassroom(sessionId);
      setClassroom(current);
      const errors = checks.filter(({ state }) => state === 'error').length;
      setMessage(errors
        ? `检查完成：${errors}项异常，请先处理后再演示。`
        : '检查通过：身份、课堂、数据、页面服务和角色窗口均可用。');
    } catch (error) {
      setMessage(errorMessage(error, '系统检查失败'));
    } finally {
      setPending(undefined);
    }
  }

  async function resetDemo() {
    if (pending || !window.confirm('恢复标准演示数据并清理当前课堂运行状态？')) return;
    setPending('reset');
    try {
      const response = await fetch('/api/demo/reset', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'RESET_THREE_DEMO_STUDENTS' }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `重置失败（${response.status}）`);
      const current = await readClassroom(sessionId);
      setClassroom(current);
      setStepIndex(0);
      setMessage('标准演示数据已恢复：学生一未开始、学生二退回修订、学生三完整达成。');
    } catch (error) {
      setMessage(errorMessage(error, '演示数据重置失败'));
    } finally {
      setPending(undefined);
    }
  }

  async function moveTo(nextIndex: number) {
    if (pending || nextIndex < 0 || nextIndex >= demoControlSteps.length) return;
    const nextStep = demoControlSteps[nextIndex]!;
    setPending('step');
    try {
      const nextClassroom = nextStep.prepareNodeId
        ? await prepareLesson(sessionId, nextStep.prepareNodeId)
        : await readClassroom(sessionId);
      setClassroom(nextClassroom);
      setStepIndex(nextIndex);
      setMessage(nextStep.prepareNodeId
        ? `第${nextStep.order}步已准备：课堂定位到${nextStep.prepareNodeId}。`
        : `已切换到第${nextStep.order}步。`);
    } catch (error) {
      setMessage(errorMessage(error, `第${nextStep.order}步准备失败`));
    } finally {
      setPending(undefined);
    }
  }

  async function copyStepAddress(targetStep: DemoControlStep = step) {
    const target = resolveStepTarget(targetStep, window.location.origin, audienceOrigins);
    if (target.error || !target.address) {
      setMessage(target.error ?? '当前步骤缺少有效入口。');
      return;
    }
    try {
      await navigator.clipboard.writeText(target.address);
      setMessage(`${demoAudienceLabel(targetStep.audience)}地址已复制。`);
    } catch {
      setMessage(`请复制此地址：${target.address}`);
    }
  }

  async function openStep() {
    const target = resolveStepTarget(step, window.location.origin, audienceOrigins);
    if (target.error || !target.address) {
      setMessage(target.error ?? '当前步骤缺少有效入口。');
      return;
    }
    const roleWindow = acquireRoleWindow(
      step.audience,
      demoWindowName(step.audience),
      roleWindows.current,
    );
    if (!roleWindow) {
      setMessage('浏览器阻止了窗口打开，请允许本站弹出窗口后重试。');
      return;
    }

    setPending('open');
    try {
      const address = step.audience === 'student03'
        ? await createStudentLaunchAddress(step.route, new URL(target.address).origin)
        : target.address;
      navigateRoleWindow(roleWindow, address);
      setMessage(step.audience === 'student03'
        ? '学生三窗口已自动登录并进入当前阶段，教师控制台保持登录。'
        : `已进入${demoAudienceLabel(step.audience)}当前阶段。`);
    } catch (error) {
      navigateRoleWindow(roleWindow, target.address);
      setMessage(errorMessage(error, '自动打开失败，已转到普通登录入口'));
    } finally {
      setPending(undefined);
    }
  }

  const healthyCount = health.filter(({ state }) => state === 'healthy').length;

  return (
    <main className="demo-control-shell role-home-shell" data-demo-control data-motion="paused">
      <header className="demo-control-topbar">
        <Link className="role-home-brand" href="/teacher/workbench">
          <span>DG</span>
          <strong>内部演示控制台</strong>
          <small>不进入业务导航</small>
        </Link>
        <div className="demo-control-title">
          <strong>5G网络优化（高级）</strong>
          <small>9步半自动演示 · 约{Math.round(demoTotalDurationSeconds / 60)}分钟</small>
        </div>
        <div className="demo-control-actor"><Icon name="teacher" size={18} /><span>{displayName}</span></div>
      </header>

      <div className="demo-control-body">
        <aside className="demo-control-steps" aria-label="演示步骤">
          <div className="demo-control-panel-head">
            <span>演示进度</span>
            <strong>{step.order} / {demoControlSteps.length}</strong>
          </div>
          <ol>
            {demoControlSteps.map((item, index) => (
              <li className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-done' : ''} key={item.id}>
                <button disabled={Boolean(pending)} onClick={() => void moveTo(index)} type="button">
                  <span>{item.order}</span>
                  <div><strong>{item.title}</strong><small>{demoAudienceLabel(item.audience)} · {item.durationSeconds}秒</small></div>
                  {index < stepIndex ? <Icon name="check" size={16} /> : null}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="demo-control-stage">
          <div className="demo-control-current">
            <div className="demo-control-current-head">
              <div>
                <span>当前步骤 · {demoAudienceLabel(step.audience)}</span>
                <h1>{step.order}. {step.title}</h1>
              </div>
              <strong>{step.durationSeconds}秒</strong>
            </div>
            <div className="demo-control-script">
              <article><small>这一段要证明</small><p>{step.purpose}</p></article>
              <article><small>页面重点展示</small><p>{step.show}</p></article>
            </div>
            <div className="demo-control-route">
              <Icon name={step.audience === 'projector' ? 'projector' : step.audience === 'teacher' ? 'teacher' : 'screen'} size={20} />
              <code>{step.route}</code>
              <span className={stepTarget?.error ? 'is-error' : ''}>
                {stepTarget?.error ?? stepTarget?.origin ?? '正在识别角色入口'}
              </span>
            </div>
            <div className="demo-control-actions">
              <button disabled={Boolean(pending) || stepIndex === 0} onClick={() => void moveTo(stepIndex - 1)} type="button">
                上一步
              </button>
              <button disabled={Boolean(stepTarget?.error)} onClick={() => void copyStepAddress()} type="button"><Icon name="link" size={17} />复制地址</button>
              <button disabled={Boolean(stepTarget?.error) || Boolean(pending)} onClick={() => void openStep()} type="button">
                <Icon name="screen" size={17} />{pending === 'open' ? '正在打开…' : openButtonLabel(step.audience)}
              </button>
              <button className="is-primary" disabled={Boolean(pending) || stepIndex === demoControlSteps.length - 1} onClick={() => void moveTo(stepIndex + 1)} type="button">
                {pending === 'step' ? '正在准备…' : '下一步'}<Icon name="arrow" size={17} />
              </button>
            </div>
            <p className="demo-control-message" aria-live="polite">{message}</p>
          </div>

          <div className="demo-control-status-grid">
            <section>
              <div className="demo-control-panel-head"><span>演示准备</span><strong>{healthyCount} / {health.length}</strong></div>
              <div className="demo-control-prepare-actions">
                <button disabled={Boolean(pending)} onClick={() => void runHealthCheck()} type="button">
                  <Icon name="radio" size={18} />{pending === 'health' ? '正在检查…' : '检查系统'}
                </button>
                <button className="is-warning" disabled={Boolean(pending)} onClick={() => void resetDemo()} type="button">
                  <Icon name="close" size={17} />{pending === 'reset' ? '正在恢复…' : '恢复演示基线'}
                </button>
              </div>
              <div className="demo-control-health">
                {health.map((item) => (
                  <div className={`is-${item.state}`} key={item.id}>
                    <i /><span><strong>{item.label}</strong><small>{item.detail}</small></span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="demo-control-panel-head"><span>当前课堂</span><strong>{classroom.sessionStatus}</strong></div>
              <dl>
                <div><dt>会话</dt><dd>{sessionId}</dd></div>
                <div><dt>能力节点</dt><dd>{classroom.activeNodeId ?? '尚未开始'}</dd></div>
                <div><dt>状态版本</dt><dd>r{classroom.revision}</dd></div>
              </dl>
              <div className="demo-control-window-guide">
                <span><Icon name="teacher" size={17} />教师窗口：{audienceOrigin('teacher', currentOrigin, audienceOrigins)} · teacher01</span>
                <span><Icon name="user" size={17} />学生窗口：{audienceOrigin('student03', currentOrigin, audienceOrigins)} · student03</span>
                <span><Icon name="projector" size={17} />投屏窗口：{audienceOrigin('projector', currentOrigin, audienceOrigins)} · 教师身份</span>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

async function checkEndpoint(
  id: string,
  label: string,
  url: string,
  validate: (body: unknown) => boolean,
): Promise<HealthItem> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const body = await response.json().catch(() => undefined);
    const healthy = response.ok && validate(body);
    return {
      id,
      label,
      state: healthy ? 'healthy' : 'error',
      detail: healthy ? `正常 · ${response.status}` : `异常 · ${response.status}`,
    };
  } catch {
    return { id, label, state: 'error', detail: '无法连接' };
  }
}

function actorIsTeacher(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const record = body as { actor?: { role?: string }; role?: string };
  return record.actor?.role === 'teacher' || record.role === 'teacher';
}

async function readClassroom(sessionId: string): Promise<ClassroomStatus> {
  const response = await fetch(`/api/class-sessions/${encodeURIComponent(sessionId)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as {
    error?: string;
    session?: {
      activeNodeId?: string;
      sessionStatus?: string;
      lessonState?: { revision?: number };
    };
  };
  if (!response.ok) throw new Error(body.error ?? `课堂读取失败（${response.status}）`);
  const current = classroomFrom(body);
  if (!current) throw new Error('课堂状态缺少有效版本。');
  return current;
}

function classroomFrom(body: unknown): ClassroomStatus | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const session = (body as {
    session?: {
      activeNodeId?: unknown;
      sessionStatus?: unknown;
      lessonState?: { revision?: unknown };
    };
  }).session;
  const revision = session?.lessonState?.revision;
  if (!Number.isInteger(revision) || Number(revision) < 0) return undefined;
  return {
    ...(typeof session?.activeNodeId === 'string' ? { activeNodeId: session.activeNodeId } : {}),
    revision: Number(revision),
    sessionStatus: typeof session?.sessionStatus === 'string' ? session.sessionStatus : 'unknown',
  };
}

async function prepareLesson(sessionId: string, nodeId: string): Promise<ClassroomStatus> {
  let current = await readClassroom(sessionId);
  if (current.sessionStatus === 'active' && current.activeNodeId === nodeId) return current;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`/api/class-sessions/${encodeURIComponent(sessionId)}/lesson`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, expectedRevision: current.revision }),
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      currentRevision?: number;
      session?: {
        activeNodeId?: string;
        sessionStatus?: string;
        lessonState?: { revision?: number };
      };
    };
    if (response.status === 409 && attempt === 0) {
      current = await readClassroom(sessionId);
      continue;
    }
    if (!response.ok) throw new Error(body.error ?? `课堂准备失败（${response.status}）`);
    const prepared = classroomFrom(body);
    if (!prepared || prepared.activeNodeId !== nodeId || prepared.sessionStatus !== 'active') {
      throw new Error('课堂没有进入指定能力节点。');
    }
    return prepared;
  }
  throw new Error('课堂状态冲突，请检查后重试。');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? `${fallback}：${error.message}` : fallback;
}

function openButtonLabel(audience: DemoControlStep['audience']): string {
  return {
    public: '打开页面',
    student03: '打开学生窗口',
    teacher: '打开教师端',
    projector: '打开投屏端',
  }[audience];
}

function resolveStepTarget(
  step: Pick<DemoControlStep, 'audience' | 'route'>,
  currentOrigin: string,
  audienceOrigins: DemoAudienceOrigins,
): { address?: string; origin?: string; error?: string } {
  try {
    const address = demoStepAddress(step, currentOrigin, audienceOrigins);
    return { address, origin: new URL(address).origin };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '角色入口配置无效。' };
  }
}

function audienceOrigin(
  audience: DemoAudience,
  currentOrigin: string,
  audienceOrigins: DemoAudienceOrigins,
): string {
  if (!currentOrigin) return '正在识别';
  const target = resolveStepTarget({ audience, route: '/' }, currentOrigin, audienceOrigins);
  return target.error ?? target.origin ?? '未配置';
}

function checkRoleWindows(
  currentOrigin: string,
  audienceOrigins: DemoAudienceOrigins,
): HealthItem {
  try {
    const teacherOrigin = demoStepOrigin(
      { audience: 'teacher', route: '/' },
      currentOrigin,
      audienceOrigins,
    );
    const studentOrigin = demoStepOrigin(
      { audience: 'student03', route: '/' },
      currentOrigin,
      audienceOrigins,
    );
    if (new URL(teacherOrigin).hostname === new URL(studentOrigin).hostname) {
      throw new Error('教师端与学生端主机名相同');
    }
    demoStepOrigin({ audience: 'projector', route: '/' }, currentOrigin, audienceOrigins);
    return { id: 'windows', label: '角色窗口', state: 'healthy', detail: '教师/学生已隔离' };
  } catch (error) {
    return {
      id: 'windows',
      label: '角色窗口',
      state: 'error',
      detail: error instanceof Error ? error.message : '入口配置无效',
    };
  }
}

function acquireRoleWindow(
  audience: DemoAudience,
  windowName: string,
  roleWindows: Partial<Record<DemoAudience, Window>>,
): Window | null {
  let roleWindow = roleWindows[audience];
  if (!roleWindow || roleWindow.closed) {
    roleWindow = window.open('about:blank', windowName) ?? undefined;
  } else {
    try {
      roleWindow.focus();
    } catch {
      roleWindow = window.open('about:blank', windowName) ?? undefined;
    }
  }
  if (!roleWindow) return null;
  roleWindows[audience] = roleWindow;
  roleWindow.focus();
  return roleWindow;
}

function navigateRoleWindow(roleWindow: Window, address: string): void {
  roleWindow.location.href = address;
  roleWindow.focus();
}

async function createStudentLaunchAddress(
  returnPath: string,
  expectedOrigin: string,
): Promise<string> {
  const response = await fetch('/api/demo/launch-ticket', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audience: 'student03', returnPath }),
  });
  const body = await response.json().catch(() => ({})) as {
    error?: string;
    launchUrl?: string;
  };
  if (!response.ok || typeof body.launchUrl !== 'string') {
    throw new Error(body.error ?? `启动票据签发失败（${response.status}）`);
  }
  const launchUrl = new URL(body.launchUrl);
  if (
    launchUrl.origin !== expectedOrigin
    || launchUrl.pathname !== '/api/demo/launch/redeem'
    || launchUrl.searchParams.getAll('ticket').length !== 1
  ) {
    throw new Error('启动票据返回了错误的学生端地址。');
  }
  return launchUrl.toString();
}
