'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export function DemoStartClient() {
  const started = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const encodedKey = window.location.hash.slice(1);
    const key = decodeHashKey(encodedKey);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

    void fetch('/api/demo/presenter-session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(key ? { key } : {}),
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        home?: string;
      };
      if (!response.ok || body.home !== '/teacher/demo-control') {
        throw new Error(body.error ?? `演示启动失败（${response.status}）`);
      }
      window.location.replace(body.home);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '演示启动失败');
    });
  }, []);

  return (
    <main className="demo-start-shell" data-motion="paused">
      <div className="demo-start-mark">DG</div>
      <h1>{error ? '演示入口不可用' : '正在准备演示'}</h1>
      <p>{error || '正在建立教师控制台与多角色演示环境。'}</p>
      {error ? <Link href="/">返回教材入口</Link> : <span aria-hidden="true" />}
    </main>
  );
}

function decodeHashKey(value: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
