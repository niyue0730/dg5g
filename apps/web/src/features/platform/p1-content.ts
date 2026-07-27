import { existsSync, readFileSync, type PathLike } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { getNodeLearningPolicy, type AssessmentRole } from '../../platform/learning-policy.ts';

export type P1TaskId = 'P01' | 'P02' | 'P03';
export type P1RuntimeTaskId = 'P1T1' | 'P1T2' | 'P1T3';
export type P1AssessmentRole = AssessmentRole;
export type P1NodeId = `P1T${1 | 2 | 3}-N0${1 | 2 | 3 | 4}`;

type P1NonEmptyArray<Value> = [Value, ...Value[]];

interface P1PracticeBase {
  id: string;
  prompt: string;
  expectedEvidence: string[];
  feedback: string;
  correctionPath: string[];
  retryable: true;
}

interface P1ActivityMaterial {
  id: string;
  label: string;
  detail: string;
  sourceValue?: string;
}

interface P1RevisionActivityMaterial extends P1ActivityMaterial {
  sourceValue: string;
}

interface P1ActivityCategory {
  id: string;
  label: string;
}

interface P1ActivityField {
  id: string;
  label: string;
  placeholder: string;
}

interface P1ActivityPracticeBase extends P1PracticeBase {
  targetedFeedback: { passed: string; failed: string };
  transferTarget: string;
}

type P1ActivityPractice =
  | (P1ActivityPracticeBase & {
      activityKind: 'scope-classification' | 'evidence-classification';
      materials: P1NonEmptyArray<P1ActivityMaterial>;
      interaction: {
        type: 'classification-board';
        categories: P1NonEmptyArray<P1ActivityCategory>;
        fields?: never;
      };
    })
  | (P1ActivityPracticeBase & {
      activityKind: 'link-reconstruction';
      materials: P1NonEmptyArray<P1ActivityMaterial>;
      interaction: { type: 'sequence-builder'; categories?: never; fields?: never };
    })
  | (P1ActivityPracticeBase & {
      activityKind: 'structured-record';
      materials: P1NonEmptyArray<P1ActivityMaterial>;
      interaction: {
        type: 'record-form';
        categories?: never;
        fields: P1NonEmptyArray<P1ActivityField>;
      };
    })
  | (P1ActivityPracticeBase & {
      activityKind: 'four-state-judgement';
      materials: P1NonEmptyArray<P1ActivityMaterial>;
      interaction: {
        type: 'state-matrix';
        categories: P1NonEmptyArray<P1ActivityCategory>;
        fields?: never;
      };
    })
  | (P1ActivityPracticeBase & {
      activityKind: 'defective-sheet-revision';
      materials: P1NonEmptyArray<P1RevisionActivityMaterial>;
      interaction: {
        type: 'revision-form';
        categories?: never;
        fields: P1NonEmptyArray<P1ActivityField>;
      };
    });

type P1WrittenPractice = P1PracticeBase & {
  activityKind?: never;
  materials?: never;
  interaction?: never;
  targetedFeedback?: never;
  transferTarget?: never;
};

export type P1SelfStudyPractice = P1WrittenPractice | P1ActivityPractice;

export interface P1BeginnerScaffold {
  simpleMission: string;
  analogy: string;
  threeQuestions: Array<{
    id: 'where' | 'who' | 'connects-to';
    question: string;
    evidenceType: string;
    proves: string;
    cannotProve: string;
    outputFields: string[];
  }>;
  completionStandard: string[];
}

export interface P1DeepNodeContent {
  kind: 'deep';
  nodeId: 'P1T1-N02' | 'P1T2-N02' | 'P1T3-N02';
  caseBackground: string[];
  taskQuestion: string;
  beginnerScaffold?: P1BeginnerScaffold;
  prerequisites: string[];
  glossary: Array<{ term: string; definition: string }>;
  annotatedFigures: Array<{
    kind: 'topology' | 'antenna' | 'complaint';
    title: string;
    evidenceLabels: string[];
  }>;
  evidenceRules: Array<{ claim: string; requiredEvidence: string[]; reason: string }>;
  reasoningSteps: string[];
  examples: Array<{ title: string; evidence: string[]; reasoning: string[]; conclusion: string }>;
  counterexamples: Array<{ title: string; error: string; correctionPath: string[] }>;
  practices: {
    foundation: P1SelfStudyPractice[];
    application: P1SelfStudyPractice[];
    transfer: P1SelfStudyPractice[];
  };
  transferTask: { scenario: string; deliverable: string; successCriteria: string[] };
  outputTemplate: Record<string, unknown>;
  rubric: Array<{ criterion: string; maxScore: number }>;
}

export interface P1StandardNodeContent {
  kind: 'standard';
  nodeId: Exclude<P1NodeId, P1DeepNodeContent['nodeId']>;
  caseBackground: string[];
  glossary: Array<{ term: string; definition: string }>;
  relationshipFigure: { kind: string; evidenceLabels: string[] };
  reasoningSteps: string[];
  example: { evidence: string[]; conclusion: string };
  counterexample: { error: string; correctionPath: string[] };
  microPractice: P1SelfStudyPractice[];
  nodeRecordTemplate: Record<string, unknown>;
}

export type P1SelfStudyContent = P1DeepNodeContent | P1StandardNodeContent;

export interface P1DemoNode {
  id: P1NodeId;
  title: string;
  goal: string;
  sourceKnowledgeUnitId: string;
  assessmentRole: P1AssessmentRole;
  requiresFormalTest: boolean;
  formalPassScore?: number;
  requiresProfessionalOutput: boolean;
  requiresTeacherVerification: boolean;
  professionalOutputTitle?: string;
  selfStudy: P1SelfStudyContent;
}

export type P1DemoNodeTuple = [P1DemoNode, P1DemoNode, P1DemoNode, P1DemoNode];

export interface P1WidgetSourceRef {
  id: string;
  path: `textbook/5g/widgets/${string}.json`;
}

export interface P1TaskSource {
  lessonAstId: P1TaskId;
  lessonAstPath: `textbook/5g/generated/lesson-ast/${P1TaskId}.json`;
  sourceDocumentPath: 'content/5g/5g.docx';
  storyboardSchema: 'lesson-storyboard/v1';
  knowledgeUnitRefs: [string, string, string, string];
  widgetRefs: P1WidgetSourceRef[];
  mediaRefs: string[];
}

interface P1TaskContentBase {
  title: string;
  why: string;
  taskOutputTitle: string;
  source: P1TaskSource;
  nodes: P1DemoNodeTuple;
}

export interface P01TaskContent extends P1TaskContentBase {
  taskId: 'P01';
  runtimeTaskId: 'P1T1';
  prerequisiteTaskId?: never;
}

export interface P02TaskContent extends P1TaskContentBase {
  taskId: 'P02';
  runtimeTaskId: 'P1T2';
  prerequisiteTaskId: 'P01';
}

export interface P03TaskContent extends P1TaskContentBase {
  taskId: 'P03';
  runtimeTaskId: 'P1T3';
  prerequisiteTaskId: 'P02';
}

export type P1TaskContent = P01TaskContent | P02TaskContent | P03TaskContent;

export interface P1DemoContent {
  schema: 'dgbook.p1-demo-content/v1';
  project: {
    id: 'P1';
    title: '5G网络信息采集';
    finalOutput: '5G网络信息采集成果包';
  };
  tasks: [P01TaskContent, P02TaskContent, P03TaskContent];
}

const generatedContentPath = 'textbook/5g/generated/p1-demo-content.json';

const taskSpecs = [
  {
    taskId: 'P01',
    runtimeTaskId: 'P1T1',
    taskOutputTitle: '室内设备与链路证据表',
    sourceUnitIds: ['P01-ku-01', 'P01-ku-02', 'P01-ku-03', 'P01-ku-06'],
  },
  {
    taskId: 'P02',
    runtimeTaskId: 'P1T2',
    prerequisiteTaskId: 'P01',
    taskOutputTitle: '室外站点与覆盖采集表',
    sourceUnitIds: ['P02-ku-01', 'P02-ku-02', 'P02-ku-03', 'P02-ku-06'],
  },
  {
    taskId: 'P03',
    runtimeTaskId: 'P1T3',
    prerequisiteTaskId: 'P02',
    taskOutputTitle: '投诉信息调查单',
    sourceUnitIds: ['P03-ku-01', 'P03-ku-02', 'P03-ku-03', 'P03-ku-06'],
  },
] as const;

export function loadP1DemoContent(source?: PathLike): P1DemoContent {
  const resolvedSource = source ?? resolveP1RuntimeFile(generatedContentPath);
  let serialized: string;
  try {
    serialized = readFileSync(resolvedSource, 'utf8');
  } catch (cause) {
    throw new Error(`Unable to load P1 demo content from ${String(resolvedSource)}`, { cause });
  }

  let content: unknown;
  try {
    content = JSON.parse(serialized);
  } catch (cause) {
    throw new Error(`Malformed P1 demo content JSON from ${String(resolvedSource)}`, { cause });
  }

  return validateP1DemoContent(content);
}

function validateP1DemoContent(value: unknown): P1DemoContent {
  const content = objectValue(value, '<root>');
  exactKeys(content, ['schema', 'project', 'tasks'], '<root>');
  exactValue(content.schema, 'dgbook.p1-demo-content/v1', 'schema');

  const project = objectValue(content.project, 'project');
  exactKeys(project, ['id', 'title', 'finalOutput'], 'project');
  exactValue(project.id, 'P1', 'project.id');
  exactValue(project.title, '5G网络信息采集', 'project.title');
  exactValue(project.finalOutput, '5G网络信息采集成果包', 'project.finalOutput');

  const tasks = arrayValue(content.tasks, 'tasks');
  if (tasks.length !== taskSpecs.length) invalid('tasks', `expected ${taskSpecs.length} tasks`);

  const nodeIds = new Set<string>();
  tasks.forEach((taskValue, taskIndex) => {
    const taskPath = `tasks[${taskIndex}]`;
    const task = objectValue(taskValue, taskPath);
    const spec = taskSpecs[taskIndex]!;
    const taskKeys = ['taskId', 'runtimeTaskId', 'title', 'why', 'taskOutputTitle', 'source', 'nodes'];
    if ('prerequisiteTaskId' in spec) taskKeys.push('prerequisiteTaskId');
    exactKeys(task, taskKeys, taskPath);
    exactValue(task.taskId, spec.taskId, `${taskPath}.taskId`);
    exactValue(task.runtimeTaskId, spec.runtimeTaskId, `${taskPath}.runtimeTaskId`);
    nonEmptyString(task.title, `${taskPath}.title`);
    nonEmptyString(task.why, `${taskPath}.why`);
    exactValue(task.taskOutputTitle, spec.taskOutputTitle, `${taskPath}.taskOutputTitle`);
    if ('prerequisiteTaskId' in spec) {
      exactValue(task.prerequisiteTaskId, spec.prerequisiteTaskId, `${taskPath}.prerequisiteTaskId`);
    }

    const source = objectValue(task.source, `${taskPath}.source`);
    exactKeys(source, [
      'lessonAstId',
      'lessonAstPath',
      'sourceDocumentPath',
      'storyboardSchema',
      'knowledgeUnitRefs',
      'widgetRefs',
      'mediaRefs',
    ], `${taskPath}.source`);
    exactValue(source.lessonAstId, spec.taskId, `${taskPath}.source.lessonAstId`);
    exactValue(
      source.lessonAstPath,
      `textbook/5g/generated/lesson-ast/${spec.taskId}.json`,
      `${taskPath}.source.lessonAstPath`,
    );
    exactValue(source.sourceDocumentPath, 'content/5g/5g.docx', `${taskPath}.source.sourceDocumentPath`);
    exactValue(source.storyboardSchema, 'lesson-storyboard/v1', `${taskPath}.source.storyboardSchema`);
    const sourceUnitIds = arrayValue(source.knowledgeUnitRefs, `${taskPath}.source.knowledgeUnitRefs`);
    if (sourceUnitIds.length !== 4) invalid(`${taskPath}.source.knowledgeUnitRefs`, 'expected four source units');
    sourceUnitIds.forEach((unitId, index) => {
      exactValue(unitId, spec.sourceUnitIds[index], `${taskPath}.source.knowledgeUnitRefs[${index}]`);
    });
    const sourceUnits = readSourceUnits(String(source.lessonAstPath), taskPath);
    const widgetRefs = arrayValue(source.widgetRefs, `${taskPath}.source.widgetRefs`);
    if (widgetRefs.length === 0) invalid(`${taskPath}.source.widgetRefs`, 'expected at least one widget reference');
    const widgetIds = new Set<string>();
    widgetRefs.forEach((widgetRefValue, index) => {
      const widgetPath = `${taskPath}.source.widgetRefs[${index}]`;
      const widgetRef = objectValue(widgetRefValue, widgetPath);
      exactKeys(widgetRef, ['id', 'path'], widgetPath);
      const widgetId = nonEmptyString(widgetRef.id, `${widgetPath}.id`);
      if (!widgetId.startsWith(`${spec.taskId}-`)) invalid(`${widgetPath}.id`, `expected ${spec.taskId} widget`);
      exactValue(widgetRef.path, `textbook/5g/widgets/${widgetId}.json`, `${widgetPath}.path`);
      if (widgetIds.has(widgetId)) invalid(`${widgetPath}.id`, 'widget ID must be unique');
      widgetIds.add(widgetId);
    });
    const mediaRefs = arrayValue(source.mediaRefs, `${taskPath}.source.mediaRefs`);
    if (mediaRefs.length === 0) invalid(`${taskPath}.source.mediaRefs`, 'expected at least one media reference');
    const uniqueMediaRefs = new Set<string>();
    mediaRefs.forEach((mediaRefValue, index) => {
      const mediaRef = nonEmptyString(mediaRefValue, `${taskPath}.source.mediaRefs[${index}]`);
      if (!mediaRef.startsWith('/media/')) invalid(`${taskPath}.source.mediaRefs[${index}]`, 'expected a media URL');
      if (uniqueMediaRefs.has(mediaRef)) invalid(`${taskPath}.source.mediaRefs[${index}]`, 'media reference must be unique');
      uniqueMediaRefs.add(mediaRef);
    });

    const nodes = arrayValue(task.nodes, `${taskPath}.nodes`);
    if (nodes.length !== 4) invalid(`${taskPath}.nodes`, 'expected exactly four nodes');
    nodes.forEach((nodeValue, nodeIndex) => {
      const nodePath = `${taskPath}.nodes[${nodeIndex}]`;
      const node = objectValue(nodeValue, nodePath);
      const expectedNodeId = `${spec.runtimeTaskId}-N0${nodeIndex + 1}`;
      const policy = getNodeLearningPolicy(expectedNodeId);
      if (!policy || policy.taskId !== spec.taskId) invalid(`${nodePath}.id`, 'missing authoritative learning policy');
      const nodeKeys = [
        'id',
        'title',
        'goal',
        'sourceKnowledgeUnitId',
        'assessmentRole',
        'requiresFormalTest',
        'requiresProfessionalOutput',
        'requiresTeacherVerification',
        'selfStudy',
      ];
      if (policy.formalPassScore !== undefined) nodeKeys.push('formalPassScore');
      if (policy.professionalOutputTitle !== undefined) nodeKeys.push('professionalOutputTitle');
      exactKeys(node, nodeKeys, nodePath);

      exactValue(node.id, expectedNodeId, `${nodePath}.id`);
      exactValue(node.sourceKnowledgeUnitId, spec.sourceUnitIds[nodeIndex], `${nodePath}.sourceKnowledgeUnitId`);
      exactValue(
        node.sourceKnowledgeUnitId,
        policy.sourceKnowledgeUnitId,
        `${nodePath}.sourceKnowledgeUnitId`,
      );
      const sourceUnit = sourceUnits.get(spec.sourceUnitIds[nodeIndex]!);
      if (!sourceUnit) invalid(`${nodePath}.sourceKnowledgeUnitId`, 'source knowledge unit is missing from lesson AST');
      exactValue(node.title, sourceUnit.title, `${nodePath}.title`);
      exactValue(node.goal, sourceUnit.goal, `${nodePath}.goal`);
      exactValue(
        node.assessmentRole,
        policy.assessmentRole,
        `${nodePath}.assessmentRole`,
      );
      exactValue(node.requiresFormalTest, policy.requiresFormalTest, `${nodePath}.requiresFormalTest`);
      if (policy.formalPassScore !== undefined) {
        exactValue(node.formalPassScore, policy.formalPassScore, `${nodePath}.formalPassScore`);
      }
      exactValue(node.requiresProfessionalOutput, policy.requiresProfessionalOutput, `${nodePath}.requiresProfessionalOutput`);
      exactValue(node.requiresTeacherVerification, policy.requiresTeacherVerification, `${nodePath}.requiresTeacherVerification`);
      if (policy.professionalOutputTitle !== undefined) {
        exactValue(node.professionalOutputTitle, policy.professionalOutputTitle, `${nodePath}.professionalOutputTitle`);
      }
      validateSelfStudyContent(node.selfStudy, expectedNodeId as P1NodeId, nodePath);
      if (nodeIds.has(expectedNodeId)) invalid(`${nodePath}.id`, 'node ID must be unique');
      nodeIds.add(expectedNodeId);
    });
  });

  if (nodeIds.size !== 12) invalid('tasks', 'expected twelve unique node IDs');
  return content as unknown as P1DemoContent;
}

function validateSelfStudyContent(value: unknown, nodeId: P1NodeId, nodePath: string): void {
  const selfStudyPath = `${nodePath}.selfStudy`;
  const selfStudy = objectValue(value, selfStudyPath);
  exactValue(selfStudy.nodeId, nodeId, `${selfStudyPath}.nodeId`);
  if (nodeId.endsWith('-N02')) validateDeepSelfStudy(selfStudy, nodeId, selfStudyPath);
  else validateStandardSelfStudy(selfStudy, selfStudyPath);
}

function validateDeepSelfStudy(
  content: Record<string, unknown>,
  nodeId: P1NodeId,
  path: string,
): void {
  const deepKeys = [
    'kind', 'nodeId', 'caseBackground', 'taskQuestion', 'prerequisites', 'glossary',
    'annotatedFigures', 'evidenceRules', 'reasoningSteps', 'examples', 'counterexamples',
    'practices', 'transferTask', 'outputTemplate', 'rubric',
  ];
  if ('beginnerScaffold' in content) deepKeys.push('beginnerScaffold');
  exactKeys(content, deepKeys, path);
  exactValue(content.kind, 'deep', `${path}.kind`);
  nonEmptyString(content.taskQuestion, `${path}.taskQuestion`);
  stringArray(content.caseBackground, `${path}.caseBackground`, 1);
  stringArray(content.prerequisites, `${path}.prerequisites`, 1);
  glossary(content.glossary, `${path}.glossary`);
  if ('beginnerScaffold' in content) {
    validateBeginnerScaffold(content.beginnerScaffold, `${path}.beginnerScaffold`);
  }

  const expectedFigureKinds: Record<string, string> = {
    'P1T1-N02': 'topology',
    'P1T2-N02': 'antenna',
    'P1T3-N02': 'complaint',
  };
  const figures = arrayValue(content.annotatedFigures, `${path}.annotatedFigures`);
  minimumItems(figures, 1, `${path}.annotatedFigures`);
  figures.forEach((figureValue, index) => {
    const figurePath = `${path}.annotatedFigures[${index}]`;
    const figure = objectValue(figureValue, figurePath);
    exactKeys(figure, ['kind', 'title', 'evidenceLabels'], figurePath);
    exactValue(figure.kind, expectedFigureKinds[nodeId], `${figurePath}.kind`);
    nonEmptyString(figure.title, `${figurePath}.title`);
    stringArray(figure.evidenceLabels, `${figurePath}.evidenceLabels`, 1);
  });

  const evidenceRules = arrayValue(content.evidenceRules, `${path}.evidenceRules`);
  minimumItems(evidenceRules, 1, `${path}.evidenceRules`);
  evidenceRules.forEach((ruleValue, index) => {
    const rulePath = `${path}.evidenceRules[${index}]`;
    const rule = objectValue(ruleValue, rulePath);
    exactKeys(rule, ['claim', 'requiredEvidence', 'reason'], rulePath);
    nonEmptyString(rule.claim, `${rulePath}.claim`);
    stringArray(rule.requiredEvidence, `${rulePath}.requiredEvidence`, 1);
    nonEmptyString(rule.reason, `${rulePath}.reason`);
  });
  stringArray(content.reasoningSteps, `${path}.reasoningSteps`, 4);

  const examples = arrayValue(content.examples, `${path}.examples`);
  minimumItems(examples, 2, `${path}.examples`);
  examples.forEach((exampleValue, index) => {
    const examplePath = `${path}.examples[${index}]`;
    const example = objectValue(exampleValue, examplePath);
    exactKeys(example, ['title', 'evidence', 'reasoning', 'conclusion'], examplePath);
    nonEmptyString(example.title, `${examplePath}.title`);
    stringArray(example.evidence, `${examplePath}.evidence`, 1);
    stringArray(example.reasoning, `${examplePath}.reasoning`, 1);
    nonEmptyString(example.conclusion, `${examplePath}.conclusion`);
  });

  const counterexamples = arrayValue(content.counterexamples, `${path}.counterexamples`);
  minimumItems(counterexamples, 2, `${path}.counterexamples`);
  counterexamples.forEach((counterValue, index) => {
    const counterPath = `${path}.counterexamples[${index}]`;
    const counter = objectValue(counterValue, counterPath);
    exactKeys(counter, ['title', 'error', 'correctionPath'], counterPath);
    nonEmptyString(counter.title, `${counterPath}.title`);
    nonEmptyString(counter.error, `${counterPath}.error`);
    stringArray(counter.correctionPath, `${counterPath}.correctionPath`, 1);
  });

  const practices = objectValue(content.practices, `${path}.practices`);
  exactKeys(practices, ['foundation', 'application', 'transfer'], `${path}.practices`);
  for (const level of ['foundation', 'application', 'transfer'] as const) {
    validatePractices(practices[level], `${path}.practices.${level}`);
  }

  const transferTask = objectValue(content.transferTask, `${path}.transferTask`);
  exactKeys(transferTask, ['scenario', 'deliverable', 'successCriteria'], `${path}.transferTask`);
  nonEmptyString(transferTask.scenario, `${path}.transferTask.scenario`);
  nonEmptyString(transferTask.deliverable, `${path}.transferTask.deliverable`);
  stringArray(transferTask.successCriteria, `${path}.transferTask.successCriteria`, 1);
  nonEmptyObject(content.outputTemplate, `${path}.outputTemplate`);

  const rubric = arrayValue(content.rubric, `${path}.rubric`);
  minimumItems(rubric, 1, `${path}.rubric`);
  let rubricTotal = 0;
  rubric.forEach((criterionValue, index) => {
    const criterionPath = `${path}.rubric[${index}]`;
    const criterion = objectValue(criterionValue, criterionPath);
    exactKeys(criterion, ['criterion', 'maxScore'], criterionPath);
    nonEmptyString(criterion.criterion, `${criterionPath}.criterion`);
    if (!Number.isInteger(criterion.maxScore) || Number(criterion.maxScore) <= 0 || Number(criterion.maxScore) > 100) {
      invalid(`${criterionPath}.maxScore`, 'expected an integer from 1 to 100');
    }
    rubricTotal += Number(criterion.maxScore);
  });
  if (rubricTotal !== 100) invalid(`${path}.rubric`, `expected maxScore total 100, received ${rubricTotal}`);
}

function validateStandardSelfStudy(content: Record<string, unknown>, path: string): void {
  exactKeys(content, [
    'kind', 'nodeId', 'caseBackground', 'glossary', 'relationshipFigure',
    'reasoningSteps', 'example', 'counterexample', 'microPractice', 'nodeRecordTemplate',
  ], path);
  exactValue(content.kind, 'standard', `${path}.kind`);
  stringArray(content.caseBackground, `${path}.caseBackground`, 1);
  glossary(content.glossary, `${path}.glossary`);
  const figure = objectValue(content.relationshipFigure, `${path}.relationshipFigure`);
  exactKeys(figure, ['kind', 'evidenceLabels'], `${path}.relationshipFigure`);
  nonEmptyString(figure.kind, `${path}.relationshipFigure.kind`);
  stringArray(figure.evidenceLabels, `${path}.relationshipFigure.evidenceLabels`, 1);
  stringArray(content.reasoningSteps, `${path}.reasoningSteps`, 3);
  const example = objectValue(content.example, `${path}.example`);
  exactKeys(example, ['evidence', 'conclusion'], `${path}.example`);
  stringArray(example.evidence, `${path}.example.evidence`, 1);
  nonEmptyString(example.conclusion, `${path}.example.conclusion`);
  const counterexample = objectValue(content.counterexample, `${path}.counterexample`);
  exactKeys(counterexample, ['error', 'correctionPath'], `${path}.counterexample`);
  nonEmptyString(counterexample.error, `${path}.counterexample.error`);
  stringArray(counterexample.correctionPath, `${path}.counterexample.correctionPath`, 1);
  validatePractices(content.microPractice, `${path}.microPractice`);
  nonEmptyObject(content.nodeRecordTemplate, `${path}.nodeRecordTemplate`);
}

function validatePractices(value: unknown, path: string): void {
  const practices = arrayValue(value, path);
  minimumItems(practices, 1, path);
  practices.forEach((practiceValue, index) => {
    const practicePath = `${path}[${index}]`;
    const practice = objectValue(practiceValue, practicePath);
    const baseKeys = ['id', 'prompt', 'expectedEvidence', 'feedback', 'correctionPath', 'retryable'];
    const activityKeys = ['activityKind', 'materials', 'interaction', 'targetedFeedback', 'transferTarget'];
    exactKeys(practice, 'activityKind' in practice ? [...baseKeys, ...activityKeys] : baseKeys, practicePath);
    nonEmptyString(practice.id, `${practicePath}.id`);
    nonEmptyString(practice.prompt, `${practicePath}.prompt`);
    stringArray(practice.expectedEvidence, `${practicePath}.expectedEvidence`, 1);
    nonEmptyString(practice.feedback, `${practicePath}.feedback`);
    stringArray(practice.correctionPath, `${practicePath}.correctionPath`, 1);
    exactValue(practice.retryable, true, `${practicePath}.retryable`);
    if ('activityKind' in practice) validateActivityPractice(practice, practicePath);
  });
}

function validateActivityPractice(practice: Record<string, unknown>, path: string): void {
  const activityKind = nonEmptyString(practice.activityKind, `${path}.activityKind`);
  if (![
    'scope-classification', 'evidence-classification', 'link-reconstruction',
    'structured-record', 'four-state-judgement', 'defective-sheet-revision',
  ].includes(activityKind)) invalid(`${path}.activityKind`, 'expected a supported activity kind');
  const materials = arrayValue(practice.materials, `${path}.materials`);
  minimumItems(materials, 1, `${path}.materials`);
  materials.forEach((value, index) => {
    const materialPath = `${path}.materials[${index}]`;
    const material = objectValue(value, materialPath);
    const requiresSourceValue = activityKind === 'defective-sheet-revision';
    exactKeys(material, requiresSourceValue || 'sourceValue' in material
      ? ['id', 'label', 'detail', 'sourceValue']
      : ['id', 'label', 'detail'], materialPath);
    nonEmptyString(material.id, `${materialPath}.id`);
    nonEmptyString(material.label, `${materialPath}.label`);
    nonEmptyString(material.detail, `${materialPath}.detail`);
    if (requiresSourceValue || 'sourceValue' in material) {
      nonEmptyString(material.sourceValue, `${materialPath}.sourceValue`);
    }
  });
  const interaction = objectValue(practice.interaction, `${path}.interaction`);
  switch (activityKind) {
    case 'scope-classification':
    case 'evidence-classification':
      exactKeys(interaction, ['type', 'categories'], `${path}.interaction`);
      exactValue(interaction.type, 'classification-board', `${path}.interaction.type`);
      validateActivityCategories(interaction.categories, `${path}.interaction.categories`);
      break;
    case 'link-reconstruction':
      exactKeys(interaction, ['type'], `${path}.interaction`);
      exactValue(interaction.type, 'sequence-builder', `${path}.interaction.type`);
      break;
    case 'structured-record':
      exactKeys(interaction, ['type', 'fields'], `${path}.interaction`);
      exactValue(interaction.type, 'record-form', `${path}.interaction.type`);
      validateActivityFields(interaction.fields, `${path}.interaction.fields`);
      break;
    case 'four-state-judgement':
      exactKeys(interaction, ['type', 'categories'], `${path}.interaction`);
      exactValue(interaction.type, 'state-matrix', `${path}.interaction.type`);
      validateActivityCategories(interaction.categories, `${path}.interaction.categories`);
      break;
    case 'defective-sheet-revision':
      exactKeys(interaction, ['type', 'fields'], `${path}.interaction`);
      exactValue(interaction.type, 'revision-form', `${path}.interaction.type`);
      validateActivityFields(interaction.fields, `${path}.interaction.fields`);
      break;
  }
  const feedback = objectValue(practice.targetedFeedback, `${path}.targetedFeedback`);
  exactKeys(feedback, ['passed', 'failed'], `${path}.targetedFeedback`);
  nonEmptyString(feedback.passed, `${path}.targetedFeedback.passed`);
  nonEmptyString(feedback.failed, `${path}.targetedFeedback.failed`);
  nonEmptyString(practice.transferTarget, `${path}.transferTarget`);
}

function validateActivityCategories(value: unknown, path: string): void {
  const categories = arrayValue(value, path);
  minimumItems(categories, 1, path);
  categories.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    const item = objectValue(value, itemPath);
    exactKeys(item, ['id', 'label'], itemPath);
    nonEmptyString(item.id, `${itemPath}.id`);
    nonEmptyString(item.label, `${itemPath}.label`);
  });
}

function validateActivityFields(value: unknown, path: string): void {
  const fields = arrayValue(value, path);
  minimumItems(fields, 1, path);
  fields.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    const item = objectValue(value, itemPath);
    exactKeys(item, ['id', 'label', 'placeholder'], itemPath);
    nonEmptyString(item.id, `${itemPath}.id`);
    nonEmptyString(item.label, `${itemPath}.label`);
    nonEmptyString(item.placeholder, `${itemPath}.placeholder`);
  });
}

function glossary(value: unknown, path: string): void {
  const entries = arrayValue(value, path);
  minimumItems(entries, 3, path);
  entries.forEach((entryValue, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = objectValue(entryValue, entryPath);
    exactKeys(entry, ['term', 'definition'], entryPath);
    nonEmptyString(entry.term, `${entryPath}.term`);
    nonEmptyString(entry.definition, `${entryPath}.definition`);
  });
}

function validateBeginnerScaffold(value: unknown, path: string): void {
  const scaffold = objectValue(value, path);
  exactKeys(scaffold, ['simpleMission', 'analogy', 'threeQuestions', 'completionStandard'], path);
  nonEmptyString(scaffold.simpleMission, `${path}.simpleMission`);
  nonEmptyString(scaffold.analogy, `${path}.analogy`);
  stringArray(scaffold.completionStandard, `${path}.completionStandard`, 2);
  const questions = arrayValue(scaffold.threeQuestions, `${path}.threeQuestions`);
  if (questions.length !== 3) invalid(`${path}.threeQuestions`, 'expected exactly three beginner questions');
  const expectedIds = ['where', 'who', 'connects-to'];
  questions.forEach((questionValue, index) => {
    const questionPath = `${path}.threeQuestions[${index}]`;
    const question = objectValue(questionValue, questionPath);
    exactKeys(question, ['id', 'question', 'evidenceType', 'proves', 'cannotProve', 'outputFields'], questionPath);
    exactValue(question.id, expectedIds[index]!, `${questionPath}.id`);
    nonEmptyString(question.question, `${questionPath}.question`);
    nonEmptyString(question.evidenceType, `${questionPath}.evidenceType`);
    nonEmptyString(question.proves, `${questionPath}.proves`);
    nonEmptyString(question.cannotProve, `${questionPath}.cannotProve`);
    stringArray(question.outputFields, `${questionPath}.outputFields`, 1);
  });
}

function stringArray(value: unknown, path: string, minimum: number): string[] {
  const values = arrayValue(value, path);
  minimumItems(values, minimum, path);
  return values.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
}

function minimumItems(values: unknown[], minimum: number, path: string): void {
  if (values.length < minimum) invalid(path, `expected at least ${minimum} items`);
}

function nonEmptyObject(value: unknown, path: string): Record<string, unknown> {
  const object = objectValue(value, path);
  if (Object.keys(object).length === 0) invalid(path, 'expected a non-empty object');
  return object;
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected an object');
  return value as Record<string, unknown>;
}

function readSourceUnits(lessonAstPath: string, taskPath: string): Map<string, { title: string; goal: string }> {
  let lessonAstValue: unknown;
  try {
    lessonAstValue = JSON.parse(readFileSync(resolveP1RuntimeFile(lessonAstPath), 'utf8')) as unknown;
  } catch (cause) {
    throw new Error(`Invalid P1 demo content at ${taskPath}.source.lessonAstPath: source lesson AST is unavailable`, { cause });
  }
  const lessonAst = objectValue(lessonAstValue, `${taskPath}.source.lessonAst`);
  const content = objectValue(lessonAst.content, `${taskPath}.source.lessonAst.content`);
  const storyboard = objectValue(content.storyboard, `${taskPath}.source.lessonAst.content.storyboard`);
  const units = arrayValue(storyboard.knowledgeUnits, `${taskPath}.source.lessonAst.content.storyboard.knowledgeUnits`);
  const sourceUnits = new Map<string, { title: string; goal: string }>();
  units.forEach((unitValue, index) => {
    const unitPath = `${taskPath}.source.lessonAst.content.storyboard.knowledgeUnits[${index}]`;
    const unit = objectValue(unitValue, unitPath);
    const id = nonEmptyString(unit.id, `${unitPath}.id`);
    sourceUnits.set(id, {
      title: nonEmptyString(unit.title, `${unitPath}.title`),
      goal: nonEmptyString(unit.shortText, `${unitPath}.shortText`),
    });
  });
  return sourceUnits;
}

function resolveP1RuntimeFile(relativePath: string): string {
  const repositoryRoot = resolveDgbookRepositoryRoot(process.cwd());
  const generatedRoot = resolve(repositoryRoot, 'textbook', '5g', 'generated');
  const resolvedPath = resolve(repositoryRoot, relativePath);
  const pathFromGeneratedRoot = relative(generatedRoot, resolvedPath);
  if (
    pathFromGeneratedRoot === ''
    || pathFromGeneratedRoot === '..'
    || pathFromGeneratedRoot.startsWith(`..${sep}`)
    || resolve(generatedRoot, pathFromGeneratedRoot) !== resolvedPath
  ) {
    throw new Error(`P1 runtime content path must stay within textbook/5g/generated: ${relativePath}`);
  }
  return resolvedPath;
}

function resolveDgbookRepositoryRoot(workingDirectory: string): string {
  const normalizedWorkingDirectory = resolve(workingDirectory);
  const standaloneRuntimeRoot = join(normalizedWorkingDirectory, 'runtime');
  if (isDgbookStandaloneRuntimeRoot(standaloneRuntimeRoot)) return standaloneRuntimeRoot;
  if (isDgbookRepositoryRoot(normalizedWorkingDirectory)) return normalizedWorkingDirectory;

  const packageRepositoryRoot = resolve(normalizedWorkingDirectory, '..', '..');
  if (
    normalizedWorkingDirectory === join(packageRepositoryRoot, 'apps', 'web')
    && (
      isDgbookStandaloneRuntimeRoot(packageRepositoryRoot)
      || isDgbookRepositoryRoot(packageRepositoryRoot)
    )
  ) return packageRepositoryRoot;

  throw new Error(
    `Unable to resolve DGBook repository root from ${normalizedWorkingDirectory}; expected the repository root or apps/web`,
  );
}

function isDgbookStandaloneRuntimeRoot(candidate: string): boolean {
  return existsSync(join(candidate, 'apps', 'web', 'package.json'))
    && existsSync(join(candidate, generatedContentPath));
}

function isDgbookRepositoryRoot(candidate: string): boolean {
  return existsSync(join(candidate, 'pnpm-workspace.yaml'))
    && existsSync(join(candidate, 'apps', 'web', 'package.json'));
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'expected an array');
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(path, 'expected a non-empty string');
  return value;
}

function exactValue(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) invalid(path, `expected ${JSON.stringify(expected)}`);
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    invalid(path, `expected keys ${required.join(', ')}`);
  }
}

function invalid(path: string, message: string): never {
  throw new Error(`Invalid P1 demo content at ${path}: ${message}`);
}
