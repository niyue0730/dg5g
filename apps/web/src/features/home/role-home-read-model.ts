import type { AppDatabase } from '../../platform/db/database.ts';
import { getDatabase } from '../../platform/db/database.ts';
import type { AuthenticatedActor } from '../../platform/auth/actor.ts';
import { getNodeLearningPolicy, type NodeLearningPolicy } from '../../platform/learning-policy.ts';
import { completionPercentForState } from '../../platform/learning-compatibility-projection.ts';
import { nodeLearningStateLabel } from '../../platform/learning-status.ts';
import { loadP1DemoContent, type P1DemoContent } from '../platform/p1-content.ts';
import { ClassroomParticipationRepository } from '../../platform/classroom-participation-repository.ts';
import { SelfStudyCursorRepository } from '../../platform/self-study-cursor-repository.ts';
import {
  AuthoritativeSnapshotAuthorizationError,
  AuthoritativeSnapshotReader,
  type StudentSnapshotDetail,
  type TeacherAuthoritativeSnapshot,
} from '../../platform/authoritative-snapshot.ts';
import { ClassroomSessionNotFoundError } from '../../platform/classroom-session-repository.ts';
import type {
  LearningContextSnapshot,
  StudentHomeSnapshot,
  TeacherWorkbenchSnapshot,
  WeakPointSnapshot,
} from './role-home-types.ts';
import { authoritativeDomFacts } from '../snapshot/snapshot-dom-facts.ts';

interface ClassroomNameRow {
  name: string;
}

export class RoleHomeReadRepository {
  private readonly snapshotReader: AuthoritativeSnapshotReader;
  private readonly participationRepository: ClassroomParticipationRepository;
  private readonly cursorRepository: SelfStudyCursorRepository;

  constructor(private readonly database: AppDatabase) {
    this.snapshotReader = new AuthoritativeSnapshotReader(database);
    this.participationRepository = new ClassroomParticipationRepository(database);
    this.cursorRepository = new SelfStudyCursorRepository(database);
  }

  readStudentHomeSnapshot(actor: AuthenticatedActor): StudentHomeSnapshot {
    try {
      return this.database.transaction(() => this.readStudent(actor))();
    } catch (error) {
      if (!isRoleHomeScopeError(error)) throw error;
      return {
        displayName: actor.displayName,
        dataIssue: '未找到当前班级成员关系，请联系教师确认班级。',
      };
    }
  }

  readTeacherWorkbenchSnapshot(actor: AuthenticatedActor): TeacherWorkbenchSnapshot {
    try {
      return this.database.transaction(() => this.readTeacher(actor))();
    } catch (error) {
      if (!isRoleHomeScopeError(error)) throw error;
      return missingTeacherClass(actor);
    }
  }

  private readStudent(actor: AuthenticatedActor): StudentHomeSnapshot {
    const studentId = actor.studentId ?? actor.userId;
    const snapshot = this.snapshotReader.read(actor, 'student');
    const domFacts = authoritativeDomFacts(snapshot);
    const classroom = this.readClassroomName(snapshot.classroom.sessionId);
    if (!classroom) return { displayName: snapshot.me.displayName, authoritativeFacts: domFacts, dataIssue: '当前班级名称不可用，请联系教师确认班级。' };
    const cursor = this.cursorRepository.readActive(studentId);
    if (!cursor) {
      return { displayName: snapshot.me.displayName, authoritativeFacts: domFacts, dataIssue: '未找到个人自主学习位置，请联系教师确认学习任务。' };
    }

    const content = loadP1DemoContent();
    const selfStudy = this.learningContext(content, cursor.nodeId, snapshot.me);
    if (!selfStudy) {
      return { displayName: snapshot.me.displayName, authoritativeFacts: domFacts, dataIssue: `个人自主学习位置 ${cursor.nodeId} 尚未开放。` };
    }

    let activeClassroom: StudentHomeSnapshot['activeClassroom'];
    if (snapshot.classroom.status === 'active') {
      if (!snapshot.classroom.activeNodeId) {
        return { displayName: snapshot.me.displayName, authoritativeFacts: domFacts, dataIssue: '当前课堂缺少能力节点，已停止自动进入。' };
      }
      const context = this.learningContext(content, snapshot.classroom.activeNodeId, snapshot.me, true);
      if (!context) {
        return { displayName: snapshot.me.displayName, authoritativeFacts: domFacts, dataIssue: `当前课堂位置 ${snapshot.classroom.activeNodeId} 尚未开放。` };
      }
      activeClassroom = {
        className: classroom.name,
        routeSessionId: snapshot.classroom.sessionId,
        participation: participationSnapshot(this.participationRepository.read(snapshot.classroom.sessionId, studentId)),
        context,
      };
    }
    return { displayName: snapshot.me.displayName, authoritativeFacts: domFacts, selfStudy, ...(activeClassroom ? { activeClassroom } : {}) };
  }

  private readTeacher(actor: AuthenticatedActor): TeacherWorkbenchSnapshot {
    const snapshot = this.snapshotReader.read(actor, 'teacher');
    const classroom = this.readClassroomName(snapshot.classroom.sessionId);
    if (!classroom) return missingTeacherClass(actor);
    if (snapshot.classroom.status === 'active' && !snapshot.classroom.activeNodeId) {
      return {
        displayName: actor.displayName,
        courseTitle: '5G网络优化（高级）',
        classroom: {
          id: snapshot.classroom.sessionId,
          name: classroom.name,
          status: snapshot.classroom.status,
          revision: snapshot.classroom.revision,
        },
        classSummary: {
          memberCount: snapshot.membership.classSize,
          joinedCount: snapshot.membership.joinedCount,
          followingCount: snapshot.membership.followingCount,
          submissions: snapshot.submissions,
          weakPoints: [],
        },
        classScores: snapshot.classScores,
        lessonOptions: [],
        dataIssue: '课堂状态为授课中，但没有当前能力节点，已停止继续授课。',
      };
    }

    const content = loadP1DemoContent();
    const lastPosition = snapshot.classroom.activeNodeId
      ? teachingPosition(
          content,
          snapshot.classroom.activeNodeId,
          snapshot.classroom.activeUnitId ?? null,
        )
      : undefined;
    if (snapshot.classroom.activeNodeId && !lastPosition) {
      return {
        ...missingTeacherClass(actor),
        dataIssue: `最近授课位置 ${snapshot.classroom.activeNodeId} 尚未开放，不能继续授课。`,
      };
    }
    return {
      displayName: actor.displayName,
      courseTitle: '5G网络优化（高级）',
      classroom: {
        id: snapshot.classroom.sessionId,
        name: classroom.name,
        status: snapshot.classroom.status,
        revision: snapshot.classroom.revision,
      },
      ...(lastPosition ? { lastPosition } : {}),
      classSummary: {
        memberCount: snapshot.membership.classSize,
        joinedCount: snapshot.membership.joinedCount,
        followingCount: snapshot.membership.followingCount,
        submissions: snapshot.submissions,
        weakPoints: currentWeakPoints(snapshot, content),
      },
      classScores: snapshot.classScores,
      lessonOptions: publishedLessonOptions(content.tasks.flatMap((task) => task.nodes.map((node) => ({
        nodeId: node.id,
        title: `${task.taskId} · ${node.title}`,
      })))),
    };
  }

  private readClassroomName(sessionId: string): ClassroomNameRow | undefined {
    return this.database.prepare(`
      SELECT name FROM classroom_sessions WHERE session_id = ?
    `).get(sessionId) as ClassroomNameRow | undefined;
  }

  private learningContext(
    content: P1DemoContent,
    nodeId: string,
    student: StudentSnapshotDetail,
    classroomOverride = false,
  ): LearningContextSnapshot | undefined {
    const found = findContentNode(content, nodeId);
    const policy = getNodeLearningPolicy(nodeId);
    const progress = student.nodes.find((node) => node.nodeId === nodeId);
    if (!found || !policy || policy.publicationStatus !== 'published' || !progress) return undefined;
    const taskProgress = student.tasks.find((task) => task.taskId === found.task.taskId);
    const taskScore = taskProgress?.taskCompositeScore;
    const accessKind = classroomOverride || progress.state !== 'locked' ? 'open' : 'locked';
    return {
      project: content.project,
      task: {
        id: found.task.taskId,
        title: found.task.title,
        why: found.task.why,
        outputTitle: found.task.taskOutputTitle,
      },
      node: { id: found.node.id, title: found.node.title, goal: found.node.goal },
      completionStandard: completionStandard(policy, found.node.goal),
      href: `/learn/${nodeId}`,
      access: {
        kind: accessKind,
        label: classroomOverride ? '课堂进行中' : nodeLearningStateLabel[progress.state],
        requiredNodeIds: policy.prerequisiteNodeIds,
      },
      progress: {
        stateLabel: classroomOverride ? '课堂进行中' : nodeLearningStateLabel[progress.state],
        stateOrigin: classroomOverride ? undefined : progress.origin,
        completionPercent: completionPercentForState(progress.state),
        nextRequirement: progress.nextRequirement,
        nodeTestHighestScore: progress.nodeTestHighestScore,
        nodeTestScoreOrigin: progress.nodeTestHighestScore === undefined ? undefined : progress.origin,
        taskCompositeScore: taskScore,
        taskScoreOrigin: taskScore === undefined ? undefined : taskProgress?.origin,
        projectCompositeScore: student.projectCompositeScore,
        projectScoreOrigin: student.projectCompositeScore === undefined
          ? undefined
          : student.projectCompositeOrigin,
      },
    };
  }
}

export function readStudentHomeSnapshot(actor: AuthenticatedActor): StudentHomeSnapshot {
  return new RoleHomeReadRepository(getDatabase()).readStudentHomeSnapshot(actor);
}

export function readTeacherWorkbenchSnapshot(actor: AuthenticatedActor): TeacherWorkbenchSnapshot {
  return new RoleHomeReadRepository(getDatabase()).readTeacherWorkbenchSnapshot(actor);
}

export function publishedLessonOptions<T extends { nodeId: string }>(
  candidates: T[],
  isPublished = (nodeId: string) => getNodeLearningPolicy(nodeId)?.publicationStatus === 'published',
): T[] {
  return candidates.filter((candidate) => isPublished(candidate.nodeId));
}

function findContentNode(content: P1DemoContent, nodeId: string) {
  for (const task of content.tasks) {
    const node = task.nodes.find((candidate) => candidate.id === nodeId);
    if (node) return { task, node };
  }
  return undefined;
}

function teachingPosition(content: P1DemoContent, nodeId: string, unitId: string | null) {
  const found = findContentNode(content, nodeId);
  const policy = getNodeLearningPolicy(nodeId);
  if (!found
    || policy?.publicationStatus !== 'published'
    || (unitId !== null && unitId !== policy.sourceKnowledgeUnitId)) return undefined;
  return {
    projectId: content.project.id,
    projectTitle: content.project.title,
    taskId: found.task.taskId,
    taskTitle: found.task.title,
    nodeId: found.node.id,
    nodeTitle: found.node.title,
    ...(unitId ? { unitId } : {}),
  };
}

function completionStandard(policy: NodeLearningPolicy, goal: string): string {
  const requirements = policy.requiresMicroPractice ? ['完成微练习'] : [];
  if (policy.requiresFormalTest) requirements.push(`正式测试达到 ${policy.formalPassScore ?? 80} 分`);
  if (policy.requiresProfessionalOutput) requirements.push(`提交《${policy.professionalOutputTitle ?? '任务成果'}》`);
  if (policy.requiresTeacherVerification) requirements.push('通过教师复核');
  const evidence = policy.nodeId === 'P1T1-N02'
    ? '能够分别说明设备位置、设备身份和连接方向的证据依据'
    : `能够依据“${goal}”形成可复核判断`;
  return `${requirements.join('，')}，并${evidence}。`;
}

function currentWeakPoints(
  snapshot: TeacherAuthoritativeSnapshot,
  content: P1DemoContent,
): WeakPointSnapshot[] {
  const activeNodeId = snapshot.classroom.activeNodeId;
  if (!activeNodeId) return [];
  const point = snapshot.weakPoints.find(({ nodeId }) => nodeId === activeNodeId);
  if (!point || point.attentionCount === 0) return [];
  const title = findContentNode(content, activeNodeId)?.node.title ?? activeNodeId;
  return [{ id: point.nodeId, label: `${title}待巩固`, affectedCount: point.attentionCount }];
}

function missingTeacherClass(actor: AuthenticatedActor): TeacherWorkbenchSnapshot {
  return {
    displayName: actor.displayName,
    courseTitle: '5G网络优化（高级）',
    classroom: { id: actor.classId, name: '班级数据不可用', status: 'closed', revision: 0 },
    classSummary: {
      memberCount: 0,
      joinedCount: 0,
      followingCount: 0,
      submissions: {
        classroomActivity: { submittedCount: 0, submissionPercent: 0 },
        activeAssessment: {
          status: 'idle', eligibleCount: 0, submittedCount: 0, playingCount: 0,
          passedCount: 0, submissionPercent: 0,
        },
        professionalOutputs: {
          submittedAwaitingReviewCount: 0, returnedCount: 0, verifiedCount: 0,
        },
      },
      weakPoints: [],
    },
    classScores: { distribution: [] },
    lessonOptions: [],
    dataIssue: '未找到可管理的授课班级，请检查教师与班级绑定。',
  };
}

function participationSnapshot(
  participation: ReturnType<ClassroomParticipationRepository['read']>,
): NonNullable<StudentHomeSnapshot['activeClassroom']>['participation'] {
  if (!participation) return { state: 'not-joined', mode: 'self' };
  return { state: participation.state, mode: participation.mode };
}

function isRoleHomeScopeError(error: unknown): boolean {
  return error instanceof AuthoritativeSnapshotAuthorizationError
    || error instanceof ClassroomSessionNotFoundError;
}
