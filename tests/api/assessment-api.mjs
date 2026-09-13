// Isolated built-Worker tests. Every identity and care record is fictional;
// outboundService replaces OpenAI and ElevenLabs, so no real model calls occur.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Miniflare, Log, LogLevel } from "miniflare";
import { testAccountStatements } from "../../scripts/provision-test-accounts.mjs";
import {
  importHistory,
  readHistory,
} from "../../scripts/seed-patient-history.mjs";
import {
  TEST_ACCOUNTS,
  TEST_PROVIDER_ID,
} from "../../src/lib/auth/test-accounts.ts";
import {
  testAuthEnvironment,
  createAuthFixture,
  signInFixture,
} from "../support/auth-fixture.mjs";
import { applyMigrations } from "../support/migration-fixture.mjs";

const root = fileURLToPath(new URL("../../dist/server/", import.meta.url));
const files = await readdir(root, { recursive: true });
const modules = [
  "index.js",
  ...files.filter((name) => name.endsWith(".js") && name !== "index.js"),
].map((name) => ({ type: "ESModule", path: `${root}${name}` }));
const origin = testAuthEnvironment.LEGALMATE_PUBLIC_ORIGIN;
const password = randomUUID() + randomUUID();
let calls = 0;
let checks = 0;
let modelHandler = () => routine();
const authFixtures = [];
const inputs = [];
const mf = new Miniflare({
  modules,
  modulesRoot: root,
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ...testAuthEnvironment,
    LEGALMATE_TEST_PASSWORD: password,
    OPENAI_API_KEY: "synthetic-never-sent",
    ELEVENLABS_API_KEY: "synthetic-never-sent",
    ELEVENLABS_AGENT_ID: "synthetic-recorder",
  },
  d1Databases: { DB: randomUUID() },
  d1Persist: false,
  host: "127.0.0.1",
  port: 0,
  cf: false,
  log: new Log(LogLevel.ERROR),
  outboundService: async (request) => {
    if (
      request.url.startsWith(
        "https://api.elevenlabs.io/v1/convai/conversation/",
      )
    )
      return Response.json({
        token: "mock-connection",
        conversation_id: randomUUID(),
      });
    assert.equal(
      request.url,
      "https://api.openai.com/v1/responses",
      "Unexpected external request",
    );
    const body = await request.json();
    assert.equal(body.store, false);
    assert.equal(body.truncation, "disabled");
    assert.deepEqual(body.tools, []);
    assert.equal(body.max_output_tokens, 2200);
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    calls++;
    const input = JSON.parse(body.input[0].content[0].text);
    assert.deepEqual(Object.keys(input).sort(), ["note", "sources"]);
    for (const forbidden of ["profile", "history", "messages", "previous"])
      assert.equal(Object.hasOwn(input, forbidden), false);
    inputs.push(input);
    const result = await modelHandler(input);
    if (result instanceof Response) return result;
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(result) }],
        },
      ],
    });
  },
});
function routine() {
  return {
    risks: [],
    summary:
      "No additional concern was identified in the supplied shift account.",
  };
}
function concern(input, level = "P2", type = "health_medication") {
  return {
    risks: [
      {
        type,
        level,
        evidence: [
          {
            sourceId: input.sources.find((source) =>
              source.id.endsWith(":participantResponse"),
            ).id,
            quote: input.note.fields.participantResponse,
          },
        ],
      },
    ],
    summary:
      "The worker reported a medication issue. The outcome remains unknown for manager review.",
  };
}
function legacyResult() {
  return {
    action: "show_summary",
    introduction: null,
    nextQuestion: null,
    concerns: [
      {
        id: "old_event",
        areas: ["medication"],
        title: "Recorded medication issue",
        whatHappened: "A dose was missed.",
        resolution: "unknown",
        howResolved: null,
        priority: "P2",
        evidence: [{ sourceId: "old:source", quote: "A dose was missed." }],
        missingInformation: ["Outcome unknown"],
        nextShiftWatchFor: null,
      },
    ],
    screening: [
      "incident_safeguarding",
      "health_wellbeing",
      "medication",
      "behaviour_restriction",
      "complaint",
      "service_exception",
    ].map((topic) => ({
      topic,
      state: topic === "medication" ? "concern" : "not_discussed",
      evidence:
        topic === "medication"
          ? [{ sourceId: "old:source", quote: "A dose was missed." }]
          : [],
    })),
    summary: "A missed dose was reported. Its outcome was unknown.",
    missingInformation: [],
    contradictions: [],
    urgentAttention: false,
    urgentMessage: null,
  };
}
function blockedModel(result) {
  let entered;
  let release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  modelHandler = async (input) => {
    entered();
    await wait;
    return result(input);
  };
  return { started, release };
}
try {
  const db = await mf.getD1Database("DB");
  await applyMigrations(db);
  await db.batch(
    testAccountStatements().map(({ sql, params }) =>
      db.prepare(sql).bind(...params),
    ),
  );
  const history = await readHistory();
  await importHistory(db, history);
  async function insert(table, row) {
    const columns = Object.keys(row);
    await db
      .prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      )
      .bind(...Object.values(row))
      .run();
  }
  async function request(
    path,
    {
      session,
      body,
      method = body === undefined ? "GET" : "POST",
      expected = 200,
      cookieResult = false,
      includeStatus = false,
    } = {},
  ) {
    const response = await mf.dispatchFetch(`${origin}${path}`, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.79",
        ...(session ? { Cookie: session.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `${path}: non-JSON ${response.status}: ${raw.slice(0, 300)}`,
      );
    }
    assert.ok(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      `${method} ${path}: ${response.status} ${JSON.stringify(data)}`,
    );
    checks++;
    if (includeStatus) return { status: response.status, data };
    return cookieResult
      ? {
          ...data,
          cookie: response.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; "),
        }
      : data;
  }
  async function account(email, name) {
    const fixture = createAuthFixture();
    authFixtures.push(fixture);
    const session = await signInFixture(fixture, email, name);
    await insert("auth_user", session.userRow);
    await insert("auth_session", session.sessionRow);
    return session;
  }
  const sessions = {};
  for (const account of TEST_ACCOUNTS)
    sessions[account.role] = await request("/api/auth/sign-in/test-account", {
      body: { email: account.alias, password },
      cookieResult: true,
    });
  const worker = sessions.worker;
  const manager = sessions.manager;
  const otherManager = await account(
    "other-manager-ai2@example.test",
    "Other Provider Manager",
  );
  const otherProvider = "other-ai2-provider";
  const now = new Date().toISOString();
  await insert("providers", {
    id: otherProvider,
    name: "Other Synthetic Provider",
    active: 1,
    created_at: now,
  });
  await insert("provider_manager_grants", {
    id: randomUUID(),
    provider_id: otherProvider,
    email: otherManager.user.email,
    active: 1,
    claimed_user_id: otherManager.user.id,
    claimed_at: now,
    created_at: now,
  });
  const colleague = await account(
    "colleague-ai2@example.test",
    "Synthetic Colleague",
  );
  await request("/api/onboarding", {
    session: colleague,
    body: { fullName: "Synthetic Colleague", providerId: TEST_PROVIDER_ID },
  });
  let shiftIndex = 0;
  async function newNote({
    response = "Chose the walk and appeared comfortable.",
    incomplete = false,
  } = {}) {
    shiftIndex++;
    const start = `2026-09-13T${String(6 + shiftIndex).padStart(2, "0")}:00`;
    const end = `2026-09-13T${String(7 + shiftIndex).padStart(2, "0")}:00`;
    const shift = (
      await request(`/api/shifts?providerId=${TEST_PROVIDER_ID}`, {
        session: manager,
        body: {
          participantId: history.participant.id,
          workerId: history.workerId,
          expectedStart: start,
          expectedEnd: end,
          timezone: history.timezone,
        },
        expected: 201,
      })
    ).shift;
    let note = (
      await request("/api/notes", {
        session: worker,
        body: { id: randomUUID(), shiftId: shift.id },
        expected: 201,
      })
    ).note;
    if (!incomplete)
      note = (
        await request(`/api/notes/${note.id}`, {
          session: worker,
          method: "PATCH",
          body: {
            revision: note.revision,
            fields: {
              shiftStart: start,
              shiftEnd: end,
              activities: "Walked to the park",
              supportProvided: "Walked alongside the participant",
              participantResponse: response,
              goalProgress: "Practised community participation",
            },
          },
        })
      ).note;
    return note;
  }
  const assessmentPath = (note) => `/api/notes/${note.id}/assessment`;
  const start = (note, expected = 200) =>
    request(assessmentPath(note), {
      session: worker,
      body: { action: "start", revision: note.revision },
      expected,
    });
  const read = async (note) =>
    (await request(assessmentPath(note), { session: worker })).assessment;
  const review = (note, assessment, expected = 200) =>
    request(`/api/notes/${note.id}/review`, {
      session: worker,
      body: {
        revision: note.revision,
        assessmentId: assessment.id,
        assessmentRevision: assessment.revision,
      },
      expected,
    });
  const retry = (note, assessment, expected = 200) =>
    request(assessmentPath(note), {
      session: worker,
      body: {
        action: "retry",
        assessmentId: assessment.id,
        revision: assessment.revision,
      },
      expected,
    });
  const inbox = (session = manager, provider = TEST_PROVIDER_ID) =>
    request(`/api/management?providerId=${provider}`, { session });
  const findingCount = async (assessmentId) =>
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM assessment_findings WHERE assessment_id=?",
        )
        .bind(assessmentId)
        .first()
    ).count;
  const edit = async (note, fields) =>
    (
      await request(`/api/notes/${note.id}`, {
        session: worker,
        method: "PATCH",
        body: { revision: note.revision, fields },
      })
    ).note;

  // Ownership and incomplete stage-one data are checked before any provider call.
  const incomplete = await newNote({ incomplete: true });
  await request(assessmentPath(incomplete), { expected: 401 });
  for (const session of [manager, colleague])
    await request(assessmentPath(incomplete), { session, expected: 404 });
  await start(incomplete, 422);
  assert.equal(calls, 0);
  // Fast recorder acknowledgements retain source durability, replay guards and
  // the same atomic confirmation invalidation as a normal form PATCH.
  const fastNote = await newNote();
  const fastVoice = await request("/api/voice/sessions", {
    session: worker,
    body: { noteId: fastNote.id },
  });
  const fastPath = `/api/voice/sessions/${fastVoice.sessionId}`;
  const fastEvent = {
    action: "event",
    responseMode: "ack",
    event: {
      sequence: 1,
      kind: "user",
      text: "Synthetic timing check: we walked to the park.",
    },
  };
  await request(fastPath, { body: fastEvent, expected: 401 });
  await request(fastPath, {
    session: colleague,
    body: fastEvent,
    expected: 404,
  });
  assert.deepEqual(
    await request(fastPath, { session: worker, body: fastEvent }),
    { ok: true, sequence: 1 },
  );
  assert.deepEqual(
    await request(fastPath, { session: worker, body: fastEvent }),
    { ok: true, sequence: 1 },
  );
  const preserved = await db
    .prepare("SELECT content FROM transcript_events WHERE session_id=?")
    .bind(fastVoice.sessionId)
    .all();
  assert.deepEqual(
    preserved.results.map((row) => row.content),
    [fastEvent.event.text],
  );
  await request(fastPath, {
    session: worker,
    body: {
      ...fastEvent,
      event: {
        ...fastEvent.event,
        text: "Different statement at the same sequence",
      },
    },
    expected: 409,
  });
  const defaultEvent = await request(fastPath, {
    session: worker,
    body: {
      action: "event",
      event: { sequence: 2, kind: "agent", text: "What happened next?" },
    },
  });
  assert.equal(
    defaultEvent.note.id,
    fastNote.id,
    "Existing clients retain the full response",
  );
  await db
    .prepare(
      "UPDATE shift_notes SET confirmation_id='old-review',review_version=? WHERE id=?",
    )
    .bind(fastNote.revision, fastNote.id)
    .run();
  const fastSaved = await request(`/api/notes/${fastNote.id}`, {
    session: worker,
    method: "PATCH",
    body: {
      revision: fastNote.revision,
      voiceSessionId: fastVoice.sessionId,
      fields: { activities: "Synthetic timing check: walked to the park." },
    },
  });
  assert.equal(
    fastSaved.note.fields.activities,
    "Synthetic timing check: walked to the park.",
  );
  const invalidated = await db
    .prepare(
      "SELECT confirmation_id,review_version FROM shift_notes WHERE id=?",
    )
    .bind(fastNote.id)
    .first();
  assert.equal(invalidated.confirmation_id, null);
  assert.equal(invalidated.review_version, null);
  await request(fastPath, { session: worker, body: { action: "close" } });
  await request(fastPath, {
    session: worker,
    body: {
      ...fastEvent,
      event: { sequence: 3, kind: "user", text: "After close" },
    },
    expected: 409,
  });
  const plain = await newNote();
  await request(assessmentPath(plain), {
    session: colleague,
    body: { action: "start", revision: plain.revision },
    expected: 404,
  });
  await request(`/api/notes/${plain.id}/review`, {
    session: worker,
    body: { revision: plain.revision },
    expected: 409,
  });
  const voice = await request("/api/voice/sessions", {
    session: worker,
    body: { noteId: plain.id },
  });
  await request(`/api/voice/sessions/${voice.sessionId}`, {
    session: worker,
    body: {
      action: "event",
      event: { sequence: 1, kind: "user", text: "We walked to the park." },
    },
  });
  const gate = blockedModel(routine);
  const pending = start(plain);
  await gate.started;
  const running = await read(plain);
  assert.equal(running.status, "running");
  assert.equal(running.schemaVersion, 2);
  const count = calls;
  assert.equal((await start(plain)).assessment.id, running.id);
  await read(plain);
  assert.equal(
    calls,
    count,
    "GET and duplicate start must reuse the admitted check",
  );
  await request("/api/voice/sessions", {
    session: worker,
    body: { noteId: plain.id },
    expected: 409,
  });
  await request(`/api/voice/sessions/${voice.sessionId}`, {
    session: worker,
    body: {
      action: "event",
      event: { sequence: 2, kind: "user", text: "Late transcript" },
    },
    expected: 409,
  });
  await request(`/api/notes/${plain.id}`, {
    session: worker,
    method: "PATCH",
    body: {
      revision: plain.revision,
      voiceSessionId: voice.sessionId,
      fields: { activities: "Late recorder update" },
    },
    expected: 409,
  });
  await review(plain, running, 409);
  gate.release();
  const ready = (await pending).assessment;
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.result.risks, []);
  assert.equal(Object.hasOwn(ready, "messages"), false);
  assert.equal(Object.hasOwn(ready.result, "nextQuestion"), false);
  assert.ok(
    inputs[0].sources.some(
      (source) => source.text === "We walked to the park.",
    ),
  );
  assert.equal(
    await findingCount(ready.id),
    0,
    "P0 does not clutter the review queue",
  );
  assert.equal((await inbox()).findings.length, 0);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM assessment_messages WHERE assessment_id=?",
        )
        .bind(ready.id)
        .first()
    ).count,
    0,
  );
  const checked = await review(plain, ready);
  const confirmation = {
    confirmed: true,
    revision: plain.revision,
    confirmationId: checked.confirmationId,
    assessmentId: ready.id,
    assessmentRevision: ready.revision,
  };
  await request(`/api/notes/${plain.id}/confirm`, {
    session: worker,
    body: { ...confirmation, assessmentRevision: ready.revision + 1 },
    expected: 409,
  });
  await request(`/api/notes/${plain.id}/confirm`, {
    session: worker,
    body: { ...confirmation, voiceSessionId: voice.sessionId },
    expected: 409,
  });
  assert.equal(
    (
      await request(`/api/notes/${plain.id}/confirm`, {
        session: worker,
        body: confirmation,
      })
    ).note.status,
    "complete",
  );
  assert.equal(
    (
      await request(`/api/notes/${plain.id}/confirm`, {
        session: worker,
        body: confirmation,
      })
    ).note.status,
    "complete",
  );
  assert.deepEqual(
    (await request(`/api/notes/${plain.id}`, { session: manager })).note
      .assessment,
    ready.result,
  );

  // An incident flag never starts an interview; valid concern output publishes typed evidence atomically.
  let medication = await newNote({ response: "A medication dose was missed." });
  medication = await edit(medication, {
    incidents: "yes",
    incidentDetails: "",
  });
  modelHandler = (input) => concern(input);
  const assessed = (await start(medication)).assessment;
  assert.equal(assessed.status, "ready");
  assert.equal(assessed.result.risks[0].level, "P2");
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM risk_events WHERE note_id=?")
        .bind(medication.id)
        .first()
    ).count,
    0,
    "No competing recorder keyword classifications",
  );
  let finding = (await inbox()).findings.find(
    (item) => item.assessmentId === assessed.id,
  );
  assert.ok(finding);
  assert.equal(finding.type, "health_medication");
  assert.equal(finding.aiLevel, "P2");
  assert.deepEqual(finding.evidence, assessed.result.risks[0].evidence);
  assert.equal(finding.reviewStatus, "open");
  assert.equal(finding.managerLevel, null);
  assert.equal(finding.isCurrent, true);
  for (const path of [
    assessmentPath(medication),
    `${assessmentPath(medication)}/transcribe`,
  ]) {
    const body = path.endsWith("transcribe")
      ? { audioBase64: "ignored" }
      : {
          action: "answer",
          answer: "No new answers",
          assessmentId: assessed.id,
          revision: assessed.revision,
        };
    await request(path, { session: worker, body, expected: 410 });
    await request(path, { session: colleague, body, expected: 404 });
    await request(path, { body, expected: 401 });
  }
  const savedResult = (
    await db
      .prepare("SELECT result_json FROM shift_assessments WHERE id=?")
      .bind(assessed.id)
      .first()
  ).result_json;
  const savedFields = (
    await db
      .prepare("SELECT fields_json FROM shift_notes WHERE id=?")
      .bind(medication.id)
      .first()
  ).fields_json;
  const findingPath = (provider = TEST_PROVIDER_ID) =>
    `/api/management/findings/${finding.id}?providerId=${provider}`;
  const managerBody = (patch = {}) => ({
    requestId: randomUUID(),
    revision: finding.reviewRevision,
    status: finding.reviewStatus,
    managerLevel: finding.managerLevel,
    comment: "",
    ...patch,
  });
  const manage = (
    body,
    expected = 200,
    session = manager,
    provider = TEST_PROVIDER_ID,
  ) => request(findingPath(provider), { session, body, expected });
  await request(findingPath(), { body: managerBody(), expected: 401 });
  await manage(managerBody(), 403, worker);
  await manage(managerBody(), 403, colleague);
  await manage(managerBody(), 403, otherManager, otherProvider);
  await manage(managerBody(), 403, manager, otherProvider);
  assert.deepEqual((await inbox(otherManager, otherProvider)).findings, []);
  await manage(managerBody({ status: "closed" }), 400);
  await manage(managerBody({ managerLevel: "P1" }), 400);
  await manage(
    managerBody({ managerLevel: "P5", comment: "Invalid level" }),
    400,
  );
  await manage(
    managerBody({ managerLevel: ["P1"], comment: "Invalid array" }),
    400,
  );
  await manage(managerBody({ comment: ["Invalid array"] }), 400);
  await manage(managerBody({ comment: "x".repeat(4001) }), 400);
  const firstDecision = managerBody({ status: "reviewing" });
  finding = (await manage(firstDecision)).finding;
  assert.equal(finding.reviewRevision, 1);
  assert.equal(finding.history.length, 1);
  assert.equal(finding.history[0].actorName, "Test Manager");
  assert.equal(
    (await manage(firstDecision)).finding.history.length,
    1,
    "Same request is idempotent",
  );
  await manage({ ...firstDecision, comment: "Changed replay" }, 409);
  await manage({ ...firstDecision, requestId: randomUUID() }, 409);
  finding = (
    await manage(
      managerBody({
        managerLevel: "P1",
        comment: "Manager reviewed the reported outcome and will monitor.",
      }),
    )
  ).finding;
  assert.equal(finding.managerLevel, "P1");
  assert.equal(finding.aiLevel, "P2");
  await manage(managerBody({ status: "closed" }), 400);
  finding = (
    await manage(
      managerBody({
        status: "closed",
        comment: "Manager review completed and follow-up recorded.",
      }),
    )
  ).finding;
  assert.equal(finding.reviewStatus, "closed");
  finding = (await manage(managerBody({ status: "open" }))).finding;
  assert.equal(finding.reviewStatus, "open");
  await manage(managerBody({ managerLevel: null }), 400);
  finding = (
    await manage(
      managerBody({
        managerLevel: null,
        comment:
          "Returning to the original AI priority pending a second review.",
      }),
    )
  ).finding;
  const competing = await Promise.all(
    ["First review", "Second review"].map((comment) =>
      request(findingPath(), {
        session: manager,
        body: managerBody({ status: "reviewing", comment }),
        expected: [200, 409],
        includeStatus: true,
      }),
    ),
  );
  assert.deepEqual(
    competing.map((item) => item.status).sort(),
    [200, 409],
    "Only one current-revision manager mutation wins",
  );
  finding = (await inbox()).findings.find((item) => item.id === finding.id);
  assert.equal(finding.history.length, 6);
  const sameDecision = managerBody({
    status: "open",
    comment: "Idempotent reopen.",
  });
  const replays = await Promise.all([
    manage(sameDecision),
    manage(sameDecision),
  ]);
  assert.ok(replays.every((item) => item.finding.history.length === 7));
  finding = replays[0].finding;
  assert.equal(finding.aiLevel, "P2");
  assert.deepEqual(finding.evidence, assessed.result.risks[0].evidence);
  assert.equal(
    (
      await db
        .prepare("SELECT result_json FROM shift_assessments WHERE id=?")
        .bind(assessed.id)
        .first()
    ).result_json,
    savedResult,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT fields_json FROM shift_notes WHERE id=?")
        .bind(medication.id)
        .first()
    ).fields_json,
    savedFields,
  );
  const workerAudit = await request(`/api/notes/${medication.id}/audit`, {
    session: worker,
  });
  assert.deepEqual(
    workerAudit.findings,
    [],
    "Manager comments stay out of the worker audit",
  );
  const managerAudit = await request(`/api/notes/${medication.id}/audit`, {
    session: manager,
  });
  assert.equal(
    managerAudit.findings.find((item) => item.id === finding.id).history.length,
    7,
  );
  await assert.rejects(
    db
      .prepare("UPDATE assessment_findings SET ai_level='P4' WHERE id=?")
      .bind(finding.id)
      .run(),
    /immutable/i,
  );
  await assert.rejects(
    db
      .prepare("UPDATE assessment_findings SET evidence_json='[]' WHERE id=?")
      .bind(finding.id)
      .run(),
    /immutable/i,
  );
  await assert.rejects(
    db
      .prepare("DELETE FROM assessment_findings WHERE id=?")
      .bind(finding.id)
      .run(),
    /retained/i,
  );
  await assert.rejects(
    db
      .prepare(
        "UPDATE assessment_manager_actions SET comment='altered' WHERE finding_id=?",
      )
      .bind(finding.id)
      .run(),
    /append-only/i,
  );
  await assert.rejects(
    db
      .prepare("DELETE FROM assessment_manager_actions WHERE finding_id=?")
      .bind(finding.id)
      .run(),
    /append-only/i,
  );

  // A later routine recheck leaves the open finding from the earlier note version visible.
  medication = await edit(medication, {
    activities: "Corrected the activity timing",
  });
  assert.equal(medication.assessment, null);
  assert.equal((await read(medication)).status, "stale");
  modelHandler = routine;
  const rechecked = (await start(medication)).assessment;
  assert.equal(rechecked.status, "ready");
  assert.deepEqual(rechecked.result.risks, []);
  finding = (await inbox()).findings.find((item) => item.id === finding.id);
  assert.equal(finding.isCurrent, false);
  assert.equal(finding.reviewStatus, "open");
  assert.equal(await findingCount(rechecked.id), 0);
  const obsoleteReview = await review(medication, rechecked);
  medication = await edit(medication, {
    activities: "Final corrected activity",
  });
  await request(`/api/notes/${medication.id}/confirm`, {
    session: worker,
    body: {
      confirmed: true,
      revision: medication.revision,
      confirmationId: obsoleteReview.confirmationId,
      assessmentId: rechecked.id,
      assessmentRevision: rechecked.revision,
    },
    expected: 409,
  });

  // Failed checks and invalid question-bearing outputs never become P0 or permit confirmation.
  const failedNote = await newNote({
    response: "A medication dose was missed.",
  });
  modelHandler = () =>
    new Response("sensitive synthetic provider error", { status: 503 });
  let failed = (await start(failedNote)).assessment;
  assert.equal(failed.status, "failed");
  assert.equal(failed.result, null);
  assert.ok(failed.error && !failed.error.includes("sensitive"));
  assert.equal(await findingCount(failed.id), 0);
  await review(failedNote, failed, 409);
  modelHandler = () => ({ ...routine(), nextQuestion: "What happened?" });
  failed = (await retry(failedNote, failed)).assessment;
  assert.equal(failed.status, "failed");
  assert.equal(failed.result, null);
  modelHandler = (input) => ({
    ...concern(input),
    risks: [
      {
        ...concern(input).risks[0],
        evidence: [{ sourceId: "invented", quote: "Fabricated event" }],
      },
    ],
  });
  failed = (await retry(failedNote, failed)).assessment;
  assert.equal(failed.status, "failed");
  assert.equal(await findingCount(failed.id), 0);
  const retryGate = blockedModel((input) => concern(input, "P4"));
  const retryPending = retry(failedNote, failed);
  await retryGate.started;
  const retryCalls = calls;
  await retry(failedNote, failed, 409);
  assert.equal(calls, retryCalls);
  retryGate.release();
  const urgent = (await retryPending).assessment;
  assert.equal(urgent.status, "ready");
  assert.equal(urgent.result.risks[0].level, "P4");
  assert.equal(
    (await inbox()).findings[0].aiLevel,
    "P4",
    "Highest priority is shown first",
  );
  const runAudit = await db
    .prepare(
      "SELECT status FROM assessment_runs WHERE assessment_id=? ORDER BY rowid",
    )
    .bind(urgent.id)
    .all();
  assert.deepEqual(
    runAudit.results.map((run) => run.status),
    ["failed", "failed", "failed", "published"],
  );

  // Concurrent manual edits supersede model output without publishing any findings.
  let changed = await newNote({ response: "A medication dose was missed." });
  const editGate = blockedModel(concern);
  const oldRun = start(changed);
  await editGate.started;
  const beforeEdit = await read(changed);
  changed = await edit(changed, {
    activities: "Returned from the park earlier",
  });
  editGate.release();
  assert.equal((await oldRun).assessment.status, "stale");
  assert.equal(await findingCount(beforeEdit.id), 0);
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM assessment_runs WHERE assessment_id=?")
        .bind(beforeEdit.id)
        .first()
    ).status,
    "superseded",
  );

  // Version-one source and messages remain immutable; only a new schema-two check can confirm a draft.
  const oldNote = await newNote({ response: "A medication dose was missed." });
  const oldId = randomUUID();
  const legacyJson = JSON.stringify(legacyResult());
  await insert("shift_assessments", {
    id: oldId,
    note_id: oldNote.id,
    owner_id: history.workerId,
    source_revision: oldNote.revision,
    revision: 3,
    status: "ready",
    source_json: JSON.stringify({ legacy: true }),
    result_json: legacyJson,
    created_at: now,
    updated_at: now,
  });
  const questionId = randomUUID(),
    answerId = randomUUID();
  await insert("assessment_messages", {
    id: questionId,
    assessment_id: oldId,
    request_id: null,
    role: "assistant",
    text: "What was the outcome?",
    question_id: "old_event:event.outcome",
    created_at: now,
  });
  await insert("assessment_messages", {
    id: answerId,
    assessment_id: oldId,
    request_id: randomUUID(),
    role: "user",
    text: "I do not know.",
    question_id: "old_event:event.outcome",
    created_at: now,
  });
  assert.equal((await read(oldNote)).schemaVersion, 1);
  assert.equal((await read(oldNote)).status, "stale");
  await review(oldNote, { id: oldId, revision: 3 }, 409);
  modelHandler = (input) => {
    assert.ok(
      input.sources.some(
        (source) =>
          source.id === `legacy-answer:${answerId}` &&
          source.text === "I do not know.",
      ),
    );
    assert.equal(input.note.legacyInterviewTranscript.length, 2);
    return concern(input, "P1");
  };
  const upgraded = (await start(oldNote)).assessment;
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(upgraded.status, "ready");
  assert.notEqual(upgraded.id, oldId);
  assert.equal(upgraded.sourceRevision, oldNote.revision);
  assert.equal(
    (
      await db
        .prepare("SELECT result_json FROM shift_assessments WHERE id=?")
        .bind(oldId)
        .first()
    ).result_json,
    legacyJson,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM assessment_messages WHERE assessment_id=?",
        )
        .bind(oldId)
        .first()
    ).count,
    2,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM assessment_messages WHERE assessment_id=?",
        )
        .bind(upgraded.id)
        .first()
    ).count,
    0,
  );
  await assert.rejects(
    db
      .prepare("UPDATE shift_assessments SET schema_version=2 WHERE id=?")
      .bind(oldId)
      .run(),
    /immutable/i,
  );
  const oldAudit = await request(`/api/notes/${oldNote.id}/audit`, {
    session: manager,
  });
  assert.equal(
    oldAudit.assessmentAudit.find((item) => item.id === oldId).result.action,
    "show_summary",
  );
  assert.equal(
    oldAudit.assessmentAudit.find((item) => item.id === oldId).messages.length,
    2,
  );

  // A confirmed schema-one note remains readable without creating or changing its old result.
  const legacyComplete = await newNote();
  const completedId = randomUUID(),
    oldConfirmationId = randomUUID();
  await insert("shift_assessments", {
    id: completedId,
    note_id: legacyComplete.id,
    owner_id: history.workerId,
    source_revision: legacyComplete.revision,
    revision: 1,
    status: "ready",
    source_json: "{}",
    result_json: legacyJson,
    created_at: now,
    updated_at: now,
  });
  await insert("assessment_reviews", {
    confirmation_id: oldConfirmationId,
    note_id: legacyComplete.id,
    owner_id: history.workerId,
    source_revision: legacyComplete.revision,
    assessment_id: completedId,
    assessment_revision: 1,
    created_at: now,
  });
  await db
    .prepare(
      "UPDATE shift_notes SET status='complete',confirmed_at=?,confirmation_id=?,review_version=revision WHERE id=?",
    )
    .bind(now, oldConfirmationId, legacyComplete.id)
    .run();
  const historical = await request(`/api/notes/${legacyComplete.id}`, {
    session: manager,
  });
  assert.equal(historical.note.status, "complete");
  assert.equal(historical.note.assessment.risks[0].type, "health_medication");
  assert.equal(historical.note.assessment.risks[0].level, "P2");
  assert.equal((await read(legacyComplete)).status, "ready");
  assert.equal(
    (
      await db
        .prepare("SELECT result_json FROM shift_assessments WHERE id=?")
        .bind(completedId)
        .first()
    ).result_json,
    legacyJson,
  );

  // A database error publishing a finding rolls back the ready result and all findings together.
  const atomicNote = await newNote({
    response: "A medication dose was missed.",
  });
  modelHandler = concern;
  await db
    .prepare(
      "CREATE TRIGGER test_reject_finding BEFORE INSERT ON assessment_findings BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END",
    )
    .run();
  await start(atomicNote, 503);
  const interrupted = await read(atomicNote);
  assert.equal(interrupted.status, "running");
  assert.equal(interrupted.result, null);
  assert.equal(await findingCount(interrupted.id), 0);
  await review(atomicNote, interrupted, 409);
  await db.prepare("DROP TRIGGER test_reject_finding").run();
  await db
    .prepare("UPDATE shift_assessments SET lease_until=? WHERE id=?")
    .bind("2020-01-01T00:00:00.000Z", interrupted.id)
    .run();
  const expired = await read(atomicNote);
  assert.equal(expired.status, "failed");
  const recovered = (await retry(atomicNote, expired)).assessment;
  assert.equal(recovered.status, "ready");
  assert.equal(await findingCount(recovered.id), 1);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM assessment_runs WHERE assessment_id=? AND status='published'",
        )
        .bind(recovered.id)
        .first()
    ).count,
    1,
  );

  // Every stored new run is confined to this shift's saved form and recorder evidence.
  const allRuns = await db
    .prepare(
      "SELECT input_json FROM assessment_runs r JOIN shift_assessments a ON a.id=r.assessment_id WHERE a.schema_version=2",
    )
    .all();
  for (const row of allRuns.results)
    assert.deepEqual(Object.keys(JSON.parse(row.input_json)).sort(), [
      "note",
      "sources",
    ]);
  console.log(
    `Silent assessment API: ${checks} HTTP checks passed; ${calls} mocked model requests; no external services contacted.`,
  );
} finally {
  for (const fixture of authFixtures) fixture.sqlite.close();
  await mf.dispose();
}
