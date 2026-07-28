import type { DemoAudience, DemoAudienceOrigins } from './demo-control-model.ts';

const originEnvironment: Readonly<Record<DemoAudience, string>> = {
  public: 'DGBOOK_DEMO_PUBLIC_ORIGIN',
  student03: 'DGBOOK_DEMO_STUDENT_ORIGIN',
  teacher: 'DGBOOK_DEMO_TEACHER_ORIGIN',
  projector: 'DGBOOK_DEMO_PROJECTOR_ORIGIN',
};

export function readDemoAudienceOrigins(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DemoAudienceOrigins {
  const origins: DemoAudienceOrigins = {};
  const allowInsecureHttp = environment.DGBOOK_DEMO_ALLOW_INSECURE_HTTP === '1';
  for (const audience of Object.keys(originEnvironment) as DemoAudience[]) {
    const name = originEnvironment[audience];
    const value = environment[name]?.trim();
    if (value) origins[audience] = validateDemoOrigin(name, value, { allowInsecureHttp });
  }
  return origins;
}

export function validateDemoOrigin(
  name: string,
  value: string,
  options: { allowInsecureHttp?: boolean } = {},
): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error(`${name}必须是完整URL。`);
  }
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error(`${name}只能配置协议、主机名和端口。`);
  }
  const loopback = origin.hostname === '127.0.0.1'
    || origin.hostname === 'localhost'
    || origin.hostname === '[::1]';
  const permittedHttp = origin.protocol === 'http:'
    && (loopback || options.allowInsecureHttp === true);
  if (origin.protocol !== 'https:' && !permittedHttp) {
    throw new Error(`${name}在公网环境必须使用HTTPS。`);
  }
  return origin.origin;
}
