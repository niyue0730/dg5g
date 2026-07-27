export type DemoAudience = 'public' | 'student03' | 'teacher' | 'projector';
export type DemoAudienceOrigins = Partial<Record<DemoAudience, string>>;

export interface DemoControlStep {
  id: string;
  order: number;
  title: string;
  durationSeconds: number;
  audience: DemoAudience;
  route: string;
  purpose: string;
  show: string;
  prepareNodeId?: string;
}

export const demoControlSteps: readonly DemoControlStep[] = [
  {
    id: 'platform',
    order: 1,
    title: '平台总览',
    durationSeconds: 30,
    audience: 'public',
    route: '/platform',
    purpose: '先说明这是一套数字教材生产与应用体系，不是单一电子书。',
    show: '输入材料、内容治理、能力图谱、资源生成、数字教材、教学应用和数据回收。',
  },
  {
    id: 'student-home',
    order: 2,
    title: '学生学习入口',
    durationSeconds: 45,
    audience: 'student03',
    route: '/student/home',
    purpose: '回答学生进入系统后最先关心的学习位置、目标、下一步和完成标准。',
    show: '当前项目、当前任务、能力节点、继续学习入口和课程能力图谱入口。',
  },
  {
    id: 'project',
    order: 3,
    title: 'P1项目任务链',
    durationSeconds: 45,
    audience: 'student03',
    route: '/student/projects/p1',
    purpose: '说明数字教材按真实工作任务组织，而不是按页面或媒体类型堆放。',
    show: 'P01、P02、P03三项任务的前后关系，以及项目最终成果。',
  },
  {
    id: 'graph',
    order: 4,
    title: '课程能力图谱',
    durationSeconds: 60,
    audience: 'student03',
    route: '/course',
    purpose: '展示项目、节点、教材、练习、评价和成果之间的暗线关系。',
    show: '选中P1T1-N02后，查看教材内容、学习活动、正式测试和成果映射。',
    prepareNodeId: 'P1T1-N02',
  },
  {
    id: 'self-study',
    order: 5,
    title: '完整自学节点',
    durationSeconds: 120,
    audience: 'student03',
    route: '/learn/P1T1-N02',
    purpose: '证明学生能够依靠数字教材完成理解、练习、纠偏和成果形成。',
    show: '问题、看图、步骤、纠偏、练习、成果六段内容，以及完整演示状态。',
    prepareNodeId: 'P1T1-N02',
  },
  {
    id: 'teacher',
    order: 6,
    title: '教师组织授课',
    durationSeconds: 90,
    audience: 'teacher',
    route: '/teacher/sessions/demo-class',
    purpose: '说明教师端按课堂讲授逻辑重新组织同一能力节点。',
    show: '授课页、讲稿、学情、批阅和课堂控制，不照搬学生自学正文。',
    prepareNodeId: 'P1T1-N02',
  },
  {
    id: 'projector',
    order: 7,
    title: '投屏同步',
    durationSeconds: 45,
    audience: 'projector',
    route: '/present/demo-class',
    purpose: '展示教师翻页与课堂公共画面使用同一授课状态。',
    show: '当前教学页、上一页、下一页、全屏和返回教师端。',
    prepareNodeId: 'P1T1-N02',
  },
  {
    id: 'student-follow',
    order: 8,
    title: '学生课堂跟随',
    durationSeconds: 60,
    audience: 'student03',
    route: '/classroom/demo-class',
    purpose: '展示学生跟随教师当前页面，同时保留独立自主学习位置。',
    show: '进入课堂、跟随模式、自主浏览和恢复课堂跟随。',
    prepareNodeId: 'P1T1-N02',
  },
  {
    id: 'portfolio',
    order: 9,
    title: '职业成果闭环',
    durationSeconds: 75,
    audience: 'student03',
    route: '/student/projects/p1/portfolio',
    purpose: '用成果包收束学习、练习、评价、教师反馈和版本修订。',
    show: 'P01至P03三份认证成果、P01 V1/V2差异、证据、批注和项目综合分。',
  },
] as const;

export const demoTotalDurationSeconds = demoControlSteps.reduce(
  (total, step) => total + step.durationSeconds,
  0,
);

export function demoAudienceLabel(audience: DemoAudience): string {
  return {
    public: '公开页面',
    student03: '学生三窗口',
    teacher: '教师窗口',
    projector: '投屏窗口',
  }[audience];
}

export function demoStepAddress(
  step: Pick<DemoControlStep, 'audience' | 'route'>,
  currentOrigin: string,
  audienceOrigins: DemoAudienceOrigins = {},
): string {
  const current = new URL(currentOrigin);
  let targetOrigin = audienceOrigins[step.audience];

  if (!targetOrigin && step.audience === 'student03') {
    if (current.hostname === '127.0.0.1') {
      const localStudent = new URL(current.origin);
      localStudent.hostname = 'localhost';
      targetOrigin = localStudent.origin;
    } else if (current.hostname === 'localhost') {
      const localStudent = new URL(current.origin);
      localStudent.hostname = '127.0.0.1';
      targetOrigin = localStudent.origin;
    } else {
      throw new Error('公网演示必须配置独立的学生端域名。');
    }
  }

  const target = new URL(step.route, targetOrigin ?? current.origin);
  if (step.audience === 'student03' && target.hostname === current.hostname) {
    throw new Error('学生端与教师控制台必须使用不同主机名，避免登录身份互相覆盖。');
  }
  return target.toString();
}

export function demoStepOrigin(
  step: Pick<DemoControlStep, 'audience' | 'route'>,
  currentOrigin: string,
  audienceOrigins: DemoAudienceOrigins = {},
): string {
  return new URL(demoStepAddress(step, currentOrigin, audienceOrigins)).origin;
}

export function demoWindowName(audience: DemoAudience): string {
  return {
    public: 'dgbook-public-demo',
    student03: 'dgbook-student03-demo',
    teacher: 'dgbook-teacher-demo',
    projector: 'dgbook-projector-demo',
  }[audience];
}
