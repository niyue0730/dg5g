export function resolveTrustedDemoRequestOrigin(request: Request): string | null {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return null;

  const requestOrigin = new URL(request.url).origin;
  const browserOriginValue = request.headers.get('origin');
  if (!browserOriginValue) return requestOrigin;

  let browserOrigin: URL;
  try {
    browserOrigin = new URL(browserOriginValue);
  } catch {
    return null;
  }
  if (browserOrigin.origin === requestOrigin) return browserOrigin.origin;

  const requestUrl = new URL(requestOrigin);
  if (
    isLoopbackHost(requestUrl.hostname)
    && isLoopbackHost(browserOrigin.hostname)
    && requestUrl.protocol === browserOrigin.protocol
    && effectivePort(requestUrl) === effectivePort(browserOrigin)
  ) {
    return browserOrigin.origin;
  }
  return null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}
