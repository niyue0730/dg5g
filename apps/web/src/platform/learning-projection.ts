import type { NodeLearningState } from './learning-status';

export type PrerequisiteCondition = 'achieved';
export type EvidenceReviewState = 'not-submitted' | 'submitted' | 'returned' | 'verified';

export interface LearningPrerequisite {
  nodeId: string;
  condition: PrerequisiteCondition;
}

export interface ProjectionPolicy {
  prerequisites: LearningPrerequisite[];
  publicationStatus: 'published' | 'not-open';
  requiresMicroPractice: boolean;
  requiresFormalTest: boolean;
  formalPassScore?: number;
  requiresProfessionalOutput: boolean;
  professionalOutputTitle?: string;
  requiresTeacherVerification: boolean;
}

export interface LearningFacts {
  hasActivity: boolean;
  selfStudyComplete: boolean;
  microPracticePassed: boolean;
  bestFormalTestScore?: number;
  evidenceReviewStatus: EvidenceReviewState;
}

export interface PrerequisiteProgress {
  nodeId: string;
  achieved: boolean;
  formalTestPassed: boolean;
  professionalOutputSubmitted: boolean;
}

export interface NodeLearningProjection {
  state: NodeLearningState;
  stateTrail: NodeLearningState[];
  achieved: boolean;
  completionPercent: number;
  nextRequirement: string;
}

export function arePrerequisitesMet(
  prerequisites: LearningPrerequisite[],
  progress: PrerequisiteProgress[],
): boolean {
  const progressByNode = new Map(progress.map((item) => [item.nodeId, item]));
  return prerequisites.every((prerequisite) => {
    const current = progressByNode.get(prerequisite.nodeId);
    return prerequisite.condition === 'achieved' && current?.achieved === true;
  });
}

export function deriveNodeLearningProjection(
  policy: ProjectionPolicy,
  facts: LearningFacts,
  prerequisiteProgress: PrerequisiteProgress[],
): NodeLearningProjection {
  if (policy.publicationStatus !== 'published' || !arePrerequisitesMet(policy.prerequisites, prerequisiteProgress)) {
    return projection(['locked'], '先完成前置能力节点');
  }
  if (!facts.hasActivity) return projection(['available'], '开始学习');

  const states: NodeLearningState[] = ['learning'];
  if (policy.requiresMicroPractice) {
    if (!facts.microPracticePassed) return projection(states, '完成微练习');
    states.push('micro-practice-passed');
  }
  if (!facts.selfStudyComplete) {
    return projection(states, '保存本节点学习记录');
  }

  if (policy.requiresFormalTest) {
    const passScore = policy.formalPassScore ?? 80;
    if ((facts.bestFormalTestScore ?? -1) < passScore) {
      return projection(states, `正式测试达到 ${passScore} 分`);
    }
    states.push('formal-test-passed');
  }

  if (policy.requiresProfessionalOutput) {
    if (facts.evidenceReviewStatus === 'not-submitted') {
      return projection(states, `提交《${policy.professionalOutputTitle ?? '任务成果'}》`);
    }
    states.push('evidence-submitted', 'awaiting-review');
    if (facts.evidenceReviewStatus === 'returned') {
      states.push('returned');
      return projection(states, '按教师反馈修订并重新提交');
    }
    if (policy.requiresTeacherVerification && facts.evidenceReviewStatus !== 'verified') {
      return projection(states, '等待教师按量规复核');
    }
  }

  if (policy.requiresTeacherVerification) states.push('teacher-verified');
  states.push('achieved');
  return projection(states, '进入下一能力节点');
}

function projection(stateTrail: NodeLearningState[], nextRequirement: string): NodeLearningProjection {
  const state = stateTrail.at(-1) ?? 'locked';
  const completionPercent: Record<NodeLearningState, number> = {
    locked: 0,
    available: 0,
    learning: 20,
    'micro-practice-passed': 40,
    'formal-test-passed': 60,
    'evidence-submitted': 75,
    'awaiting-review': 80,
    returned: 70,
    'teacher-verified': 95,
    achieved: 100,
  };
  return {
    state,
    stateTrail,
    achieved: state === 'achieved',
    completionPercent: completionPercent[state],
    nextRequirement,
  };
}
