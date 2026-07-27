import type { AuthenticatedActor } from './auth/actor.ts';
import {
  evidenceLibraryForTask,
  type EvidenceDefinition,
} from '../features/portfolio/evidence-library.ts';
import type { P01OutputPrefill } from '../features/portfolio/p01-output-definition.ts';
import { classifyNodeRoute, NodeRouteAccessError, type NodeRouteClassification } from './access-control.ts';
import { getDatabase, type AppDatabase } from './db/database.ts';
import { getNodeLearningPolicy } from './learning-policy.ts';
import {
  LearningReadModel,
  type StudentLearningSnapshot,
} from './learning-read-model.ts';
import { REQUIRED_SELF_STUDY_SECTIONS } from './self-study-sections.ts';
import {
  LearningFactIdConflictError,
  LearningRepository,
  LearningVersionConflictError,
  type AppendLearningEventInput,
  type RecordFormalAttemptInput,
} from './learning-repository.ts';
import {
  ProfessionalOutputNotFoundError,
  ProfessionalOutputEvidenceError,
  ProfessionalOutputRepository,
  ProfessionalOutputRevisionRequiredError,
  ProfessionalOutputStateError,
  ProfessionalOutputStateRevisionConflictError,
  ProfessionalOutputUpstreamError,
  type P1OutputTaskId,
  type ProfessionalOutputAggregate,
  type WriteProfessionalOutputInput,
} from './professional-output-repository.ts';

export interface LearningEventCommand extends Omit<AppendLearningEventInput, 'studentId'> {
  expectedVersion: number;
}

export interface FormalAttemptCommand extends Omit<RecordFormalAttemptInput, 'studentId'> {
  expectedVersion: number;
}

export interface ProfessionalOutputCommand extends Omit<
  WriteProfessionalOutputInput,
  'studentId' | 'taskId'
> {}

export interface ProfessionalOutputEnvelope {
  output: ProfessionalOutputAggregate | null;
  prefill: P01OutputPrefill;
  evidenceLibrary: EvidenceDefinition[];
}

export type ProfessionalOutputFieldValidator = (
  taskId: P1OutputTaskId,
  fields: WriteProfessionalOutputInput['fields'],
) => WriteProfessionalOutputInput['fields'];

export interface LearningCommandProblem {
  status: number;
  body: Record<string, unknown> & { error: string };
}

export class LearningAuthorizationError extends Error {
  constructor(message = 'The authenticated actor cannot perform this learning command.') {
    super(message);
    this.name = 'LearningAuthorizationError';
  }
}

export class LearningCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningCommandValidationError';
  }
}

export class FormalAssessmentReadinessError extends LearningCommandValidationError {
  readonly requiredState = 'micro-practice-passed' as const;

  constructor(readonly nodeId: string) {
    super('Formal assessment requires micro-practice-passed first.');
    this.name = 'FormalAssessmentReadinessError';
  }
}

export class FormalAttemptPolicyError extends Error {
  readonly nodeId: string;

  constructor(nodeId: string) {
    super(`Formal attempts are accepted only by a policy-defined N02 node test: ${nodeId}.`);
    this.name = 'FormalAttemptPolicyError';
    this.nodeId = nodeId;
  }
}

export class LearningCommandService {
  private readonly readModel: LearningReadModel;

  constructor(
    private readonly repository: LearningRepository,
    readModel = new LearningReadModel(repository),
    private readonly outputRepository?: ProfessionalOutputRepository,
  ) {
    this.readModel = readModel;
  }

  readStudentSnapshot(actor: AuthenticatedActor): StudentLearningSnapshot {
    const studentId = requireStudentIdentity(actor);
    return this.readModel.readStudentSnapshot(studentId);
  }

  appendEvent(actor: AuthenticatedActor, command: LearningEventCommand): StudentLearningSnapshot {
    const studentId = requireStudentIdentity(actor);
    const classroomSubmission = isClassroomSubmission(command.eventType);
    if (classroomSubmission) {
      validateLearningEvent(command);
      const publication = classifyNodeRoute(command.nodeId);
      if (publication.kind !== 'open') throw new NodeRouteAccessError(publication);
      if (!this.repository.studentCanSubmitClassroomEvent(studentId, actor.classId, command.nodeId)) {
        throw new LearningCommandValidationError('Classroom submission requires membership in the authoritative current-node session.');
      }
    } else {
      this.requireNodeAccess(actor, command.nodeId);
      validateLearningEvent(command);
    }
    this.repository.appendEvent({ ...command, studentId }, command.expectedVersion);
    return this.readModel.readStudentSnapshot(studentId);
  }

  recordFormalAttempt(actor: AuthenticatedActor, command: FormalAttemptCommand): StudentLearningSnapshot {
    const studentId = requireStudentIdentity(actor);
    this.requireFormalAssessmentReadiness(actor, command.nodeId, command.attemptId);
    this.repository.recordFormalAttempt({ ...command, studentId }, command.expectedVersion);
    return this.readModel.readStudentSnapshot(studentId);
  }

  requireFormalAssessmentReadiness(
    actor: AuthenticatedActor,
    nodeId: string,
    replayAttemptId?: string,
  ): NodeRouteClassification {
    const studentId = requireStudentIdentity(actor);
    const classification = this.requireNodeAccess(actor, nodeId);
    const policy = getNodeLearningPolicy(nodeId);
    if (!policy?.requiresFormalTest || policy.assessmentRole !== 'node-test') {
      throw new FormalAttemptPolicyError(nodeId);
    }
    const currentNode = this.readModel.readStudentSnapshot(studentId).nodes
      .find((node) => node.nodeId === nodeId);
    const isReplay = replayAttemptId !== undefined
      && (currentNode?.attempts.some((attempt) => attempt.attemptId === replayAttemptId) ?? false);
    if (!isReplay && !currentNode?.stateTrail.includes('micro-practice-passed')) {
      throw new FormalAssessmentReadinessError(nodeId);
    }
    return classification;
  }

  readProfessionalOutput(
    actor: AuthenticatedActor,
    taskId: string,
    outputId?: string,
  ): ProfessionalOutputEnvelope {
    const studentId = this.requireProfessionalOutputAccess(actor, taskId);
    const canonicalTaskId = asP1OutputTaskId(taskId);
    const repository = this.requireOutputRepository();
    return {
      output: repository.read(studentId, canonicalTaskId, outputId) ?? null,
      prefill: canonicalTaskId === 'P01' ? repository.readP01Prefill(studentId) : {},
      evidenceLibrary: evidenceLibraryForTask(canonicalTaskId),
    };
  }

  saveProfessionalOutputDraft(
    actor: AuthenticatedActor,
    taskId: string,
    command: ProfessionalOutputCommand,
    validateFields?: ProfessionalOutputFieldValidator,
  ): ProfessionalOutputAggregate {
    const studentId = this.requireProfessionalOutputAccess(actor, taskId);
    const canonicalTaskId = asP1OutputTaskId(taskId);
    return this.requireOutputRepository().saveDraft({
      ...command,
      fields: validateFields ? validateFields(canonicalTaskId, command.fields) : command.fields,
      studentId,
      taskId: canonicalTaskId,
    });
  }

  submitProfessionalOutput(
    actor: AuthenticatedActor,
    taskId: string,
    command: ProfessionalOutputCommand,
    validateFields?: ProfessionalOutputFieldValidator,
  ): ProfessionalOutputAggregate {
    const studentId = this.requireProfessionalOutputAccess(actor, taskId);
    const canonicalTaskId = asP1OutputTaskId(taskId);
    return this.requireOutputRepository().submit({
      ...command,
      fields: validateFields ? validateFields(canonicalTaskId, command.fields) : command.fields,
      studentId,
      taskId: canonicalTaskId,
    });
  }

  requireNodeAccess(actor: AuthenticatedActor, nodeId: string): NodeRouteClassification {
    const studentId = requireStudentIdentity(actor);
    const snapshot = this.readModel.readStudentSnapshot(studentId);
    const node = snapshot.nodes.find((candidate) => candidate.nodeId === nodeId);
    const classification = classifyNodeRoute(nodeId, node?.state === 'locked' ? 'locked' : node ? 'available' : undefined);
    if (classification.kind !== 'open') throw new NodeRouteAccessError(classification);
    return classification;
  }

  private requireProfessionalOutputAccess(actor: AuthenticatedActor, taskId: string): string {
    const nodeId = professionalOutputNodeId(taskId);
    this.requireNodeAccess(actor, nodeId);
    return requireStudentIdentity(actor);
  }

  private requireOutputRepository(): ProfessionalOutputRepository {
    if (!this.outputRepository) {
      throw new Error('Professional output repository is not configured.');
    }
    return this.outputRepository;
  }
}

export function createLearningCommandService(
  database: AppDatabase = getDatabase(),
): LearningCommandService {
  const repository = new LearningRepository(database);
  return new LearningCommandService(
    repository,
    new LearningReadModel(repository),
    new ProfessionalOutputRepository(database),
  );
}

export function describeLearningCommandError(error: unknown): LearningCommandProblem | undefined {
  if (error instanceof LearningAuthorizationError) {
    return { status: 403, body: { error: error.message } };
  }
  if (error instanceof NodeRouteAccessError) {
    const status = error.classification.kind === 'locked'
      ? 403
      : error.classification.kind === 'not-open' ? 409 : 404;
    return {
      status,
      body: {
        error: error.message,
        nodeId: error.classification.nodeId,
        routeState: error.classification.kind,
        ...(error.classification.kind === 'locked'
          ? { prerequisiteNodeIds: error.classification.prerequisiteNodeIds }
          : {}),
      },
    };
  }
  if (error instanceof LearningVersionConflictError) {
    return {
      status: 409,
      body: {
        error: error.message,
        topic: error.topic,
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      },
    };
  }
  if (error instanceof LearningFactIdConflictError) {
    return { status: 409, body: { error: error.message } };
  }
  if (error instanceof FormalAssessmentReadinessError) {
    return {
      status: 422,
      body: {
        error: error.message,
        nodeId: error.nodeId,
        requiredState: error.requiredState,
        routeState: 'prerequisite-required',
      },
    };
  }
  if (error instanceof ProfessionalOutputStateRevisionConflictError) {
    return {
      status: 409,
      body: {
        error: error.message,
        outputId: error.outputId,
        expectedStateRevision: error.expectedStateRevision,
        actualStateRevision: error.actualStateRevision,
      },
    };
  }
  if (error instanceof ProfessionalOutputNotFoundError) {
    return { status: 404, body: { error: error.message } };
  }
  if (error instanceof ProfessionalOutputStateError) {
    return { status: 409, body: { error: error.message, outputStatus: error.status } };
  }
  if (error instanceof ProfessionalOutputUpstreamError
    || error instanceof ProfessionalOutputEvidenceError
    || error instanceof ProfessionalOutputRevisionRequiredError) {
    return { status: 422, body: { error: error.message } };
  }
  if (error instanceof LearningCommandValidationError || error instanceof FormalAttemptPolicyError) {
    return { status: 422, body: { error: error.message } };
  }
  if (error instanceof TypeError) {
    return { status: 400, body: { error: error.message } };
  }
  return undefined;
}

const professionalOutputCommandKeys = new Set([
  'outputId',
  'expectedStateRevision',
  'fields',
  'upstreamRefs',
  'evidenceLinks',
]);

export function parseProfessionalOutputCommand(body: unknown): ProfessionalOutputCommand {
  if (!isRecord(body)) throw new TypeError('Invalid professional output command.');
  for (const key of Object.keys(body)) {
    if (!professionalOutputCommandKeys.has(key)) {
      throw new TypeError(`Unsupported professional output command key: ${key}.`);
    }
  }
  return {
    ...(body.outputId === undefined ? {} : { outputId: body.outputId as string }),
    expectedStateRevision: body.expectedStateRevision as number,
    fields: body.fields as ProfessionalOutputCommand['fields'],
    upstreamRefs: body.upstreamRefs as ProfessionalOutputCommand['upstreamRefs'],
    evidenceLinks: (body.evidenceLinks ?? {}) as ProfessionalOutputCommand['evidenceLinks'],
  };
}

function requireStudentIdentity(actor: AuthenticatedActor): string {
  if (actor.role !== 'student' || !actor.studentId || actor.studentId !== actor.userId) {
    throw new LearningAuthorizationError();
  }
  return actor.studentId;
}

const studentEventTypes = new Set([
  'section_completed',
  'classroom_submitted',
  'classroom_activity_submitted',
  'game_completed',
  'evidence_submitted',
]);

function validateLearningEvent(command: LearningEventCommand): void {
  if (command.payload !== undefined && !isRecord(command.payload)) {
    throw new TypeError('payload must be a JSON object.');
  }
  if (!studentEventTypes.has(command.eventType)) {
    throw new LearningCommandValidationError(`Unsupported learning event: ${command.eventType}.`);
  }
  if (command.eventType === 'evidence_submitted') {
    throw new LearningCommandValidationError('Professional output submission requires the authoritative output API');
  }
  if (command.eventType === 'section_completed') {
    const sectionId = isRecord(command.payload) ? command.payload.sectionId : undefined;
    if (command.channel !== 'self-study'
      || command.payload?.completed !== true
      || typeof sectionId !== 'string'
      || !(REQUIRED_SELF_STUDY_SECTIONS as readonly string[]).includes(sectionId)) {
      throw new LearningCommandValidationError('A self-study section event requires a completed canonical section.');
    }
  }
  if (command.eventType === 'game_completed') {
    if (command.channel !== 'game'
      || command.payload?.formal !== false
      || command.payload?.completed !== true) {
      throw new LearningCommandValidationError('A game event requires channel game, formal false, and completed true.');
    }
  }
  if (isClassroomSubmission(command.eventType)
    && (command.channel !== 'classroom' || command.payload?.completed !== true)) {
    throw new LearningCommandValidationError('A classroom event requires channel classroom and completed true.');
  }
}

function isClassroomSubmission(eventType: string): boolean {
  return eventType === 'classroom_submitted' || eventType === 'classroom_activity_submitted';
}

const professionalOutputNodeByTask: Record<P1OutputTaskId, string> = {
  P01: 'P1T1-N04',
  P02: 'P1T2-N04',
  P03: 'P1T3-N04',
};

function professionalOutputNodeId(taskId: string): string {
  const canonical = professionalOutputNodeByTask[taskId as P1OutputTaskId];
  if (canonical) return canonical;
  const projectTask = /^P(\d+)$/i.exec(taskId);
  return projectTask ? `P1T${Number(projectTask[1])}-N04` : taskId;
}

function asP1OutputTaskId(taskId: string): P1OutputTaskId {
  if (taskId === 'P01' || taskId === 'P02' || taskId === 'P03') return taskId;
  throw new TypeError(`Unsupported P1 output task: ${taskId}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
