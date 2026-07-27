import type { AchievementLevel, GameAttemptSummary } from './models';

export interface AchievementInput {
  lessonComplete: boolean;
  hasFormalTest: boolean;
  bestFormalScore?: number;
  locked?: boolean;
}

export interface FormalAttemptSummary {
  attempts: GameAttemptSummary[];
  attemptCount: number;
  firstScore?: number;
  bestScore?: number;
  latestScore?: number;
  bestDurationSeconds?: number;
}

export function deriveAchievementLevel(input: AchievementInput): AchievementLevel {
  if (input.locked) return 'locked';
  if (!input.lessonComplete) return 'available';
  if (!input.hasFormalTest || input.bestFormalScore === undefined) return 'learned';
  if (input.bestFormalScore >= 90) return 'excellent';
  if (input.bestFormalScore >= 80) return 'mastered';
  if (input.bestFormalScore >= 60) return 'passed';
  return 'learned';
}

export function summarizeFormalAttempts(attempts: GameAttemptSummary[]): FormalAttemptSummary {
  const formal = attempts
    .filter((attempt) => attempt.formal)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
  const scores = formal.map((attempt) => attempt.score);
  const durations = formal
    .map((attempt) => attempt.durationSeconds)
    .filter((duration): duration is number => duration !== undefined && duration > 0);
  return {
    attempts: formal,
    attemptCount: formal.length,
    ...(scores[0] === undefined ? {} : { firstScore: scores[0] }),
    ...(scores.length ? { bestScore: Math.max(...scores) } : {}),
    ...(scores.at(-1) === undefined ? {} : { latestScore: scores.at(-1) }),
    ...(durations.length ? { bestDurationSeconds: Math.min(...durations) } : {}),
  };
}

export interface TaskScoreProjection {
  nodeTestHighestScore?: number;
  outputRubricScore?: number;
  taskCompositeScore?: number;
}

export const demoTaskScorePolicy = {
  nodeTestWeight: .4,
  professionalOutputWeight: .6,
  label: '节点正式测试 40% + 专业成果 60%',
} as const;

export function calculateTaskCompositeScore(input: {
  nodeTestHighestScore?: number;
  outputRubricScore?: number;
}): TaskScoreProjection {
  const nodeTestHighestScore = input.nodeTestHighestScore === undefined
    ? undefined
    : clampScore(input.nodeTestHighestScore);
  const outputRubricScore = input.outputRubricScore === undefined
    ? undefined
    : clampScore(input.outputRubricScore);
  const projection: TaskScoreProjection = { nodeTestHighestScore, outputRubricScore };
  if (nodeTestHighestScore === undefined || outputRubricScore === undefined) return projection;
  return {
    ...projection,
    taskCompositeScore: Math.round(
      nodeTestHighestScore * demoTaskScorePolicy.nodeTestWeight
      + outputRubricScore * demoTaskScorePolicy.professionalOutputWeight,
    ),
  };
}

export function calculateProjectCompositeScore(taskOfficialScores: Array<number | undefined>): number | undefined {
  if (taskOfficialScores.length !== 3 || taskOfficialScores.some((score) => score === undefined)) return undefined;
  return Math.round(taskOfficialScores.reduce<number>((sum, score) => sum + clampScore(score ?? 0), 0) / 3);
}

export function calculateTaskGrade(input: { firstGameScore: number; secondGameScore: number; evidenceSubmitted: boolean }): number {
  const result = calculateTaskCompositeScore({
    nodeTestHighestScore: Math.max(input.firstGameScore, input.secondGameScore),
    outputRubricScore: input.evidenceSubmitted ? 100 : undefined,
  });
  return result.taskCompositeScore ?? 0;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}
