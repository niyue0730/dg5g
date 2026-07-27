import type { LessonPhase } from '@/platform/models';
import { sessionProfiles } from '@/platform/fixtures/session-profiles';
import {
  p01TeachingPackage,
  teachingPageAt,
  type P01TeachingLesson,
  type P01TeachingPage,
} from './p01-teaching-package.ts';
import {
  classroomTeachingGuides,
  type ClassroomTeachingGuide,
} from './classroom-teaching-guides.ts';

export type LessonSegmentId =
  | 'learning-case'
  | 'learning-visual'
  | 'learning-procedure'
  | 'learning-correction'
  | 'learning-practice'
  | 'learning-output';

export interface ClassroomLessonSegment {
  id: LessonSegmentId;
  label: string;
  eyebrow: string;
  title: string;
  lead: string;
  points: string[];
  checkpoint: string;
  evidence: string;
}

export const p01n02LessonSegments: ClassroomLessonSegment[] = [
  {
    id: 'learning-case',
    label: '问题',
    eyebrow: '现场任务',
    title: '照片怎样证明设备、槽位与端口属于同一条链？',
    lead: '机房照片不是“拍到设备”就完成。必须先确定对象，再把机柜位置、设备身份和端口去向串成可复核证据。',
    points: ['先判断照片中的对象和空间位置', '再确认设备型号与槽位编号', '最后追踪端口标签和走线方向'],
    checkpoint: '只拍设备近景，为什么不能证明它属于机柜02？',
    evidence: '机柜全景、设备铭牌、槽位编号和端口近景必须能够互相回指。',
  },
  {
    id: 'learning-visual',
    label: '看图',
    eyebrow: '拓扑读图',
    title: '沿物理链识别四类关键对象',
    lead: '从左向右阅读设备链：机柜02提供空间定位，BBU槽位3确认基带设备，AAU/RRU承接射频链路，端口与供电接地完成运行关系。',
    points: ['蓝绿色光纤链路连接 BBU 与 AAU/RRU', '射频端口必须同时看端口号和线缆去向', '-48V供电与接地属于运行条件，不可遗漏'],
    checkpoint: '当前高亮对象是 BBU 槽位3，它需要哪两类照片才能被复核？',
    evidence: '全景确定位置，铭牌确定身份，端口近景确定连接。三类证据缺一不可。',
  },
  {
    id: 'learning-procedure',
    label: '步骤',
    eyebrow: '工程方法',
    title: '按“定位—核验—追踪”完成判断',
    lead: '判断顺序不能颠倒。先用全景定位机柜，再用铭牌和槽位号核验设备，最后沿端口标签追踪光纤、射频、电源与接地。',
    points: ['定位：站点、机房、机柜编号同时入镜', '核验：设备铭牌与槽位编号一一对应', '追踪：端口标签、出线方向和对端对象连续可见'],
    checkpoint: '如果先拍端口、后补机柜全景，最容易丢失哪种关系？',
    evidence: '每一步都形成可回查索引，照片序号与采集表字段保持一致。',
  },
  {
    id: 'learning-correction',
    label: '纠偏',
    eyebrow: '反例诊断',
    title: '“设备拍清楚了”仍可能是不合格证据',
    lead: '常见错误是只有设备近景，没有柜号、槽位号或端口去向。照片清晰不等于关系清晰，无法回到现场对象的照片不能支撑结论。',
    points: ['反例：铭牌清楚，但不知道设备位于哪个机柜', '反例：端口清楚，但没有线缆去向和对端标签', '修正：补拍带参照物的中景与连续走线近景'],
    checkpoint: '找出当前证据链中最可能造成“设备孤证”的缺口。',
    evidence: '纠偏后的证据应同时回答“是谁、在哪里、连向哪里”。',
  },
  {
    id: 'learning-practice',
    label: '练习',
    eyebrow: '即时练习',
    title: '把照片证据连接到正确对象',
    lead: '先完成课堂连线、选择与翻卡练习，再进入设备证据链正式测试。系统记录正确率、用时和错因，用于教师讲评。',
    points: ['连线：对象与照片证据建立对应', '选择：判断缺失字段会造成什么风险', '翻卡：匹配设备铭牌、端口标签和采集字段'],
    checkpoint: '练习不是背答案，而是验证你能否独立恢复设备关系。',
    evidence: '练习过程形成辅助证据；节点正式测试达到80分才通过。',
  },
  {
    id: 'learning-output',
    label: '成果整理',
    eyebrow: '节点证据',
    title: '整理一条可复核的设备拓扑节点证据记录',
    lead: '本节点把对象、位置、链路和影像索引整理为节点证据记录，后面会放到P01 N04成果表；它用于支撑后续任务归档，不在N02单独形成任务级成果表。',
    points: ['对象：机柜02、BBU槽位3、AAU/RRU和端口链', '证据：照片编号、铭牌字段、端口标签和走线方向', '结论：关系是否闭合、缺口在哪里、下一步怎么复核'],
    checkpoint: '用一句职业化结论说明当前链路是否具备复核条件。',
    evidence: '记录完成后保留为N02学习证据；到P01 N04再与运行条件、影像索引和归档结论合并。',
  },
];

export function lessonSegmentAt(actionIndex: number | undefined): ClassroomLessonSegment {
  const index = Math.max(0, Math.min(p01n02LessonSegments.length - 1, Math.trunc(actionIndex ?? 0)));
  return p01n02LessonSegments[index]!;
}

export function phaseLabel(phase: LessonPhase | undefined): string {
  const labels: Record<LessonPhase, string> = {
    prepare: '课前准备',
    lecture: '教师讲解',
    question: '课堂提问',
    practice: '学生练习',
    challenge: '正式测试',
    review: '教师讲评',
    close: '本课完成',
  };
  return labels[phase ?? 'prepare'];
}

const genericPageSegments: readonly LessonSegmentId[] = [
  'learning-case',
  'learning-visual',
  'learning-procedure',
  'learning-correction',
  'learning-output',
];

const genericPageMinutes = [6, 9, 10, 10, 10] as const;

type SessionProfile = {
  slides: readonly (readonly [title: string, subtitle: string, focus: string])[];
};

type GenericTeachingCopy = Pick<
  P01TeachingPage,
  'teacherExplanation' | 'caseQuestion' | 'typicalAnswer' | 'followUpPrompts' | 'studentAction'
> & { projectorPrompt: string };

export function classroomTeachingPagesForNode(nodeId: string): P01TeachingPage[] {
  if (nodeId === 'P1T1-N02') return p01TeachingPackage.flatMap(({ pages }) => pages);
  const profile = (sessionProfiles as Record<string, SessionProfile | undefined>)[nodeId];
  const guide = (classroomTeachingGuides as Record<string, ClassroomTeachingGuide | undefined>)[nodeId];
  if (!profile || !guide) return [];
  return profile.slides.map(([title, subtitle, focus], index) => {
    const nextTitle = profile.slides[index + 1]?.[0];
    const pageNumber = index + 1;
    const copy = genericTeachingCopyAt(index, title, subtitle, focus, guide);
    return {
      id: `${nodeId}-S${String(pageNumber).padStart(2, '0')}`,
      lessonNumber: 1,
      pageNumber,
      globalPageNumber: pageNumber,
      suggestedMinutes: genericPageMinutes[index] ?? 9,
      segmentId: genericPageSegments[index] ?? 'learning-output',
      title,
      projectorContent: {
        title,
        material: `${subtitle}。${focus}`,
        visualCallouts: [subtitle, focus],
        prompt: copy.projectorPrompt,
      },
      teacherExplanation: copy.teacherExplanation,
      caseQuestion: copy.caseQuestion,
      typicalAnswer: copy.typicalAnswer,
      commonErrors: [
        `${title}：${guide.commonErrors[index % guide.commonErrors.length]}`,
        `${subtitle}：${guide.commonErrors[(index + 1) % guide.commonErrors.length]}`,
      ],
      followUpPrompts: copy.followUpPrompts,
      studentAction: copy.studentAction,
      transition: nextTitle
        ? `本页完成标志：学生能用“${subtitle}”说明当前判断边界。确认后进入“${nextTitle}”。`
        : `本节点讲解结束。学生应带着五页记录回到完整教材，完成练习并${guide.closing}。`,
    };
  });
}

function genericTeachingCopyAt(
  index: number,
  title: string,
  subtitle: string,
  focus: string,
  guide: ClassroomTeachingGuide,
): GenericTeachingCopy {
  const frames: Array<() => GenericTeachingCopy> = [
    () => ({
      projectorPrompt: `先不下结论：从“${subtitle}”中找出本页必须确认的对象、范围或条件。`,
      teacherExplanation: `${guide.context}进入“${title}”时先制造一个判断停顿：材料看起来已经给出线索，但还不能直接写结论。${focus}教师先带学生圈出对象和边界，再用${guide.evidenceLabel}说明本页最多能确认到哪一步。`,
      caseQuestion: `如果现在就根据“${subtitle}”下结论，最可能遗漏哪个对象、范围或条件？${guide.caseQuestion}`,
      typicalAnswer: `本页首先确认“${subtitle}”，并把它放回当前任务的对象和边界中。${guide.answerRule}因此只记录当前材料能够直接支持的事实，把尚未证明的部分登记为待补或待复核，再进入下一步。`,
      followUpPrompts: [
        `材料中的哪一个词决定了本页的对象或范围？`,
        `如果拿掉“${subtitle}”，当前判断还剩下什么依据？`,
      ],
      studentAction: `在投屏材料上圈出本页对象、范围和限制条件；用一句话写出“目前能确认什么、还不能确认什么”。`,
    }),
    () => ({
      projectorPrompt: `把“${subtitle}”拆成可回查证据：每项分别来自哪里，能够证明什么？`,
      teacherExplanation: `第二页“${title}”不再停留在看材料，而是训练证据回指。${guide.teachingMove}${focus}教师逐项追问来源、对象和证明作用，让学生把${guide.evidenceLabel}与具体字段对应，避免一份材料被笼统地挂到所有结论上。`,
      caseQuestion: `“${subtitle}”中哪一项是直接事实，哪一项仍需要其他材料交叉确认？为什么？`,
      typicalAnswer: `应先把“${subtitle}”拆成独立证据，再分别说明来源和证明对象。${guide.answerRule}只有来源可回查、对象能对应、证明范围不越界的内容才进入记录，其余内容保留为证据缺口。`,
      followUpPrompts: [
        `这项${guide.evidenceLabel}能够证明哪个字段，不能证明哪个字段？`,
        `${guide.followUp}`,
      ],
      studentAction: `为本页每项材料标注“来源—证明对象—可写结论”，并指出至少一项不能由当前材料直接证明的内容。`,
    }),
    () => ({
      projectorPrompt: `请按实际工作顺序排列本页动作，并在每一步写出需要留下的记录。`,
      teacherExplanation: `第三页“${title}”把判断转换为可执行步骤。${focus}教师先让学生独立排序，再说明为什么顺序不能颠倒；每完成一步都必须留下可回查的${guide.evidenceLabel}，遇到权限、来源或条件不足时立即停在待复核状态。`,
      caseQuestion: `如果把“${subtitle}”放到流程最后，前面的记录会失去什么依据或产生什么风险？`,
      typicalAnswer: `正确做法是按对象确认、证据核对、状态判断和记录留痕的顺序推进。${guide.answerRule}步骤之间必须能前后承接；前置依据缺失时不能跳到结果页，更不能用经验补齐。`,
      followUpPrompts: [
        `哪一步是后续动作的前置条件，缺失后必须停止？`,
        `完成这一步后，记录中应新增哪一项${guide.evidenceLabel}？`,
      ],
      studentAction: `把本页动作排成可执行顺序，并为每一步补写“输入材料、操作动作、留下的记录和停止条件”。`,
    }),
    () => ({
      projectorPrompt: `找出当前做法中最危险的错误，并说明它是事实错误、证据不足还是权限越界。`,
      teacherExplanation: `第四页“${title}”专门用于纠偏。教师先呈现一个看似完整但无法复核的做法，再让学生依据“${subtitle}”定位错误类型。${focus}讲评时必须区分事实冲突、证据不足和权限不足，因为三种情况对应的修正动作不同。`,
      caseQuestion: `当前材料为什么不能直接支持结论？它属于事实冲突、证据不足还是权限不足，应怎样修正？`,
      typicalAnswer: `应先保留“${subtitle}”已经证明的部分，再指出缺失或冲突位置。${guide.answerRule}事实冲突要复查原始材料，证据不足要补采或补挂接，权限不足则交由授权人员处理，三者都不能用猜测填平。`,
      followUpPrompts: [
        `这个错误如果进入最终成果，会误导后续哪个岗位动作？`,
        `最小修正动作是什么：改文字、补证据，还是重新取得授权？`,
      ],
      studentAction: `给反例标注错误类型，删除越界结论，并写出一条能够真正修复当前缺口的下一步动作。`,
    }),
    () => ({
      projectorPrompt: `按提交标准检查本页成果：依据是否可回查、边界是否写清、下一步是否可执行？`,
      teacherExplanation: `最后一页“${title}”把前四页学习收束到可提交成果。${focus}教师带学生逐项检查${guide.evidenceLabel}、判断边界和交接动作，强调保存、提交、退回和确认是不同状态；只有内容与来源同时完整，成果才具备复核条件。`,
      caseQuestion: `如果把“${subtitle}”交给另一名同事，他能否不再追问就继续工作？还缺哪一项来源、边界或责任信息？`,
      typicalAnswer: `成果必须让接手人员看见对象、依据、判断边界和下一步动作。${guide.answerRule}满足后才能提交；仍有缺口时应明确登记待复核内容，不能为了页面完整而把未确认信息写成确定事实。`,
      followUpPrompts: [
        `哪一项字段能够证明本页成果不是凭空填写？`,
        `提交后若被退回，应修改结论、补充证据，还是两者同时进行？`,
      ],
      studentAction: `${guide.studentAction}提交前按“有来源、有边界、可执行”三项标准自检，并向同伴口头说明本页完成依据。`,
    }),
  ];
  return (frames[index] ?? frames[frames.length - 1])();
}

export function classroomTeachingPageAt(nodeId: string, pageIndex: number | undefined): P01TeachingPage {
  const pages = classroomTeachingPagesForNode(nodeId);
  if (pages.length === 0) throw new Error(`No classroom teaching package for ${nodeId}`);
  const index = Math.max(0, Math.min(pages.length - 1, Math.trunc(pageIndex ?? 0)));
  return pages[index]!;
}

export {
  p01TeachingPackage,
  teachingPageAt,
  type P01TeachingLesson,
  type P01TeachingPage,
};
