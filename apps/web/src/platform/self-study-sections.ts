export const REQUIRED_SELF_STUDY_SECTIONS = [
  'problem',
  'figure',
  'steps',
  'correction',
  'practice',
  'output',
] as const;

export type SelfStudySectionId = (typeof REQUIRED_SELF_STUDY_SECTIONS)[number];

export function hasCompletedSelfStudy(sectionIds: readonly string[]): boolean {
  const completed = new Set(sectionIds);
  return REQUIRED_SELF_STUDY_SECTIONS.every((sectionId) => completed.has(sectionId));
}
