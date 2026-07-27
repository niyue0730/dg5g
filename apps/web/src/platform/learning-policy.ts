import {
  deriveNodeLearningProjection as deriveProjection,
  type EvidenceReviewState,
  type LearningPrerequisite,
  type NodeLearningProjection,
  type PrerequisiteProgress,
} from './learning-projection.ts';

export type P1TaskId = 'P01' | 'P02' | 'P03';
export type P1NodeId = `P1T${1 | 2 | 3}-N0${1 | 2 | 3 | 4}`;
export type AssessmentRole = 'none' | 'node-test' | 'task-pixi';
export type PublicationStatus = 'published' | 'not-open';

export interface NodeLearningPolicy {
  nodeId: P1NodeId;
  taskId: P1TaskId;
  sourceKnowledgeUnitId: string;
  publicationStatus: PublicationStatus;
  prerequisites: LearningPrerequisite[];
  /** @deprecated Legacy readers use this until the SQLite service migration is complete. */
  prerequisiteNodeIds: string[];
  requiresMicroPractice: boolean;
  requiredActivityIds: readonly string[];
  requiresFormalTest: boolean;
  assessmentRole: AssessmentRole;
  formalPassScore?: number;
  requiresProfessionalOutput: boolean;
  requiresTeacherVerification: boolean;
  professionalOutputTitle?: string;
}

export interface NodeLearningSignals {
  prerequisiteMet: boolean;
  hasActivity: boolean;
  selfStudyComplete: boolean;
  microPracticePassed: boolean;
  bestFormalTestScore?: number;
  evidenceReviewStatus: EvidenceReviewState;
}

const taskDefinitions: Array<{
  taskId: P1TaskId;
  prefix: 'P1T1' | 'P1T2' | 'P1T3';
  entryPrerequisite?: P1NodeId;
  outputTitle: string;
}> = [
  { taskId: 'P01', prefix: 'P1T1', outputTitle: '室内设备与链路证据表' },
  { taskId: 'P02', prefix: 'P1T2', entryPrerequisite: 'P1T1-N04', outputTitle: '室外站点与覆盖采集表' },
  { taskId: 'P03', prefix: 'P1T3', entryPrerequisite: 'P1T2-N04', outputTitle: '投诉信息调查单' },
];

const requiredActivityIdsByNode: Record<P1NodeId, readonly string[]> = {
  'P1T1-N01': ['P1T1-N01-micro-01'],
  'P1T1-N02': [
    'P1T1-N02-foundation-01',
    'P1T1-N02-application-01',
    'P1T1-N02-transfer-01',
  ],
  'P1T1-N03': ['P1T1-N03-micro-01'],
  'P1T1-N04': ['P1T1-N04-micro-01'],
  'P1T2-N01': ['P1T2-N01-micro-01'],
  'P1T2-N02': [
    'P1T2-N02-foundation-01',
    'P1T2-N02-application-01',
    'P1T2-N02-transfer-01',
  ],
  'P1T2-N03': ['P1T2-N03-micro-01'],
  'P1T2-N04': ['P1T2-N04-micro-01'],
  'P1T3-N01': ['P1T3-N01-micro-01'],
  'P1T3-N02': [
    'P1T3-N02-foundation-01',
    'P1T3-N02-application-01',
    'P1T3-N02-transfer-01',
  ],
  'P1T3-N03': ['P1T3-N03-micro-01'],
  'P1T3-N04': ['P1T3-N04-micro-01'],
};

export const nodeLearningPolicies: NodeLearningPolicy[] = taskDefinitions.flatMap((task) =>
  Array.from({ length: 4 }, (_, offset): NodeLearningPolicy => {
    const index = offset + 1;
    const nodeId = `${task.prefix}-N0${index}` as P1NodeId;
    const isTaskEntry = index === 1;
    const isNodeTest = index === 2;
    const isTaskEnd = index === 4;
    const prerequisiteNodeId = isTaskEntry
      ? task.entryPrerequisite
      : `${task.prefix}-N0${index - 1}` as P1NodeId;
    const prerequisites: LearningPrerequisite[] = prerequisiteNodeId
      ? [{
        nodeId: prerequisiteNodeId,
        condition: 'achieved',
      }]
      : [];
    return {
      nodeId,
      taskId: task.taskId,
      sourceKnowledgeUnitId: `${task.taskId}-ku-${index === 4 ? '06' : `0${index}`}`,
      publicationStatus: 'published',
      prerequisites,
      prerequisiteNodeIds: prerequisites.map((item) => item.nodeId),
      requiresMicroPractice: true,
      requiredActivityIds: requiredActivityIdsByNode[nodeId],
      requiresFormalTest: isNodeTest,
      assessmentRole: isNodeTest ? 'node-test' : 'none',
      formalPassScore: isNodeTest ? 80 : undefined,
      requiresProfessionalOutput: isTaskEnd,
      requiresTeacherVerification: isTaskEnd,
      professionalOutputTitle: isTaskEnd ? task.outputTitle : undefined,
    };
  }),
);

const policyByNode = new Map(nodeLearningPolicies.map((policy) => [policy.nodeId, policy]));

export function getNodeLearningPolicy(nodeId: string): NodeLearningPolicy | undefined {
  return policyByNode.get(nodeId as P1NodeId);
}

/**
 * Temporary adapter for legacy callers. New services must call the three-argument
 * projector from learning-projection.ts with real prerequisite facts.
 */
export function deriveNodeLearningProjection(
  policy: NodeLearningPolicy,
  signals: NodeLearningSignals,
): NodeLearningProjection {
  const prerequisiteProgress: PrerequisiteProgress[] = policy.prerequisites.map((item) => ({
    nodeId: item.nodeId,
    achieved: signals.prerequisiteMet,
    formalTestPassed: signals.prerequisiteMet,
    professionalOutputSubmitted: signals.prerequisiteMet,
  }));
  return deriveProjection(policy, signals, prerequisiteProgress);
}
