import type { CurriculumGraphNode } from '../../platform/models.ts';
import type { P1TaskId } from '../../platform/learning-policy.ts';

export type CourseGraphNodeAction = 'learn' | 'formal-test' | 'professional-output';

export async function activateTeacherGraphNode({
  initialRevision,
  start,
  refreshRevision,
}: {
  initialRevision: number;
  start: (expectedRevision: number) => Promise<{ status: 'started' } | { status: 'conflict'; currentRevision: number }>;
  refreshRevision: () => Promise<number>;
}): Promise<void> {
  const first = await start(initialRevision);
  if (first.status === 'started') return;

  const refreshedRevision = await refreshRevision();
  const second = await start(refreshedRevision);
  if (second.status === 'conflict') {
    throw new Error('课堂状态刚刚发生变化，请重新选择能力节点。');
  }
}

export function dispatchCurriculumGraphNode(
  node: CurriculumGraphNode,
  callbacks: {
    onNodeSelect: (nodeId: string, action: CourseGraphNodeAction) => void;
    onTaskSelect: (taskId: P1TaskId) => void;
  },
): void {
  if (node.nodeId) {
    callbacks.onNodeSelect(node.nodeId, node.action ?? 'learn');
  } else if (node.taskId) {
    callbacks.onTaskSelect(node.taskId);
  }
}

export function navigateStudentGraphNode(
  push: (href: string) => void,
  nodeId: string,
  action: CourseGraphNodeAction,
): void {
  const nodeHref = `/learn/${encodeURIComponent(nodeId)}`;
  switch (action) {
    case 'learn':
      push(nodeHref);
      return;
    case 'formal-test':
      push(`${nodeHref}/test`);
      return;
    case 'professional-output':
      push(`${nodeHref}?mode=challenge`);
      return;
    default:
      throw new Error(`Unsupported course graph action: ${String(action)}`);
  }
}
