import type { NodeLearningState } from './learning-status.ts';
import {
  getNodeLearningPolicy,
  nodeLearningPolicies,
  type P1NodeId,
  type P1TaskId,
} from './learning-policy.ts';
import {
  deriveNodeLearningProjection,
  type EvidenceReviewState,
  type PrerequisiteCondition,
  type PrerequisiteProgress,
} from './learning-projection.ts';
import {
  calculateProjectCompositeScore,
  calculateTaskCompositeScore,
  type TaskScoreProjection,
} from './learning-mastery.ts';
import {
  LearningRepository,
  type StoredFormalAttempt,
  type StoredFrozenTaskScore,
  type StoredLearningEvent,
  type StoredOutputReview,
  type StoredPracticeAttempt,
  type StoredProfessionalOutput,
  type StudentLearningFacts,
} from './learning-repository.ts';
import type { LearningOrigin } from './learning-origin.ts';
import { getFormalAssessmentValidationPolicy } from './formal-assessment-catalog.server.ts';
import { validatePersistedAssessmentDiagnostic } from './persisted-assessment-diagnostic.ts';
import {
  hasCompletedSelfStudy,
  REQUIRED_SELF_STUDY_SECTIONS,
} from './self-study-sections.ts';

export { REQUIRED_SELF_STUDY_SECTIONS } from './self-study-sections.ts';

export interface FormalAttemptProjection {
  attemptId: string;
  nodeId: string;
  assessmentId?: string;
  gameId?: string;
  score: number;
  durationSeconds?: number;
  mistakeKnowledgePointIds: string[];
  completedAt: string;
  questionVersion?: string;
  answers?: unknown;
  diagnostics?: unknown;
  origin?: LearningOrigin;
}

export interface NodeEvidenceProjection {
  outputId: string;
  taskId: P1TaskId;
  nodeId: string;
  status: StoredProfessionalOutput['status'];
  content: unknown;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
  origin?: LearningOrigin;
  version?: number;
  stateRevision?: number;
}

export interface OutputReviewProjection {
  reviewId: string;
  outputId: string;
  status: StoredOutputReview['status'];
  score?: number;
  feedback?: string;
  reviewedAt: string;
  outputVersion?: number;
  origin?: LearningOrigin;
}

export interface NodePrerequisiteProjection {
  nodeId: string;
  condition: PrerequisiteCondition;
  state: NodeLearningState;
  met: boolean;
}

export interface StudentNodeLearningSnapshot {
  nodeId: P1NodeId;
  state: NodeLearningState;
  stateTrail: NodeLearningState[];
  completedSections: string[];
  classroomSubmitted: boolean;
  attempts: FormalAttemptProjection[];
  evidence?: NodeEvidenceProjection;
  review?: OutputReviewProjection;
  prerequisites: NodePrerequisiteProjection[];
  bestFormalScore?: number;
  nextRequirement: string;
  origin?: LearningOrigin;
}

export interface StudentLearningSnapshot {
  version: number;
  globalVersion: number;
  studentId: string;
  nodes: StudentNodeLearningSnapshot[];
  tasks: StudentTaskLearningSnapshot[];
  projectCompositeScore?: number;
  projectCompositeOrigin?: LearningOrigin;
}

export interface StudentTaskLearningSnapshot extends TaskScoreProjection {
  taskId: P1TaskId;
  origin?: LearningOrigin;
  realTaskCertified: boolean;
  demoTaskCertified: boolean;
  frozenFormalAttemptId?: string;
  frozenFormalScore?: number;
}

export interface ClassLearningSnapshot {
  classId: string;
  version: number;
  students: StudentLearningSnapshot[];
}

export class LearningReadModel {
  private readonly repository: LearningRepository;

  constructor(repository: LearningRepository) {
    this.repository = repository;
  }

  readStudentSnapshot(studentId: string): StudentLearningSnapshot {
    return projectStudentLearningFacts(this.repository.readStudentFacts(studentId));
  }

  readClassSnapshot(teacherId: string, classId: string): ClassLearningSnapshot {
    const facts = this.repository.readClassStudentFacts(teacherId, classId);
    const students = facts.students.map(projectStudentLearningFacts);
    return { classId, version: facts.globalVersion, students };
  }
}

function projectStudentLearningFacts(facts: StudentLearningFacts): StudentLearningSnapshot {
  const snapshots = new Map<string, StudentNodeLearningSnapshot>();

  for (const policy of nodeLearningPolicies) {
    const events = preferUserOrigin(facts.events.filter(({ nodeId }) => nodeId === policy.nodeId));
    const progressEvents = events.filter(({ eventType }) => eventType !== 'micro_practice_passed');
    const practiceAttempts = preferUserOrigin(
      facts.practiceAttempts.filter(({ nodeId }) => nodeId === policy.nodeId),
    );
    const storedAttempts = preferUserOrigin(facts.attempts.filter(({ nodeId }) => nodeId === policy.nodeId));
    const attempts = storedAttempts.map(toAttemptProjection);
    const sections = completedSections(progressEvents);
    const selfStudyComplete = hasCompletedSelfStudy(sections);
    const completedSectionEvents = progressEvents.filter(isCompletedCanonicalSection);
    const classroomSubmitted = progressEvents.some(isCompletedClassroomSubmission);
    const evidence = latestOutputForNode(facts.outputs, policy.nodeId);
    const storedReview = evidence
      ? latestReviewForOutput(facts.reviews, evidence.outputId, evidence.currentVersion)
      : undefined;
    const review = storedReview ? toReviewProjection(storedReview) : undefined;
    const prerequisites = policy.prerequisites.map((prerequisite): NodePrerequisiteProjection => {
      const prior = snapshots.get(prerequisite.nodeId);
      return {
        nodeId: prerequisite.nodeId,
        condition: prerequisite.condition,
        state: prior?.state ?? 'locked',
        met: prerequisiteMet(prior),
      };
    });
    const prerequisiteProgress: PrerequisiteProgress[] = prerequisites.map((prerequisite) => {
      const prior = snapshots.get(prerequisite.nodeId);
      return {
        nodeId: prerequisite.nodeId,
        achieved: prior?.state === 'achieved',
        formalTestPassed: prior?.stateTrail.includes('formal-test-passed') ?? false,
        professionalOutputSubmitted: prior?.stateTrail.includes('evidence-submitted') ?? false,
      };
    });
    const bestFormalScore = storedAttempts.length
      ? Math.max(...storedAttempts.map(({ score }) => score))
      : undefined;
    const projection = deriveNodeLearningProjection(policy, {
      hasActivity: progressEvents.length > 0 || practiceAttempts.length > 0
        || storedAttempts.length > 0 || evidence !== undefined,
      selfStudyComplete,
      microPracticePassed: microPracticePassed(policy.requiredActivityIds, practiceAttempts),
      bestFormalTestScore: bestFormalScore,
      evidenceReviewStatus: evidenceReviewState(evidence, review),
    }, prerequisiteProgress);
    const prerequisiteOriginFacts = prerequisites.flatMap((prerequisite) => {
      if (!prerequisite.met) return [];
      const prerequisiteOrigin = snapshots.get(prerequisite.nodeId)?.origin;
      return prerequisiteOrigin ? [{ origin: prerequisiteOrigin }] : [];
    });
    const passedPracticeFacts = policy.requiredActivityIds.flatMap((activityId) => (
      practiceAttempts.filter((attempt) => attempt.activityId === activityId && attempt.passed)
    ));
    const milestoneOriginGroups: Array<Array<{ origin: LearningOrigin }>> = [
      prerequisiteOriginFacts,
      passedPracticeFacts,
      ...(selfStudyComplete ? [completedSectionEvents] : []),
    ];
    if (projection.stateTrail.includes('formal-test-passed')) {
      milestoneOriginGroups.push(storedAttempts.filter((attempt) => (
        attempt.score >= (policy.formalPassScore ?? Number.POSITIVE_INFINITY)
      )));
    }
    if (projection.stateTrail.includes('evidence-submitted') && evidence) {
      milestoneOriginGroups.push([evidence]);
    }
    if ((projection.state === 'returned' || projection.stateTrail.includes('teacher-verified')) && storedReview) {
      milestoneOriginGroups.push([storedReview]);
    }
    const origin = projection.state === 'locked'
      ? undefined
      : projection.state === 'learning'
        ? activeOrigin(
            prerequisiteOriginFacts,
            progressEvents,
            practiceAttempts,
            storedAttempts,
            evidence ? [evidence] : [],
            storedReview ? [storedReview] : [],
          )
        : activeOrigin(...milestoneOriginGroups);
    const node: StudentNodeLearningSnapshot = {
      nodeId: policy.nodeId,
      state: projection.state,
      stateTrail: projection.stateTrail,
      completedSections: sections,
      classroomSubmitted,
      attempts,
      ...(evidence ? { evidence: toEvidenceProjection(evidence, policy.taskId) } : {}),
      ...(review ? { review } : {}),
      prerequisites,
      ...(bestFormalScore === undefined ? {} : { bestFormalScore }),
      nextRequirement: projection.nextRequirement,
      ...(origin ? { origin } : {}),
    };
    snapshots.set(policy.nodeId, node);
  }

  const nodes = nodeLearningPolicies.map(({ nodeId }) => requiredSnapshot(snapshots, nodeId));
  const taskIds: P1TaskId[] = ['P01', 'P02', 'P03'];
  const tasks = taskIds.map((taskId) => {
    const taskPolicies = nodeLearningPolicies.filter((policy) => policy.taskId === taskId);
    const testNodeIds = new Set(taskPolicies
      .filter(({ assessmentRole }) => assessmentRole === 'node-test')
      .map(({ nodeId }) => nodeId));
    const taskAttempts = [...testNodeIds].flatMap((nodeId) => (
      preferUserOrigin(facts.attempts.filter((attempt) => attempt.nodeId === nodeId))
    ));
    const scores = taskAttempts.map(({ score }) => score);
    const nodeTestHighestScore = scores.length ? Math.max(...scores) : undefined;
    const outputPolicy = taskPolicies.find(({ requiresProfessionalOutput }) => requiresProfessionalOutput);
    const output = outputPolicy ? latestOutputForNode(facts.outputs, outputPolicy.nodeId) : undefined;
    const outputReview = output
      ? latestReviewForOutput(facts.reviews, output.outputId, output.currentVersion)
      : undefined;
    const outputRubricScore = output?.status === 'verified'
      && outputReview?.status === 'verified'
      && outputReview.score !== undefined
      ? outputReview.score
      : undefined;
    const scoreProjection = calculateTaskCompositeScore({ nodeTestHighestScore, outputRubricScore });
    const certification = findCertifiedTaskScore({
      facts,
      taskId,
      testNodeId: [...testNodeIds][0],
      output,
      outputReview,
    });
    return {
      taskId,
      nodeTestHighestScore: scoreProjection.nodeTestHighestScore,
      outputRubricScore: scoreProjection.outputRubricScore,
      ...(certification === undefined
        ? {}
        : {
          taskCompositeScore: certification.taskCompositeScore,
          origin: certification.origin,
          frozenFormalAttemptId: certification.attemptId,
          frozenFormalScore: certification.formalScore,
        }),
      realTaskCertified: certification?.origin === 'user',
      demoTaskCertified: certification?.origin === 'demo',
    };
  });

  const projectCompositeScore = calculateProjectCompositeScore(
    tasks.map(({ taskCompositeScore }) => taskCompositeScore),
  );
  return {
    version: facts.version,
    globalVersion: facts.globalVersion,
    studentId: facts.studentId,
    nodes,
    tasks,
    projectCompositeScore,
    ...(projectCompositeScore === undefined ? {} : {
      projectCompositeOrigin: tasks.every(({ origin }) => origin === 'user') ? 'user' : 'demo',
    }),
  };
}

function toAttemptProjection(attempt: StoredFormalAttempt): FormalAttemptProjection {
  return {
    attemptId: attempt.attemptId,
    nodeId: attempt.nodeId,
    ...(attempt.assessmentId === undefined ? {} : { assessmentId: attempt.assessmentId }),
    ...(attempt.gameId === undefined ? {} : { gameId: attempt.gameId }),
    score: attempt.score,
    ...(attempt.durationSeconds === undefined ? {} : { durationSeconds: attempt.durationSeconds }),
    mistakeKnowledgePointIds: attempt.mistakeKnowledgePointIds,
    completedAt: attempt.completedAt,
    ...(attempt.questionVersion === undefined ? {} : { questionVersion: attempt.questionVersion }),
    answers: attempt.answers,
    diagnostics: attempt.diagnostics,
    origin: attempt.origin,
  };
}

function toEvidenceProjection(output: StoredProfessionalOutput, taskId: P1TaskId): NodeEvidenceProjection {
  return {
    outputId: output.outputId,
    taskId,
    nodeId: output.nodeId,
    status: output.status,
    ...(output.currentVersion > 0 ? { version: output.currentVersion } : {}),
    stateRevision: output.stateRevision,
    content: output.content,
    ...(output.submittedAt === undefined ? {} : { submittedAt: output.submittedAt }),
    createdAt: output.createdAt,
    updatedAt: output.updatedAt,
    origin: output.origin,
  };
}

interface CertifiedTaskScore {
  origin: LearningOrigin;
  attemptId: string;
  formalScore: number;
  taskCompositeScore: number;
}

function findCertifiedTaskScore({
  facts,
  taskId,
  testNodeId,
  output,
  outputReview,
}: {
  facts: StudentLearningFacts;
  taskId: P1TaskId;
  testNodeId: P1NodeId | undefined;
  output: StoredProfessionalOutput | undefined;
  outputReview: StoredOutputReview | undefined;
}): CertifiedTaskScore | undefined {
  if (
    !testNodeId
    || !output
    || output.status !== 'verified'
    || !outputReview
    || outputReview.status !== 'verified'
    || outputReview.outputVersion !== output.currentVersion
    || outputReview.score === undefined
    || output.origin !== outputReview.origin
  ) return undefined;

  const policy = getFormalAssessmentValidationPolicy(testNodeId);
  if (!policy) return undefined;
  const candidates = facts.frozenTaskScores
    .filter((score) => canonicalFrozenTaskId(score.taskId) === taskId)
    .slice()
    .reverse();
  for (const frozen of candidates) {
    if (frozen.origin !== output.origin || frozen.officialScore === undefined) continue;
    const details = isRecord(frozen.details) ? frozen.details : undefined;
    const attemptId = stringValue(details?.nodeTestAttemptId);
    const attempt = attemptId
      ? facts.attempts.find((candidate) => candidate.attemptId === attemptId)
      : undefined;
    if (!details || !attempt || attempt.origin !== frozen.origin) continue;
    const validated = validatePersistedAssessmentDiagnostic({
      attemptId: attempt.attemptId,
      studentId: attempt.studentId,
      nodeId: attempt.nodeId,
      assessmentId: attempt.assessmentId ?? null,
      gameId: attempt.gameId ?? null,
      questionVersion: attempt.questionVersion ?? null,
      score: attempt.score,
      diagnosticsJson: serializeDiagnostic(attempt.diagnostics),
      origin: attempt.origin,
      completedAt: attempt.completedAt,
      instanceAssessmentId: attempt.instanceAssessmentId ?? null,
      instanceNodeId: attempt.instanceNodeId ?? null,
      instanceGameId: attempt.instanceGameId ?? null,
      instanceQuestionVersion: attempt.instanceQuestionVersion ?? null,
      instanceStatus: attempt.instanceStatus ?? null,
    }, policy);
    const taskCompositeScore = numberValue(details.taskCompositeScore);
    const expectedComposite = calculateTaskCompositeScore({
      nodeTestHighestScore: validated?.totalScore,
      outputRubricScore: outputReview.score,
    }).taskCompositeScore;
    if (
      !validated?.passed
      || validated.nodeId !== testNodeId
      || details.nodeId !== testNodeId
      || details.assessmentId !== validated.assessmentId
      || details.questionVersion !== validated.questionVersion
      || details.nodeTestHighestScore !== validated.totalScore
      || details.outputId !== output.outputId
      || details.outputVersion !== output.currentVersion
      || details.outputRubricScore !== outputReview.score
      || taskCompositeScore === undefined
      || expectedComposite !== taskCompositeScore
      || frozen.provisionalScore !== taskCompositeScore
      || frozen.officialScore !== taskCompositeScore
    ) continue;
    return {
      origin: frozen.origin,
      attemptId: validated.attemptId,
      formalScore: validated.totalScore,
      taskCompositeScore,
    };
  }
  return undefined;
}

function canonicalFrozenTaskId(taskId: string): P1TaskId | undefined {
  const aliases: Record<string, P1TaskId> = {
    P01: 'P01',
    P02: 'P02',
    P03: 'P03',
    P1T1: 'P01',
    P1T2: 'P02',
    P1T3: 'P03',
  };
  return aliases[taskId];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function serializeDiagnostic(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

function toReviewProjection(review: StoredOutputReview): OutputReviewProjection {
  return {
    reviewId: review.reviewId,
    outputId: review.outputId,
    status: review.status,
    ...(review.score === undefined ? {} : { score: review.score }),
    ...(review.feedback === undefined ? {} : { feedback: review.feedback }),
    reviewedAt: review.reviewedAt,
    ...(review.outputVersion === undefined ? {} : { outputVersion: review.outputVersion }),
    origin: review.origin,
  };
}

function latestOutputForNode(outputs: StoredProfessionalOutput[], nodeId: string): StoredProfessionalOutput | undefined {
  return preferUserOrigin(outputs.filter((output) => output.nodeId === nodeId)).at(-1);
}

function latestReviewForOutput(
  reviews: StoredOutputReview[],
  outputId: string,
  outputVersion: number,
): StoredOutputReview | undefined {
  const scoped = preferUserOrigin(reviews.filter((review) => review.outputId === outputId));
  return scoped.filter((review) => review.outputVersion === outputVersion).at(-1)
    ?? scoped.filter((review) => review.outputVersion === undefined).at(-1);
}

function evidenceReviewState(
  output: StoredProfessionalOutput | undefined,
  review: OutputReviewProjection | undefined,
): EvidenceReviewState {
  if (!output || output.status === 'draft') return 'not-submitted';
  if (review?.status === 'verified' && output.status === 'verified') return 'verified';
  if (review?.status === 'returned' || output.status === 'returned') return 'returned';
  return 'submitted';
}

function prerequisiteMet(prior: StudentNodeLearningSnapshot | undefined): boolean {
  return prior?.state === 'achieved';
}

function microPracticePassed(
  requiredActivityIds: readonly string[],
  attempts: StoredPracticeAttempt[],
): boolean {
  if (requiredActivityIds.length === 0) return false;
  return requiredActivityIds.every((activityId) => attempts.some((attempt) => (
    attempt.activityId === activityId && attempt.passed
  )));
}

function preferUserOrigin<Value extends { origin: LearningOrigin }>(facts: Value[]): Value[] {
  return facts.some(({ origin }) => origin === 'user')
    ? facts.filter(({ origin }) => origin === 'user')
    : facts;
}

function activeOrigin(
  ...groups: Array<Array<{ origin: LearningOrigin }>>
): LearningOrigin | undefined {
  const facts = groups.flat();
  if (facts.length === 0) return undefined;
  return facts.every(({ origin }) => origin === 'user') ? 'user' : 'demo';
}

function isCompletedClassroomSubmission(event: StoredLearningEvent): boolean {
  return ['classroom_submitted', 'classroom_activity_submitted'].includes(event.eventType)
    && isRecord(event.payload)
    && event.payload.completed === true;
}

function completedSections(events: StoredLearningEvent[]): string[] {
  const completed = new Set(events.flatMap((event) => {
    if (event.eventType !== 'section_completed' || !isRecord(event.payload)) return [];
    const sectionId = event.payload.sectionId;
    return event.payload.completed === true
      && typeof sectionId === 'string'
      && sectionId.trim().length > 0
      ? [sectionId]
      : [];
  }));
  const required = REQUIRED_SELF_STUDY_SECTIONS.filter((sectionId) => completed.delete(sectionId));
  return [...required, ...completed];
}

function isCompletedCanonicalSection(event: StoredLearningEvent): boolean {
  if (event.eventType !== 'section_completed' || !isRecord(event.payload)) return false;
  return event.payload.completed === true
    && typeof event.payload.sectionId === 'string'
    && (REQUIRED_SELF_STUDY_SECTIONS as readonly string[]).includes(event.payload.sectionId);
}

function requiredSnapshot(
  snapshots: Map<string, StudentNodeLearningSnapshot>,
  nodeId: P1NodeId,
): StudentNodeLearningSnapshot {
  const snapshot = snapshots.get(nodeId);
  if (!snapshot || !getNodeLearningPolicy(nodeId)) throw new Error(`Missing canonical learning snapshot for ${nodeId}.`);
  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
