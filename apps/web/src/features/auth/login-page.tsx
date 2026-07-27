'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Icon } from '@/ui/foundation/icons';
import '../../app/platform-overview.css';

type LoginPageProps = {
  nextPath?: string;
};

const DEFAULT_ACCOUNT = 'student03';
const TRANSIENT_LOGIN_STATUSES = [502, 503, 504] as const;

export function LoginPage({ nextPath }: LoginPageProps) {
  const router = useRouter();
  const [username, setUsername] = useState(DEFAULT_ACCOUNT);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await requestLoginWithRetry({
        username: username.trim(),
        password,
        ...(nextPath ? { next: nextPath } : {}),
      });
      const payload = await response.json().catch(() => null) as {
        home?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof payload?.home !== 'string' || !payload.home.startsWith('/')) {
        setError(typeof payload?.error === 'string' ? payload.error : '登录失败，请稍后重试。');
        return;
      }
      router.replace(payload.home);
      router.refresh();
    } catch {
      setError('登录服务暂时不可用，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="login-page-v3"
      data-login-role="gateway"
      data-motion="paused"
      data-primary-action-policy="exactly-one"
      data-ui-surface="dark"
    >
      <section className="login-scene" aria-labelledby="login-course-title">
        <div className="login-brand-v3">
          <span>DG</span>
          <p><strong id="login-course-title">5G网络优化（高级）</strong><small>职业教育数字教材</small></p>
        </div>
        <div className="login-message">
          <h1>从真实任务进入5G网络优化学习</h1>
          <p>教师授课与学生学习，共用同一套课程、能力状态与任务成果。</p>
        </div>
        <LoginSignalField />
        <div className="login-capabilities" aria-label="教材能力">
          <span><Icon name="map" size={22} />能力图谱</span>
          <span><Icon name="follow" size={22} />课堂同步</span>
          <span><Icon name="briefcase" size={22} />专业实训</span>
        </div>
      </section>

      <form className="login-form-v3" onSubmit={submit}>
        <header>
          <span>5G</span>
          <div><strong>进入教材</strong><small>输入账号和密码，身份由系统自动识别</small></div>
        </header>
        <div className="login-demo-hint" aria-label="演示账号说明">
          <p><strong>完整演示</strong><span>student03 · P1全部内容与成果</span></p>
          <p><strong>过程演示</strong><span>student01 从零学习 · student02 退回修订</span></p>
          <p><strong>教师账号</strong><span>teacher01</span></p>
          <small>以上账号默认密码：123456</small>
        </div>
        <label>
          <span>账号</span>
          <input
            autoCapitalize="none"
            autoComplete="username"
            onChange={(event) => { setUsername(event.target.value); setError(''); }}
            spellCheck={false}
            value={username}
          />
        </label>
        <label>
          <span>密码</span>
          <input
            autoComplete="current-password"
            onChange={(event) => { setPassword(event.target.value); setError(''); }}
            placeholder="请输入演示密码"
            required
            type="password"
            value={password}
          />
        </label>
        {error ? <p className="login-error" role="alert" aria-live="polite">{error}</p> : null}
        <button className="login-submit" data-primary-action disabled={submitting} type="submit">
          {submitting ? '正在验证' : '进入教材'}<Icon name="arrow" size={19} />
        </button>
        <Link className="login-platform-link" href="/platform">
          查看平台总览 <Icon name="arrow" size={16} />
        </Link>
      </form>
    </main>
  );
}

async function requestLoginWithRetry(body: { username: string; password: string; next?: string }) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!TRANSIENT_LOGIN_STATUSES.includes(response.status as 502 | 503 | 504) || attempt === 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('登录服务暂时不可用');
}

function LoginSignalField() {
  return (
    <div className="login-signal-field" aria-hidden="true">
      <svg viewBox="0 0 920 570" role="presentation">
        <g className="signal-grid">
          {Array.from({ length: 12 }, (_, index) => <path d={`M0 ${70 + index * 42}H920`} key={`h-${index}`} />)}
          {Array.from({ length: 18 }, (_, index) => <path d={`M${40 + index * 52} 0V570`} key={`v-${index}`} />)}
        </g>
        <g className="signal-links">
          <path d="M72 390 214 310 352 350 492 224 638 270 824 156" />
          <path d="M90 480 254 426 410 458 558 358 744 392 874 320" />
          <path d="M214 310 254 426M352 350 410 458M492 224 558 358M638 270 744 392" />
        </g>
        <g className="signal-tower" transform="translate(430 172)">
          <path d="M60 250 112 0l52 250M83 132h58M74 174h76M66 216h92" />
          <path d="M112 34c-48 0-86 24-104 62M112 34c48 0 86 24 104 62" />
          <path d="M112 72c-28 0-50 14-62 36M112 72c28 0 50 14 62 36" />
        </g>
        <g className="signal-nodes">
          {[[72,390],[214,310],[352,350],[492,224],[638,270],[824,156],[90,480],[254,426],[410,458],[558,358],[744,392],[874,320]].map(([x,y], index) => <circle cx={x} cy={y} key={index} r={index === 3 ? 8 : 5} />)}
        </g>
      </svg>
      <span className="signal-label is-role"><Icon name="briefcase" size={18} /><b>岗位</b><small>5G无线网络优化工程师</small></span>
      <span className="signal-label is-course"><Icon name="book" size={18} /><b>课程</b><small>P1-P6能力项目</small></span>
      <span className="signal-label is-skill"><Icon name="target" size={18} /><b>技能</b><small>设备识别与优化判断</small></span>
    </div>
  );
}
