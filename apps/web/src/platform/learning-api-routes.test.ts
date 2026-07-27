import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AuthService } from './auth/auth-service.ts';
import { AUTH_COOKIE_NAME } from './auth/cookie.ts';
import { closeDatabase, type AppDatabase } from './db/database.ts';
import { seedDemo } from './db/demo-seed.ts';
import { migrateDatabase } from './db/migrations.ts';
import { createTestDatabase, insertCompletedSelfStudySections } from './db/test-database.ts';
import { LearningRepository } from './learning-repository.ts';
import { loadSelfStudyCatalog } from '../features/textbook-scene/self-study-content.ts';
import { professionalOutputSchemaForTask } from '../features/portfolio/output-schema.ts';
import { p01Activities } from '../features/learning-activities/activity-catalog.ts';
import { p01EvidenceLibrary } from '../features/portfolio/evidence-library.ts';
import { ActivityRepository } from '../features/learning-activities/activity-repository.ts';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const sourcePath = resolve(process.cwd(), 'apps/web/src', specifier.slice(2));
      const candidate = [`${sourcePath}.ts`, `${sourcePath}.tsx`, resolve(sourcePath, 'index.ts')].find(existsSync);
      if (candidate) return nextResolve(pathToFileURL(candidate).href, context);
    }
    if (specifier.startsWith('.') && context.parentURL?.includes('/apps/web/src/') && !specifier.endsWith('.ts') && !specifier.endsWith('.tsx')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const meRoute = await import('../app/api/learning/me/route.ts');
const eventRoute = await import('../app/api/learning/nodes/[nodeId]/events/route.ts');
const attemptRoute = await import('../app/api/learning/nodes/[nodeId]/attempts/route.ts');
const classRoute = await import('../app/api/learning/class/[classId]/route.ts');
const outputRoute = await import('../app/api/outputs/[taskId]/route.ts');
const outputDraftRoute = await import('../app/api/outputs/[taskId]/draft/route.ts');
const outputSubmitRoute = await import('../app/api/outputs/[taskId]/submit/route.ts');

test('every actor-scoped learning endpoint rejects an anonymous request', async () => {
  const responses = await Promise.all([
    meRoute.GET(new Request('http://localhost/api/learning/me')),
    eventRoute.POST(new Request('http://localhost/api/learning/nodes/P1T1-N02/events', { method: 'POST' }), { params: { nodeId: 'P1T1-N02' } }),
    attemptRoute.POST(new Request('http://localhost/api/learning/nodes/P1T1-N02/attempts', { method: 'POST' }), { params: { nodeId: 'P1T1-N02' } }),
    classRoute.GET(new Request('http://localhost/api/learning/class/demo-class'), { params: { classId: 'demo-class' } }),
    outputRoute.GET(new Request('http://localhost/api/outputs/P01'), { params: { taskId: 'P01' } }),
    outputDraftRoute.POST(new Request('http://localhost/api/outputs/P01/draft', { method: 'POST' }), { params: { taskId: 'P01' } }),
    outputSubmitRoute.POST(new Request('http://localhost/api/outputs/P01/submit', { method: 'POST' }), { params: { taskId: 'P01' } }),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401, 401, 401, 401]);
  for (const response of responses) {
    assert.deepEqual(await response.json(), { error: 'Authentication required' });
  }
});

test('professional output routes derive ownership from Cookie and expose the authorized output envelope', async () => {
  await withAuthenticatedFixture(async ({ database, studentTwoCookie }) => {
    database.prepare(`
      DELETE FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).run();
    const schema = professionalOutputSchemaForTask(loadSelfStudyCatalog(), 'P01');
    const fields = Object.fromEntries(schema.fields.map(({ key, label }) => [key, `已填写：${label}`]));
    const draftResponse = await outputDraftRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/draft',
      studentTwoCookie,
      {
        expectedStateRevision: 0,
        fields,
        upstreamRefs: [],
        evidenceLinks: { siteRoom: ['P01-EV-ROOM-OVERVIEW'] },
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    assert.equal(draft.head.studentId, 'stu-02');
    assert.equal(draft.head.status, 'draft');

    const staleResponse = await outputSubmitRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/submit',
      studentTwoCookie,
      {
        outputId: draft.head.outputId,
        expectedStateRevision: 0,
        fields,
        upstreamRefs: [],
        evidenceLinks: { siteRoom: ['P01-EV-ROOM-OVERVIEW'] },
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json()).actualStateRevision, 1);

    const submitResponse = await outputSubmitRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/submit',
      studentTwoCookie,
      {
        outputId: draft.head.outputId,
        expectedStateRevision: 1,
        fields,
        upstreamRefs: [],
        evidenceLinks: { siteRoom: ['P01-EV-ROOM-OVERVIEW'] },
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(submitResponse.status, 200);
    assert.equal((await submitResponse.json()).head.status, 'submitted');

    const readResponse = outputRoute.GET(new Request(
      `http://localhost/api/outputs/P01?outputId=${encodeURIComponent(draft.head.outputId)}`,
      { headers: { cookie: studentTwoCookie } },
    ), { params: { taskId: 'P01' } });
    assert.equal(readResponse.status, 200);
    const envelope = await readResponse.json();
    assert.deepEqual(Object.keys(envelope).sort(), ['evidenceLibrary', 'output', 'prefill']);
    assert.equal(envelope.output.head.studentId, 'stu-02');
    assert.equal(envelope.output.head.stateRevision, 2);
    assert.equal(envelope.output.versions.length, 1);
    assert.equal(envelope.output.versions[0].evidenceLinks.siteRoom[0], 'P01-EV-ROOM-OVERVIEW');
    assert.equal(typeof envelope.prefill, 'object');
    assert.equal(envelope.evidenceLibrary.length, p01EvidenceLibrary.length);
    assert.equal(envelope.evidenceLibrary[0].origin, 'demo');
  });
});

test('P01 GET projects passed activity facts and draft persistence derives field sources server-side', async () => {
  await withAuthenticatedFixture(async ({ database, studentTwoCookie }) => {
    database.prepare(`
      DELETE FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).run();
    const activity = p01Activities.find(({ activity: item }) => item.id === 'P1T1-N01-micro-01');
    assert.ok(activity);
    new ActivityRepository(database).recordEvaluatedAttempt({
      attemptId: 'route-prefill-scope',
      studentId: 'stu-02',
      activity,
      response: { assignments: {
        'room-01-cabinets': 'in-scope',
        'shared-operator-cabinet': 'out-of-scope',
        'room-02-cabinets': 'out-of-scope',
      }, reasons: { 'shared-operator-cabinet': '柜门标识属于其他运营商，不能混入本次任务台账。', 'room-02-cabinets': '02号机房不在任务单的01号机房范围内，本次先排除。' } },
      expectedVersion: 0,
    });

    const readResponse = outputRoute.GET(new Request(
      'http://localhost/api/outputs/P01',
      { headers: { cookie: studentTwoCookie } },
    ), { params: { taskId: 'P01' } });
    assert.equal(readResponse.status, 200);
    const envelope = await readResponse.json();
    assert.equal(envelope.output, null);
    assert.match(envelope.prefill.siteRoom.value, /01号机房/);
    assert.deepEqual(envelope.prefill.siteRoom.sources, [
      { sourceNodeId: 'P1T1-N01', sourceAttemptId: 'route-prefill-scope' },
      { sourceNodeId: 'P1T1-N02', sourceAttemptId: 'demo-stu2-n02-transfer' },
    ]);

    const draftResponse = await outputDraftRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/draft',
      studentTwoCookie,
      {
        expectedStateRevision: 0,
        fields: { siteRoom: envelope.prefill.siteRoom.value },
        upstreamRefs: [],
        evidenceLinks: {},
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    assert.deepEqual(draft.versions[0].fieldSources, [
      { fieldKey: 'siteRoom', sourceNodeId: 'P1T1-N01', sourceAttemptId: 'route-prefill-scope' },
      { fieldKey: 'siteRoom', sourceNodeId: 'P1T1-N02', sourceAttemptId: 'demo-stu2-n02-transfer' },
    ]);
  });
});

test('professional output mutation routes reject every client-owned identity, source, workflow, review, and score key atomically', async () => {
  await withAuthenticatedFixture(async ({ database, studentTwoCookie }) => {
    database.prepare(`
      DELETE FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).run();
    const schema = professionalOutputSchemaForTask(loadSelfStudyCatalog(), 'P01');
    const fields = Object.fromEntries(schema.fields.map(({ key, label }) => [key, `已填写：${label}`]));
    const before = outputMutationCounts(database, 'stu-02');
    for (const [forgedKey, forgedValue] of Object.entries({
      studentId: 'stu-03',
      fieldSources: [{ fieldKey: 'siteRoom', sourceNodeId: 'P1T1-N01', sourceAttemptId: 'forged' }],
      sourceNodeId: 'P1T1-N01',
      origin: 'user',
      status: 'verified',
      version: 99,
      review: { status: 'verified' },
      score: 100,
    })) {
      const response = await outputDraftRoute.POST(jsonRequest(
        'http://localhost/api/outputs/P01/draft',
        studentTwoCookie,
        {
          expectedStateRevision: 0,
          fields,
          upstreamRefs: [],
          evidenceLinks: {},
          [forgedKey]: forgedValue,
        },
      ), { params: { taskId: 'P01' } });
      assert.equal(response.status, 400, forgedKey);
      assert.match((await response.json()).error, /unsupported|unknown|command/i, forgedKey);
    }
    assert.deepEqual(outputMutationCounts(database, 'stu-02'), before);
  });
});

test('professional output routes reject unknown and cross-field evidence with 422 and no partial facts', async () => {
  await withAuthenticatedFixture(async ({ database, studentTwoCookie }) => {
    database.prepare(`
      DELETE FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).run();
    const fields = Object.fromEntries(
      professionalOutputSchemaForTask(loadSelfStudyCatalog(), 'P01').fields
        .map(({ key, label }) => [key, `已填写：${label}`]),
    );
    const before = outputMutationCounts(database, 'stu-02');
    for (const evidenceLinks of [
      { siteRoom: ['FORGED-EVIDENCE'] },
      { siteRoom: ['P01-EV-BBU-NAMEPLATE'] },
    ]) {
      const response = await outputDraftRoute.POST(jsonRequest(
        'http://localhost/api/outputs/P01/draft',
        studentTwoCookie,
        { expectedStateRevision: 0, fields, upstreamRefs: [], evidenceLinks },
      ), { params: { taskId: 'P01' } });
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /evidence/i);
      assert.deepEqual(outputMutationCounts(database, 'stu-02'), before);
    }
  });
});

test('a returned output maps unchanged resubmission to 422 and accepts a semantic field revision as V2', async () => {
  await withAuthenticatedFixture(async ({ database, studentTwoCookie }) => {
    database.prepare(`
      DELETE FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).run();
    const fields = Object.fromEntries(
      professionalOutputSchemaForTask(loadSelfStudyCatalog(), 'P01').fields
        .map(({ key, label }) => [key, `已填写：${label}`]),
    );
    const draftResponse = await outputDraftRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/draft', studentTwoCookie,
      { expectedStateRevision: 0, fields, upstreamRefs: [], evidenceLinks: {} },
    ), { params: { taskId: 'P01' } });
    const draft = await draftResponse.json();
    const submitResponse = await outputSubmitRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/submit', studentTwoCookie,
      {
        outputId: draft.head.outputId, expectedStateRevision: 1,
        fields, upstreamRefs: [], evidenceLinks: {},
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(submitResponse.status, 200);
    database.prepare(`
      UPDATE professional_outputs
      SET status = 'returned', state_revision = 3
      WHERE output_id = ?
    `).run(draft.head.outputId);

    const beforeRejected = outputMutationCounts(database, 'stu-02');
    const unchangedResponse = await outputSubmitRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/submit', studentTwoCookie,
      {
        outputId: draft.head.outputId, expectedStateRevision: 3,
        fields, upstreamRefs: [], evidenceLinks: {},
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(unchangedResponse.status, 422);
    assert.match((await unchangedResponse.json()).error, /revised version/i);
    assert.deepEqual(outputMutationCounts(database, 'stu-02'), beforeRejected);

    const revisedResponse = await outputSubmitRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/submit', studentTwoCookie,
      {
        outputId: draft.head.outputId, expectedStateRevision: 3,
        fields: { ...fields, connectionDirection: 'BBU → ODF → AAU，已补充连续路径证据' },
        upstreamRefs: [], evidenceLinks: {},
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(revisedResponse.status, 200);
    const revised = await revisedResponse.json();
    assert.equal(revised.head.status, 'submitted');
    assert.equal(revised.head.currentVersion, 2);
    assert.equal(revised.submissionCount, 2);
  });
});

test('P02 reads retain the same envelope with no P01 prefill and the P02 evidence catalog', async () => {
  await withAuthenticatedFixture(async ({ studentThreeCookie }) => {
    const response = outputRoute.GET(new Request('http://localhost/api/outputs/P02', {
      headers: { cookie: studentThreeCookie },
    }), { params: { taskId: 'P02' } });
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.equal(envelope.output.head.taskId, 'P02');
    assert.deepEqual(envelope.prefill, {});
    assert.equal(envelope.evidenceLibrary.length, 6);
    assert.ok(envelope.evidenceLibrary.every(({ taskId }: { taskId: string }) => taskId === 'P02'));
  });
});

test('professional output routes allow incomplete drafts but reject unknown fields and incomplete submissions server-side', async () => {
  await withAuthenticatedFixture(async ({ database, studentTwoCookie }) => {
    database.prepare(`
      DELETE FROM professional_outputs
      WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).run();
    const schema = professionalOutputSchemaForTask(loadSelfStudyCatalog(), 'P01');
    const first = schema.fields[0]!;
    const unknownResponse = await outputDraftRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/draft',
      studentTwoCookie,
      {
        expectedStateRevision: 0,
        fields: { [first.key]: '部分证据', inventedField: '不属于教材模板' },
        upstreamRefs: [],
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(unknownResponse.status, 400);
    assert.equal(database.prepare(`
      SELECT COUNT(*) FROM professional_outputs WHERE student_id = 'stu-02' AND task_id = 'P01'
    `).pluck().get(), 0);

    const draftResponse = await outputDraftRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/draft',
      studentTwoCookie,
      {
        expectedStateRevision: 0,
        fields: { [first.key]: '部分证据' },
        upstreamRefs: [],
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();

    const incompleteSubmit = await outputSubmitRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/submit',
      studentTwoCookie,
      {
        outputId: draft.head.outputId,
        expectedStateRevision: 1,
        fields: { [first.key]: '部分证据' },
        upstreamRefs: [],
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(incompleteSubmit.status, 400);
    assert.deepEqual(database.prepare(`
      SELECT status, state_revision AS stateRevision
      FROM professional_outputs WHERE output_id = ?
    `).get(draft.head.outputId), { status: 'draft', stateRevision: 1 });

    const completeFields = Object.fromEntries(
      schema.fields.map(({ key, label }) => [key, `已填写：${label}`]),
    );
    const completeSubmit = await outputSubmitRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/submit',
      studentTwoCookie,
      {
        outputId: draft.head.outputId,
        expectedStateRevision: 1,
        fields: completeFields,
        upstreamRefs: [],
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(completeSubmit.status, 200);
  });
});

test('professional output submit rejects numeric and array values for text fields with zero side effects', async () => {
  for (const invalidValue of [0, ['伪造为文本数组']]) {
    await withAuthenticatedFixture(async ({ database, studentTwoCookie }) => {
      database.prepare(`
        DELETE FROM professional_outputs
        WHERE student_id = 'stu-02' AND task_id = 'P01'
      `).run();
      const schema = professionalOutputSchemaForTask(loadSelfStudyCatalog(), 'P01');
      const fields: Record<string, unknown> = Object.fromEntries(
        schema.fields.map(({ key, label }) => [key, `已填写：${label}`]),
      );
      fields[schema.fields[0]!.key] = invalidValue;
      const before = outputMutationCounts(database, 'stu-02');
      const response = await outputSubmitRoute.POST(jsonRequest(
        'http://localhost/api/outputs/P01/submit',
        studentTwoCookie,
        { expectedStateRevision: 0, fields, upstreamRefs: [], evidenceLinks: {} },
      ), { params: { taskId: 'P01' } });
      assert.equal(response.status, 400, JSON.stringify(invalidValue));
      assert.match((await response.json()).error, /text|non-empty|string/i);
      assert.deepEqual(outputMutationCounts(database, 'stu-02'), before);
    });
  }
});

test('professional output routes fail closed for teacher, locked, not-open, unknown, and non-owned requests', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie, studentTwoCookie, teacherCookie }) => {
    const command = {
      expectedStateRevision: 0,
      fields: { summary: 'must not persist' },
      upstreamRefs: [],
    };
    const cases = [
      ['P01', 403, 'locked'],
      ['P04', 409, 'not-open'],
      ['does-not-exist', 404, 'not-found'],
    ] as const;
    for (const [taskId, expectedStatus, routeState] of cases) {
      const draftResponse = await outputDraftRoute.POST(jsonRequest(
        `http://localhost/api/outputs/${taskId}/draft`,
        studentCookie,
        command,
      ), { params: { taskId } });
      assert.equal(draftResponse.status, expectedStatus);
      assert.equal((await draftResponse.json()).routeState, routeState);

      const readResponse = outputRoute.GET(new Request(
        `http://localhost/api/outputs/${taskId}`,
        { headers: { cookie: studentCookie } },
      ), { params: { taskId } });
      assert.equal(readResponse.status, expectedStatus);
      const readBody = await readResponse.json();
      assert.equal('output' in readBody, false);
      assert.equal('prefill' in readBody, false);
      assert.equal('evidenceLibrary' in readBody, false);
    }
    const teacherResponse = await outputDraftRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/draft',
      teacherCookie,
      command,
    ), { params: { taskId: 'P01' } });
    assert.equal(teacherResponse.status, 403);

    const nonOwnerResponse = outputRoute.GET(new Request(
      'http://localhost/api/outputs/P01?outputId=demo-output-stu-03-p1t1-n04',
      { headers: { cookie: studentTwoCookie } },
    ), { params: { taskId: 'P01' } });
    assert.equal(nonOwnerResponse.status, 404);
    const nonOwnerMutation = await outputDraftRoute.POST(jsonRequest(
      'http://localhost/api/outputs/P01/draft',
      studentTwoCookie,
      {
        outputId: 'demo-output-stu-03-p1t1-n04',
        expectedStateRevision: 1,
        fields: { siteRoom: 'forged overwrite' },
        upstreamRefs: [],
        evidenceLinks: {},
      },
    ), { params: { taskId: 'P01' } });
    assert.equal(nonOwnerMutation.status, 404);
    assert.equal(database.prepare(`
      SELECT COUNT(*) FROM professional_outputs WHERE student_id = 'stu-01'
    `).pluck().get(), 0);
  });
});

test('event POST derives student identity only from the HttpOnly session actor', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie }) => {
    const repository = new LearningRepository(database);
    const before = repository.readTopicVersion('learning:stu-01');
    const response = await eventRoute.POST(new Request('http://localhost/api/learning/nodes/P1T1-N02/events', {
      method: 'POST',
      headers: { cookie: studentCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: 'route-section-event',
        studentId: 'stu-02',
        channel: 'self-study',
        eventType: 'section_completed',
        payload: { sectionId: 'figure', completed: true },
        expectedVersion: before,
      }),
    }), { params: { nodeId: 'P1T1-N02' } });

    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.studentId, 'stu-01');
    assert.equal(snapshot.version, before + 1);
    assert.equal(repository.readStudentFacts('stu-02').events.some((event) => event.eventId === 'route-section-event'), false);
  });
});

test('legacy formal-attempt POST rejects a client-provided score without mutation', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie }) => {
    const repository = new LearningRepository(database);
    const before = repository.readTopicVersion('learning:stu-01');
    const response = await attemptRoute.POST(new Request('http://localhost/api/learning/nodes/P1T1-N02/attempts', {
      method: 'POST',
      headers: { cookie: studentCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'route-formal-attempt',
        studentId: 'stu-02',
        gameId: 'node-test',
        score: 84,
        durationSeconds: 180,
        mistakeKnowledgePointIds: [],
        expectedVersion: before,
      }),
    }), { params: { nodeId: 'P1T1-N02' } });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Client-scored formal attempts/i);
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
    assert.equal(repository.readStudentFacts('stu-01').attempts.some((attempt) => attempt.attemptId === 'route-formal-attempt'), false);
    assert.equal(repository.readStudentFacts('stu-02').attempts.some((attempt) => attempt.attemptId === 'route-formal-attempt'), false);
  });
});

test('write routes expose the canonical locked, not-open, and not-found status matrix without mutation', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie }) => {
    const repository = new LearningRepository(database);
    const before = repository.readTopicVersion('learning:stu-01');
    const cases = [
      ['P1T1-N04', 403, 'locked'],
      ['P4T2-N04', 409, 'not-open'],
      ['does-not-exist', 404, 'not-found'],
    ] as const;

    for (const [nodeId, status, routeState] of cases) {
      const response = await eventRoute.POST(new Request(`http://localhost/api/learning/nodes/${nodeId}/events`, {
        method: 'POST',
        headers: { cookie: studentCookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: `closed-route-${routeState}`,
          channel: 'self-study',
          eventType: 'micro_practice_passed',
          expectedVersion: before,
        }),
      }), { params: { nodeId } });
      assert.equal(response.status, status);
      assert.equal((await response.json()).routeState, routeState);
    }
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
  });
});

test('event POST rejects string and array payloads as malformed commands', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie }) => {
    const repository = new LearningRepository(database);
    const before = repository.readTopicVersion('learning:stu-01');
    for (const [index, payload] of ['malicious-string', ['malicious-array']].entries()) {
      const response = await eventRoute.POST(new Request('http://localhost/api/learning/nodes/P1T1-N02/events', {
        method: 'POST',
        headers: { cookie: studentCookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: `malformed-payload-${index}`,
          channel: 'self-study',
          eventType: 'section_completed',
          payload,
          expectedVersion: before,
        }),
      }), { params: { nodeId: 'P1T1-N02' } });
      assert.equal(response.status, 400);
    }
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
  });
});

test('class GET is teacher-only, confined to the teacher-owned class, and returns all three students', async () => {
  await withAuthenticatedFixture(async ({ studentCookie, teacherCookie }) => {
    const own = await classRoute.GET(
      new Request('http://localhost/api/learning/class/demo-class', { headers: { cookie: teacherCookie } }),
      { params: { classId: 'demo-class' } },
    );
    const other = await classRoute.GET(
      new Request('http://localhost/api/learning/class/other-class', { headers: { cookie: teacherCookie } }),
      { params: { classId: 'other-class' } },
    );
    const student = await classRoute.GET(
      new Request('http://localhost/api/learning/class/demo-class', { headers: { cookie: studentCookie } }),
      { params: { classId: 'demo-class' } },
    );

    assert.equal(own.status, 200);
    const snapshot = await own.json();
    assert.equal(snapshot.classId, 'demo-class');
    assert.deepEqual(snapshot.students.map(({ studentId }: { studentId: string }) => studentId), ['stu-01', 'stu-02', 'stu-03']);
    assert.deepEqual([other.status, student.status], [403, 403]);
  });
});

test('GET /api/learning/me returns the direct student snapshot and refuses teachers', async () => {
  await withAuthenticatedFixture(async ({ studentCookie, teacherCookie }) => {
    const student = await meRoute.GET(new Request('http://localhost/api/learning/me', { headers: { cookie: studentCookie } }));
    const teacher = await meRoute.GET(new Request('http://localhost/api/learning/me', { headers: { cookie: teacherCookie } }));

    assert.equal(student.status, 200);
    const snapshot = await student.json();
    assert.equal(snapshot.studentId, 'stu-01');
    assert.equal(snapshot.snapshot, undefined);
    assert.equal(teacher.status, 403);
  });
});

test('write endpoints reject teacher commands and non-authoritative evidence events without mutation', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie, teacherCookie }) => {
    const repository = new LearningRepository(database);
    const before = repository.readTopicVersion('learning:stu-01');
    const teacherEvent = await eventRoute.POST(new Request('http://localhost/api/learning/nodes/P1T1-N02/events', {
      method: 'POST',
      headers: { cookie: teacherCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'teacher-forged-event', channel: 'self-study', eventType: 'micro_practice_passed', expectedVersion: before }),
    }), { params: { nodeId: 'P1T1-N02' } });
    const evidence = await eventRoute.POST(new Request('http://localhost/api/learning/nodes/P1T1-N02/events', {
      method: 'POST',
      headers: { cookie: studentCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'non-authoritative-evidence', channel: 'self-study', eventType: 'evidence_submitted', payload: {}, expectedVersion: before }),
    }), { params: { nodeId: 'P1T1-N02' } });

    assert.equal(teacherEvent.status, 403);
    assert.equal(evidence.status, 422);
    assert.deepEqual(await evidence.json(), { error: 'Professional output submission requires the authoritative output API' });
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
  });
});

test('event ID replay stays 200 while the retired attempt route rejects score replay', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie }) => {
    const repository = new LearningRepository(database);
    const initialVersion = repository.readTopicVersion('learning:stu-01');
    const eventBody = {
      eventId: 'route-idempotent-event',
      channel: 'self-study',
      eventType: 'section_completed',
      payload: { sectionId: 'problem', completed: true },
      expectedVersion: initialVersion,
    };
    const firstEvent = await eventRoute.POST(jsonRequest(
      'http://localhost/api/learning/nodes/P1T1-N02/events', studentCookie, eventBody,
    ), { params: { nodeId: 'P1T1-N02' } });
    const eventVersion = (await firstEvent.json()).version;
    const globalAfterEvent = repository.readTopicVersion('global');
    const replayEvent = await eventRoute.POST(jsonRequest(
      'http://localhost/api/learning/nodes/P1T1-N02/events', studentCookie, eventBody,
    ), { params: { nodeId: 'P1T1-N02' } });
    assert.equal(replayEvent.status, 200);
    assert.equal((await replayEvent.json()).version, eventVersion);
    assert.equal(repository.readTopicVersion('global'), globalAfterEvent);

    const attemptBody = {
      attemptId: 'route-idempotent-attempt',
      gameId: 'node-test',
      score: 81,
      expectedVersion: eventVersion,
    };
    const firstAttempt = await attemptRoute.POST(jsonRequest(
      'http://localhost/api/learning/nodes/P1T1-N02/attempts', studentCookie, attemptBody,
    ), { params: { nodeId: 'P1T1-N02' } });
    assert.equal(firstAttempt.status, 400);
    const globalAfterAttempt = repository.readTopicVersion('global');
    const replayAttempt = await attemptRoute.POST(jsonRequest(
      'http://localhost/api/learning/nodes/P1T1-N02/attempts', studentCookie, attemptBody,
    ), { params: { nodeId: 'P1T1-N02' } });
    assert.equal(replayAttempt.status, 400);
    assert.equal(repository.readTopicVersion('global'), globalAfterAttempt);
    assert.equal(repository.readStudentFacts('stu-01').attempts.some(
      ({ attemptId }) => attemptId === attemptBody.attemptId,
    ), false);
  });
});

test('the retired attempt route returns 410 for score-free bodies without persisting facts', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie }) => {
    const repository = new LearningRepository(database);
    const version = repository.readTopicVersion('learning:stu-01');
    const globalVersion = repository.readTopicVersion('global');
    const response = await attemptRoute.POST(jsonRequest(
      'http://localhost/api/learning/nodes/P1T1-N02/attempts',
      studentCookie,
      { answers: {} },
    ), { params: { nodeId: 'P1T1-N02' } });

    assert.equal(response.status, 410);
    assert.equal(repository.readTopicVersion('learning:stu-01'), version);
    assert.equal(repository.readTopicVersion('global'), globalVersion);
  });
});

test('event API returns 422 for direct pass facts and invalid section, game, or classroom matrices', async () => {
  await withAuthenticatedFixture(async ({ database, studentCookie }) => {
    const repository = new LearningRepository(database);
    const before = repository.readTopicVersion('learning:stu-01');
    const commands = [
      { nodeId: 'P1T1-N02', eventId: 'api-direct-pass', channel: 'self-study', eventType: 'micro_practice_passed', payload: {} },
      { nodeId: 'P1T1-N02', eventId: 'api-invalid-section', channel: 'self-study', eventType: 'section_completed', payload: { sectionId: 'invented', completed: true } },
      { nodeId: 'P1T1-N02', eventId: 'api-invalid-game', channel: 'game', eventType: 'game_completed', payload: { formal: true, completed: true } },
      { nodeId: 'P1T1-N01', eventId: 'api-wrong-classroom-node', channel: 'classroom', eventType: 'classroom_submitted', payload: { completed: true } },
    ];
    for (const command of commands) {
      const response = await eventRoute.POST(jsonRequest(
        `http://localhost/api/learning/nodes/${command.nodeId}/events`,
        studentCookie,
        { ...command, expectedVersion: before },
      ), { params: { nodeId: command.nodeId } });
      assert.equal(response.status, 422);
    }
    assert.equal(repository.readTopicVersion('learning:stu-01'), before);
  });
});

async function withAuthenticatedFixture(
  run: (fixture: {
    database: AppDatabase;
    studentCookie: string;
    studentTwoCookie: string;
    studentThreeCookie: string;
    teacherCookie: string;
  }) => Promise<void>,
): Promise<void> {
  const fixture = createTestDatabase();
  const previousPath = process.env.DGBOOK_SQLITE_PATH;
  const password = process.env.DGBOOK_DEMO_PASSWORD ?? '123456';
  try {
    migrateDatabase(fixture.database);
    seedDemo(fixture.database);
    passRequiredPractice(fixture.database, 'stu-01', 'P1T1-N01-micro-01', 'P1T1-N01');
    insertCompletedSelfStudySections(fixture.database, 'stu-01', 'P1T1-N01');
    process.env.DGBOOK_SQLITE_PATH = fixture.databasePath;
    closeDatabase();
    const auth = new AuthService(fixture.database);
    const student = auth.login({ username: 'student01', password });
    const studentTwo = auth.login({ username: 'student02', password });
    const studentThree = auth.login({ username: 'student03', password });
    const teacher = auth.login({ username: 'teacher01', password });
    assert.ok(student);
    assert.ok(studentTwo);
    assert.ok(studentThree);
    assert.ok(teacher);
    await run({
      database: fixture.database,
      studentCookie: `${AUTH_COOKIE_NAME}=${student.token}`,
      studentTwoCookie: `${AUTH_COOKIE_NAME}=${studentTwo.token}`,
      studentThreeCookie: `${AUTH_COOKIE_NAME}=${studentThree.token}`,
      teacherCookie: `${AUTH_COOKIE_NAME}=${teacher.token}`,
    });
  } finally {
    closeDatabase();
    if (previousPath === undefined) delete process.env.DGBOOK_SQLITE_PATH;
    else process.env.DGBOOK_SQLITE_PATH = previousPath;
    fixture.cleanup();
  }
}

function jsonRequest(url: string, cookie: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function outputMutationCounts(database: AppDatabase, studentId: string) {
  return {
    heads: database.prepare('SELECT COUNT(*) FROM professional_outputs WHERE student_id = ?').pluck().get(studentId),
    versions: database.prepare(`
      SELECT COUNT(*) FROM professional_output_versions AS version
      JOIN professional_outputs AS output ON output.output_id = version.output_id
      WHERE output.student_id = ?
    `).pluck().get(studentId),
    links: database.prepare(`
      SELECT COUNT(*) FROM output_evidence_links AS link
      JOIN professional_outputs AS output ON output.output_id = link.output_id
      WHERE output.student_id = ?
    `).pluck().get(studentId),
    sources: database.prepare(`
      SELECT COUNT(*) FROM output_field_sources AS source
      JOIN professional_outputs AS output ON output.output_id = source.output_id
      WHERE output.student_id = ?
    `).pluck().get(studentId),
    events: database.prepare(`
      SELECT COUNT(*) FROM learning_events
      WHERE student_id = ? AND event_type IN ('evidence_draft_saved', 'evidence_submitted')
    `).pluck().get(studentId),
    snapshot: database.prepare('SELECT version FROM snapshot_versions WHERE topic = ?')
      .pluck().get(`learning:${studentId}`),
  };
}

function passRequiredPractice(
  database: AppDatabase,
  studentId: string,
  activityId: string,
  nodeId: string,
): void {
  database.prepare(`
    INSERT INTO practice_attempts (
      attempt_id, student_id, activity_id, node_id, passed, origin
    ) VALUES (?, ?, ?, ?, 1, 'user')
  `).run(`test-unlock-${studentId}-${activityId}`, studentId, activityId, nodeId);
}
