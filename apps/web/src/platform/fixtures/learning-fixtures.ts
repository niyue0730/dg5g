import type { AbilityNode, Activity, ActivityQuestion, Assessment, OutputMode, ResourceCard, RouteTarget } from '../models';
import { nodes, tasks } from './base-fixtures';

export const resources: ResourceCard[] = nodes.flatMap((node) => resourcesForNode(node));
export const activities: Activity[] = nodes.map((node) => activityForNode(node));
export const assessments: Assessment[] = nodes.map((node) => assessmentForNode(node));

function resourcesForNode(node: AbilityNode): ResourceCard[] {
  const task = tasks.find((item) => item.taskId === node.taskId);
  const label = `${node.taskId} ${node.shortTitle}`;
  const summary = task ? `${node.goal}。${task.conclusion}` : node.goal;
  return [
    resource(`R-${node.nodeId}-SELF`, node, `${label} 学生正文`, summary, 'student-page', 'direct-render', {
      kind: 'node',
      href: `/learn/${node.nodeId}`,
      pageId: 'P1-STUDENT-SELF-N01',
      nodeId: node.nodeId,
    }),
    resource(`R-${node.nodeId}-FOLLOW`, node, `${label} 课堂活动`, '跟随教师讲解，完成本节点课堂小任务。', 'activity', 'direct-render', {
      kind: 'student-follow',
      href: '/classroom/demo-class',
      pageId: 'P1-STUDENT-FOLLOW-N01',
      sessionId: 'demo-class',
    }),
    resource(`R-${node.nodeId}-TEACHER`, node, `${label} 教师授课页`, '用于课堂讲评、控屏、推送任务和监督学习证据。', 'teacher-slide', 'resource-package', {
      kind: 'teacher',
      href: '/teacher/sessions/demo-class',
      pageId: 'P1-TEACH-CONSOLE-N01',
      sessionId: 'demo-class',
    }),
    resource(`R-${node.nodeId}-PRESENT`, node, `${label} 投屏页`, '面向全班展示的节点讲解页面。', 'projector', 'direct-render', {
      kind: 'projector',
      href: '/present/demo-class',
      pageId: 'P1-TEACH-PROJECTOR-N01',
      sessionId: 'demo-class',
    }),
  ];
}

function activityForNode(node: AbilityNode): Activity {
  const task = tasks.find((item) => item.taskId === node.taskId);
  return {
    activityId: `A-${node.nodeId}`,
    nodeId: node.nodeId,
    title: `${node.shortTitle}课堂练习`,
    activityType: 'quick-check',
    output: node.output,
    prompts: [
      `判断“${node.shortTitle}”依赖的关键证据。`,
      task ? `选择能支撑“${task.conclusion}”的表达。` : '选择可复核的证据表达。',
      '完成一组可判分选择题或判断题。',
    ],
    questions: questionsForNode(node),
  };
}

function questionsForNode(node: AbilityNode): ActivityQuestion[] {
  const task = tasks.find((item) => item.taskId === node.taskId);
  const evidence = task?.evidenceFrom ?? '现场证据';
  const standard = task?.standards[0] ?? '证据可复核';
  const conclusion = task?.conclusion ?? node.output;
  return [
    {
      id: `Q-${node.nodeId}-01`,
      type: 'single-choice',
      prompt: `${node.shortTitle}首先要确认哪一项？`,
      options: [node.goal, '只记录教师口头要求', '先写最终结论', '跳过现场证据'],
      correctAnswer: node.goal,
      explanation: `先确认“${node.goal}”，才能让后续证据和结论对齐。`,
    },
    {
      id: `Q-${node.nodeId}-02`,
      type: 'true-false',
      prompt: `判断：本节点证据应能支撑“${standard}”。`,
      options: ['正确', '错误'],
      correctAnswer: '正确',
      explanation: `“${standard}”是教师讲评时判断证据是否可用的口径。`,
    },
    {
      id: `Q-${node.nodeId}-03`,
      type: 'single-choice',
      prompt: `哪一项最能作为“${node.shortTitle}”的课堂提交结果？`,
      options: [node.output, evidence, conclusion, '资料已经浏览完成'],
      correctAnswer: node.output,
      explanation: `课堂提交要落到“${node.output}”，再进入教师监督和复盘。`,
    },
  ];
}

function assessmentForNode(node: AbilityNode): Assessment {
  return {
    assessmentId: `AS-${node.nodeId}`,
    nodeId: node.nodeId,
    title: `${node.shortTitle}学习评价`,
    rubric: ['对象边界清晰', '证据链可复核', '结论表达规范'],
  };
}

function resource(
  resourceId: string,
  node: AbilityNode,
  title: string,
  description: string,
  type: ResourceCard['type'],
  outputMode: OutputMode,
  routeTarget: RouteTarget,
): ResourceCard {
  return {
    resourceId,
    nodeId: node.nodeId,
    title,
    description,
    type,
    routeTarget,
    learningGoal: node.goal,
    learningAction: node.action,
    assessmentOutput: node.output,
    auditStatus: node.reviewStatus,
    outputMode,
  };
}
