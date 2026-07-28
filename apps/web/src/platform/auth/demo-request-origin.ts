export function resolveTrustedDemoRequestOrigin(request: Request): string | null {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return null;

  const requestOrigin = resolveDemoRequestOrigin(request);
  const browserOriginValue = request.headers.get('origin')
    ?? request.headers.get('referer');
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

export function resolveDemoRequestOrigin(request: Request): string {
  const internalOrigin = new URL(request.url).origin;
  if (process.env.DGBOOK_TRUST_PROXY !== '1') return internalOrigin;

  const protocol = firstForwardedValue(request.headers.get('x-forwarded-proto'));
  const host = request.headers.get('host')?.trim();
  if (!host || (protocol !== 'http' && protocol !== 'https')) return internalOrigin;

  try {
    const external = new URL(`${protocol}://${host}`);
    if (external.username || external.password || external.pathname !== '/') return internalOrigin;
    return external.origin;
  } catch {
    return internalOrigin;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

function firstForwardedValue(value: string | null): string {
  return value?.split(',', 1)[0]?.trim().toLowerCase() ?? '';
}
