import { issueDemoStudentLaunch } from '@/features/demo-control/demo-student-launch-server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const url = new URL(request.url);
  if (
    [...url.searchParams.keys()].some(
      (key) => key !== 'returnPath' && key !== 'sourceOrigin',
    )
    || url.searchParams.getAll('returnPath').length !== 1
    || url.searchParams.getAll('sourceOrigin').length !== 1
  ) {
    return json({ error: 'Invalid demo launch request' }, 400);
  }
  const returnPath = url.searchParams.get('returnPath');
  const sourceOrigin = url.searchParams.get('sourceOrigin');
  if (!returnPath || !sourceOrigin) {
    return json({ error: 'Invalid demo launch request' }, 400);
  }

  const launchHeaders = new Headers(request.headers);
  launchHeaders.set('origin', sourceOrigin);
  const launch = issueDemoStudentLaunch(
    new Request(request, { headers: launchHeaders }),
    returnPath,
  );
  if (!launch.ok) return json({ error: launch.error }, launch.status);

  return new Response(launchBridge(launch.launchUrl), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function launchBridge(launchUrl: string): string {
  const escapedUrl = escapeHtmlAttribute(launchUrl);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="refresh" content="0; url=${escapedUrl}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>正在进入教材</title>
  <style>body{font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center;margin:0;color:#334155}</style>
</head>
<body><a href="${escapedUrl}">正在进入当前演示阶段，如未自动跳转请点此继续</a></body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
