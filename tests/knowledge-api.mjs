// Isolated built-Worker regression tests. All identities, sessions and patient
// history are synthetic. No application database or external service is used.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Miniflare, Log, LogLevel } from "miniflare";
import { testAccountStatements } from "../scripts/provision-test-accounts.mjs";
import {
  buildHistoryRows,
  importHistory,
  readHistory,
} from "../scripts/seed-patient-history.mjs";
import { emptyVoiceState } from "../lib/voice-state.ts";
import { TEST_ACCOUNTS, TEST_PROVIDER_ID } from "../lib/test-accounts.ts";
import {
  createAuthFixture,
  signInFixture,
  testAuthEnvironment,
} from "./auth-fixture.mjs";
import { applyMigrations } from "./migration-fixture.mjs";

const root = fileURLToPath(new URL("../dist/server/", import.meta.url));
const origin = testAuthEnvironment.LEGALMATE_PUBLIC_ORIGIN;
const files = await readdir(root, { recursive: true });
const modules = [
  "index.js",
  ...files.filter((name) => name.endsWith(".js") && name !== "index.js"),
].map((name) => ({ type: "ESModule", path: `${root}${name}` }));
const testPassword = randomUUID() + randomUUID();
let outboundRequests = 0;
const mf = new Miniflare({
  modules,
  modulesRoot: root,
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ...testAuthEnvironment,
    GOOGLE_CLIENT_ID: "test-only-google-client",
    GOOGLE_CLIENT_SECRET: "test-only-google-secret",
    LEGALMATE_TEST_PASSWORD: testPassword,
  },
  d1Databases: { DB: randomUUID() },
  d1Persist: false,
  host: "127.0.0.1",
  port: 0,
  cf: false,
  log: new Log(LogLevel.ERROR),
  outboundService: () => {
    outboundRequests++;
    return new Response("External services are disabled in this test", {
      status: 503,
    });
  },
});
const fixtures = [];
let checks = 0;

try {
  const db = await mf.getD1Database("DB");
  await applyMigrations(db, { before: "0006" });
  await db.batch(
    testAccountStatements().map(({ sql, params }) =>
      db.prepare(sql).bind(...params),
    ),
  );
  const history = await readHistory();
  await importHistory(db, history);
  const migrations = await applyMigrations(db, { from: "0006" });
  assert.ok(
    migrations.some((name) => name.startsWith("0006")),
    "Build the knowledge migration before running integration tests",
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS count FROM knowledge_fts").first())
      .count,
    10,
    "Migration must index all previously confirmed notes",
  );

  async function request(
    path,
    {
      session,
      body,
      method = body === undefined ? "GET" : "POST",
      expected = 200,
      headers = {},
      withSession = false,
    } = {},
  ) {
    const response = await mf.dispatchFetch(`${origin}${path}`, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.60",
        ...(session ? { Cookie: session.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error(
        `${method} ${path}: non-JSON HTTP ${response.status}: ${raw.slice(0, 200)}`,
      );
    }
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
    checks++;
    return withSession
      ? {
          data,
          cookie: response.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; "),
        }
      : data;
  }
  async function insert(table, row) {
    const columns = Object.keys(row);
    await db
      .prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      )
      .bind(...Object.values(row))
      .run();
  }
  async function account(email, name) {
    const fixture = createAuthFixture();
    fixtures.push(fixture);
    const session = await signInFixture(fixture, email, name);
    await insert("auth_user", session.userRow);
    await insert("auth_session", session.sessionRow);
    return session;
  }
  const sessions = {};
  for (const account of TEST_ACCOUNTS) {
    sessions[account.role] = await request("/api/auth/sign-in/test-account", {
      body: { email: account.alias, password: testPassword },
      withSession: true,
    });
    assert.ok(sessions[account.role].cookie);
  }
  const worker = sessions.worker,
    manager = sessions.manager;
  const colleague = await account(
    "colleague-rag@example.test",
    "Synthetic Colleague",
  );
  await request("/api/onboarding", {
    session: colleague,
    body: { fullName: "Synthetic Colleague", providerId: TEST_PROVIDER_ID },
  });
  const otherParticipant = (
    await request(`/api/participants?providerId=${TEST_PROVIDER_ID}`, {
      session: manager,
      body: {
        profile: {
          name: "Different fictional participant",
          communication: "Unrelated participant",
        },
      },
      expected: 201,
    })
  ).participant;

  async function newNote({
    participantId = history.participant.id,
    workerId = history.workerId,
    session = worker,
    start = "2026-09-13T10:00",
    end = "2026-09-13T14:00",
    actual = true,
  } = {}) {
    const shift = (
      await request(`/api/shifts?providerId=${TEST_PROVIDER_ID}`, {
        session: manager,
        body: {
          participantId,
          workerId,
          expectedStart: start,
          expectedEnd: end,
          timezone: history.timezone,
        },
        expected: 201,
      })
    ).shift;
    let note = (
      await request("/api/notes", {
        session,
        body: { id: randomUUID(), shiftId: shift.id },
        expected: 201,
      })
    ).note;
    if (actual)
      note = (
        await request(`/api/notes/${note.id}`, {
          session,
          method: "PATCH",
          body: {
            revision: note.revision,
            fields: { shiftStart: start, shiftEnd: end },
          },
        })
      ).note;
    return note;
  }
  // Only the local voice-session row is seeded. Event capture and all RAG routes
  // then run through the authenticated application HTTP handlers.
  async function conversation(note, session = worker) {
    const now = new Date();
    const id = randomUUID();
    const user = await request("/api/auth/get-session", { session });
    await insert("voice_sessions", {
      id,
      owner_id: user.user.id,
      note_id: note.id,
      conversation_id: `synthetic-${randomUUID()}`,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
      state_json: JSON.stringify(emptyVoiceState("text")),
      revision: 0,
    });
    let sequence = 0;
    return {
      id,
      event: (kind, text, expected = 200) =>
        request(`/api/voice/sessions/${id}`, {
          session,
          body: {
            action: "event",
            event: { sequence: ++sequence, kind, text },
          },
          expected,
        }),
      close: () =>
        request(`/api/voice/sessions/${id}`, {
          session,
          body: { action: "close" },
        }),
    };
  }
  async function search(
    note,
    live,
    currentTurnQuote,
    query,
    changes = {},
    expected = 200,
    session = worker,
  ) {
    return request(`/api/notes/${note.id}/knowledge/search`, {
      session,
      body: {
        query,
        revision: note.revision,
        voiceSessionId: live.id,
        currentTurnQuote,
        ...changes,
      },
      expected,
    });
  }
  function sourceNoteIds(result) {
    return result.sources.map((source) => source.noteId);
  }
  function assertHistoryOnly(result) {
    const allowed = new Set(history.notes.map((note) => note.id));
    for (const source of result.sources)
      assert.ok(
        allowed.has(source.noteId),
        `Unexpected source note ${source.noteId}`,
      );
    const serialized = JSON.stringify(result.sources);
    for (const internal of [
      '"topics"',
      '"continuity"',
      '"syntheticFixture"',
      '"ndis"',
    ])
      assert.ok(
        !serialized.includes(internal),
        `Internal metadata leaked into retrieval: ${internal}`,
      );
  }

  const note = await newNote();
  const contextPath = `/api/notes/${note.id}/knowledge/context`;
  const questionPath = `/api/notes/${note.id}/interview/questions`;
  await request(contextPath, { expected: 401 });
  await request(contextPath, { session: colleague, expected: 404 });
  await request(contextPath, { session: manager, expected: 404 });
  await request(questionPath, { session: colleague, expected: 404 });
  const context = await request(contextPath, { session: worker });
  assert.equal(context.noteRevision, note.revision);
  assert.ok(context.retrievalId);
  assert.ok(context.profile);
  assert.ok(
    !("ndis" in context.profile),
    "The interviewer does not need the NDIS identifier",
  );
  assert.ok(
    !("dateOfBirth" in context.profile),
    "The interviewer does not need DOB",
  );
  assertHistoryOnly(context);
  assert.ok(context.sources.length > 0);
  const stored = (await request(`/api/notes/${note.id}`, { session: worker }))
    .note;
  assert.equal(
    stored.fields.activities,
    "",
    "Loading history must not fill the current shift with past observations",
  );

  const live = await conversation(note);
  const quote = "Sarah ate lunch and said she felt tired today.";
  await search(note, live, quote, "lunch appetite tired", {}, 409);
  await live.event("user", quote);
  await search(note, live, "A fabricated current statement", "lunch", {}, 409);
  await search(
    note,
    live,
    quote,
    "lunch",
    { revision: note.revision - 1 },
    409,
  );
  await search(note, live, quote, "lunch", {}, 404, colleague);
  const intake = await search(note, live, quote, "lunch appetite tired");
  assert.ok(["ok", "partial"].includes(intake.status));
  assertHistoryOnly(intake);
  assert.ok(
    sourceNoteIds(intake).includes(history.notes[6].id),
    "Retrieve 8 September intake and tiredness observation",
  );
  assert.ok(
    sourceNoteIds(intake).includes(history.notes[7].id),
    "Retrieve the 9 September follow-up alongside the earlier concern",
  );
  const unmatched = await search(note, live, quote, "zqxvneverpresentword");
  assert.equal(unmatched.status, "no_match");
  assert.deepEqual(unmatched.sources, []);
  // User/model input is literal text. FTS operators, quotes and SQL fragments
  // cannot alter scope or turn a syntax error into HTTP 500.
  const literal = await search(
    note,
    live,
    quote,
    'lunch OR "*"; DROP TABLE shift_notes; --',
  );
  assertHistoryOnly(literal);
  assert.ok(
    await db
      .prepare("SELECT id FROM shift_notes WHERE id=?")
      .bind(note.id)
      .first(),
  );

  const retro = await newNote({
    start: "2026-09-08T08:00",
    end: "2026-09-08T09:00",
  });
  const retroLive = await conversation(retro);
  await retroLive.event("user", quote);
  const retrospective = await search(
    retro,
    retroLive,
    quote,
    "lunch appetite tired",
  );
  for (const source of retrospective.sources) {
    assert.ok(
      !history.notes.slice(6).some((future) => future.id === source.noteId),
      "Retrospective shift must not retrieve future events",
    );
  }
  assert.ok(
    retrospective.sources.length,
    "The earlier shift can retrieve eligible earlier notes",
  );
  const retroQuestions = `/api/notes/${retro.id}/interview/questions`;
  const retroInput = {
    retrievalId: retrospective.retrievalId,
    sourceIds: [retrospective.sources[0].sourceId],
    purposeKey: "lunch_setting_check",
    question: "Which lunch setting did Sarah choose during this shift?",
    voiceSessionId: retroLive.id,
    revision: retro.revision,
  };
  const cancelledProposal = await request(retroQuestions, {
    session: worker,
    body: retroInput,
  });
  const correction =
    "Actually, the cafe visit happened yesterday, not during this shift.";
  await retroLive.event("user", correction);
  assert.equal(
    (await request(retroQuestions, { session: worker })).questions[0].status,
    "cancelled",
    "A worker update before emission invalidates the queued question",
  );
  const refreshed = await search(retro, retroLive, correction, "lunch setting");
  const replacement = await request(retroQuestions, {
    session: worker,
    body: {
      ...retroInput,
      retrievalId: refreshed.retrievalId,
      sourceIds: [refreshed.sources[0].sourceId],
    },
  });
  assert.notEqual(replacement.question.id, cancelledProposal.question.id);
  assert.equal(
    replacement.remainingClarifications,
    2,
    "An unspoken, cancelled proposal does not consume a clarification",
  );
  await retroLive.close();
  const closedQuestions = (await request(retroQuestions, { session: manager }))
    .questions;
  const closedProposal = closedQuestions.find(
    (question) => question.id === replacement.question.id,
  );
  assert.equal(closedProposal.status, "cancelled");
  assert.match(
    JSON.parse(
      closedProposal.events.findLast(
        (event) => event.event_type === "cancelled",
      ).details_json,
    ).reason,
    /closed/i,
  );
  const closedContext = await request(
    `/api/notes/${retro.id}/knowledge/context`,
    { session: worker },
  );
  assert.equal(
    closedContext.remainingClarifications,
    3,
    "Closing an interview releases its unspoken proposal",
  );
  const resumed = await conversation(retro);
  await resumed.event("user", correction);
  const resumedSearch = await search(
    retro,
    resumed,
    correction,
    "lunch setting",
  );
  const resumedProposal = await request(retroQuestions, {
    session: worker,
    body: {
      ...retroInput,
      retrievalId: resumedSearch.retrievalId,
      sourceIds: [resumedSearch.sources[0].sourceId],
      voiceSessionId: resumed.id,
    },
  });
  assert.notEqual(resumedProposal.question.id, replacement.question.id);
  assert.equal(resumedProposal.remainingClarifications, 2);
  await resumed.close();
  const pendingTime = await newNote({
    actual: false,
    start: "2026-09-14T10:00",
    end: "2026-09-14T14:00",
  });
  const pendingLive = await conversation(pendingTime);
  await pendingLive.event("user", quote);
  const timeRequired = await search(pendingTime, pendingLive, quote, "lunch");
  assert.equal(timeRequired.status, "actual_shift_start_required");
  assert.deepEqual(timeRequired.sources, []);

  // A second patient's matching note must stay outside the first patient's
  // retrieval, even though the same worker can legitimately read both.
  const different = await newNote({
    participantId: otherParticipant.id,
    start: "2026-09-11T07:00",
    end: "2026-09-11T08:00",
  });
  const otherFields = {
    activities: "UNRELATEDPATIENTMARKER lunch appetite tired",
    supportProvided: "Observed choices",
    participantResponse: "Selected lunch",
    goalProgress: "Practised choice",
    incidents: "no",
    followUp: "none",
  };
  const differentSaved = (
    await request(`/api/notes/${different.id}`, {
      session: worker,
      method: "PATCH",
      body: { revision: different.revision, fields: otherFields },
    })
  ).note;
  assert.equal(
    await db
      .prepare("SELECT note_id FROM knowledge_fts WHERE note_id=?")
      .bind(different.id)
      .first(),
    null,
    "Draft observations must not enter historical retrieval",
  );
  const otherReview = await request(`/api/notes/${different.id}/review`, {
    session: worker,
    body: { revision: differentSaved.revision },
  });
  await request(`/api/notes/${different.id}/confirm`, {
    session: worker,
    body: {
      revision: differentSaved.revision,
      confirmationId: otherReview.confirmationId,
      confirmed: true,
    },
  });
  assert.ok(
    await db
      .prepare(
        "SELECT note_id FROM knowledge_fts WHERE note_id=? AND knowledge_fts MATCH ?",
      )
      .bind(different.id, '"UNRELATEDPATIENTMARKER"')
      .first(),
    "A note enters the index when confirmed through the real API",
  );
  await db
    .prepare("UPDATE shift_notes SET confirmed_at=? WHERE id=?")
    .bind("2026-09-11T00:15:00Z", different.id)
    .run();
  const isolated = await search(note, live, quote, "UNRELATEDPATIENTMARKER");
  assert.equal(isolated.status, "no_match");
  assert.deepEqual(isolated.sources, []);

  const template = buildHistoryRows(history);
  const colleagueShift = {
    ...template.shifts[0],
    id: randomUUID(),
    worker_id: colleague.user.id,
    worker_name: "Synthetic Colleague",
  };
  const colleagueNote = {
    ...template.notes[0],
    id: randomUUID(),
    shift_id: colleagueShift.id,
    owner_id: colleague.user.id,
    worker_name: "Synthetic Colleague",
    fields_json: JSON.stringify({
      ...history.notes[0].fields,
      activities: "COWORKERHISTORYMARKER lunch appetite tired",
    }),
  };
  await insert("scheduled_shifts", colleagueShift);
  await insert("shift_notes", colleagueNote);
  const coworkerIsolated = await search(
    note,
    live,
    quote,
    "COWORKERHISTORYMARKER",
  );
  assert.equal(coworkerIsolated.status, "no_match");
  assert.deepEqual(coworkerIsolated.sources, []);

  const unreviewed = JSON.parse(template.notes[4].safety_json);
  unreviewed.fieldStates.incidents = "not_reviewed";
  unreviewed.fieldStates.followUp = "not_reviewed";
  unreviewed.syntheticFixture.topics = ["SECRETTESTMETADATA"];
  unreviewed.syntheticFixture.continuity = ["HIDDENCONTINUITYMARKER"];
  await db
    .prepare("UPDATE shift_notes SET safety_json=? WHERE id=?")
    .bind(JSON.stringify(unreviewed), history.notes[4].id)
    .run();
  const unknowns = await search(note, live, quote, "birthday cousin");
  const unreviewedSource = unknowns.sources.find(
    (source) => source.noteId === history.notes[4].id,
  );
  assert.ok(unreviewedSource);
  assert.equal(unreviewedSource.fields.incidents, "unknown");
  assert.equal(unreviewedSource.fields.followUp, "unknown");
  const metadata = await search(
    note,
    live,
    quote,
    "SECRETTESTMETADATA HIDDENCONTINUITYMARKER",
  );
  assert.equal(metadata.status, "no_match");
  assert.deepEqual(metadata.sources, []);

  // The question contract is verified below after the retrieval boundary tests.
  const staleSourceRun = await search(
    note,
    live,
    quote,
    "lunch appetite tired",
  );
  const changedSource = staleSourceRun.sources[0];
  await db
    .prepare("UPDATE shift_notes SET revision=revision+1 WHERE id=?")
    .bind(changedSource.noteId)
    .run();
  assert.equal(
    Number(
      (
        await db
          .prepare("SELECT revision FROM knowledge_fts WHERE note_id=?")
          .bind(changedSource.noteId)
          .first()
      ).revision,
    ),
    changedSource.revision + 1,
    "Source revision changes must replace the indexed revision",
  );
  await request(questionPath, {
    session: worker,
    expected: 409,
    body: {
      retrievalId: staleSourceRun.retrievalId,
      sourceIds: [changedSource.sourceId],
      purposeKey: "source_revision_check",
      question: "How much lunch did Sarah eat during this shift?",
      voiceSessionId: live.id,
      revision: note.revision,
    },
  });
  const fresh = await search(note, live, quote, "lunch appetite tired");
  const registration = {
    retrievalId: fresh.retrievalId,
    sourceIds: [fresh.sources[0].sourceId],
    purposeKey: "lunch_observation",
    question: "How much lunch did Sarah eat during this shift?",
    voiceSessionId: live.id,
    revision: note.revision,
  };
  await request(questionPath, {
    session: worker,
    body: { ...registration, sourceIds: [randomUUID()] },
    expected: 400,
  });
  await request(questionPath, {
    session: worker,
    body: { ...registration, revision: note.revision - 1 },
    expected: 409,
  });
  const registered = await request(questionPath, {
    session: worker,
    body: registration,
  });
  assert.equal(registered.question.status, "proposed");
  assert.equal(registered.remainingClarifications, 2);
  const duplicate = await request(questionPath, {
    session: worker,
    body: registration,
  });
  assert.equal(duplicate.question.id, registered.question.id);
  assert.equal(
    duplicate.remainingClarifications,
    registered.remainingClarifications,
  );
  const beforeAnswer = await request(questionPath, { session: manager });
  assert.equal(beforeAnswer.questions.length, 1);
  assert.equal(beforeAnswer.questions[0].status, "proposed");
  assert.equal(
    beforeAnswer.questions[0].citations[0].sourceId,
    registration.sourceIds[0],
  );
  assert.equal(beforeAnswer.questions[0].citations[0].accessible, true);
  // An update cannot claim that an unasked question has been answered.
  await request(`/api/notes/${note.id}`, {
    session: worker,
    method: "PATCH",
    expected: 409,
    body: {
      revision: note.revision,
      voiceSessionId: live.id,
      fields: { activities: "Must roll back" },
      questionUpdates: [
        { questionId: registered.question.id, state: "answered", quote },
      ],
    },
  });
  assert.equal(
    (await request(`/api/notes/${note.id}`, { session: worker })).note.fields
      .activities,
    "",
  );
  await live.event("agent", registration.question);
  const emitted = await request(questionPath, { session: worker });
  assert.equal(emitted.questions[0].status, "emitted");
  const answer = "Sarah ate half her sandwich during lunch today.";
  await live.event("user", answer);
  await request(`/api/notes/${note.id}`, {
    session: worker,
    method: "PATCH",
    expected: 409,
    body: {
      revision: note.revision,
      voiceSessionId: live.id,
      fields: { participantResponse: "Invented observation" },
      questionUpdates: [
        {
          questionId: registered.question.id,
          state: "answered",
          quote: "A response that was never said",
        },
      ],
    },
  });
  const answerBody = {
    revision: note.revision,
    voiceSessionId: live.id,
    fields: { participantResponse: answer },
    questionUpdates: [
      {
        questionId: registered.question.id,
        state: "answered",
        quote: answer,
      },
    ],
  };
  await db
    .prepare(
      `CREATE TRIGGER knowledge_test_reject_answer
    BEFORE INSERT ON interview_question_events WHEN NEW.event_type='answered'
    BEGIN SELECT RAISE(ABORT,'Isolated integration test rejects answer write'); END;`,
    )
    .run();
  await request(`/api/notes/${note.id}`, {
    session: worker,
    method: "PATCH",
    body: answerBody,
    expected: 503,
  });
  const rolledBack = (
    await request(`/api/notes/${note.id}`, { session: worker })
  ).note;
  assert.equal(rolledBack.revision, note.revision);
  assert.equal(rolledBack.fields.participantResponse, "");
  assert.equal(
    (await request(questionPath, { session: worker })).questions[0].status,
    "emitted",
  );
  await db.prepare("DROP TRIGGER knowledge_test_reject_answer").run();
  const answered = await request(`/api/notes/${note.id}`, {
    session: worker,
    method: "PATCH",
    body: answerBody,
  });
  note.revision = answered.note.revision;
  assert.equal(answered.note.fields.participantResponse, answer);
  assert.equal(
    (await request(questionPath, { session: manager })).questions[0].status,
    "answered",
  );
  await search(note, live, quote, "lunch", {}, 409);

  const craft = await search(
    note,
    live,
    answer,
    "craft group coordinator reply",
  );
  const secondInput = {
    retrievalId: craft.retrievalId,
    sourceIds: [craft.sources[0].sourceId],
    purposeKey: "craft_enquiry_update",
    question:
      "Did the support coordinator reply about the craft group during this shift?",
    voiceSessionId: live.id,
    revision: note.revision,
  };
  const second = await request(questionPath, {
    session: worker,
    body: secondInput,
  });
  assert.equal(second.remainingClarifications, 1);
  await live.event("agent", secondInput.question);
  const unknownAnswer = "I don't know whether the support coordinator replied.";
  await live.event("user", unknownAnswer);
  const unknownSaved = await request(`/api/notes/${note.id}`, {
    session: worker,
    method: "PATCH",
    body: {
      revision: note.revision,
      voiceSessionId: live.id,
      fields: { followUp: "unknown" },
      questionUpdates: [
        {
          questionId: second.question.id,
          state: "unknown",
          quote: unknownAnswer,
        },
      ],
    },
  });
  note.revision = unknownSaved.note.revision;
  assert.equal(unknownSaved.note.fields.followUp, "unknown");
  const currentQuestions = (await request(questionPath, { session: worker }))
    .questions;
  assert.equal(
    currentQuestions.find((question) => question.id === second.question.id)
      .status,
    "unknown",
  );

  const walking = await search(
    note,
    live,
    unknownAnswer,
    "walk activity preference",
  );
  const thirdInput = {
    retrievalId: walking.retrievalId,
    sourceIds: [walking.sources[0].sourceId],
    purposeKey: "walking_choice",
    question: "Which walking activity did Sarah choose during this shift?",
    voiceSessionId: live.id,
    revision: note.revision,
  };
  const third = await request(questionPath, {
    session: worker,
    body: thirdInput,
  });
  assert.equal(third.remainingClarifications, 0);
  await request(questionPath, {
    session: worker,
    body: {
      ...thirdInput,
      purposeKey: "fourth_question",
      question: "What other activity did Sarah choose during this shift?",
    },
    expected: 409,
  });
  await live.event("agent", thirdInput.question);
  const thirdAnswer = "Sarah chose a short walk to the park today.";
  await live.event("user", thirdAnswer);
  const finalSaved = await request(`/api/notes/${note.id}`, {
    session: worker,
    method: "PATCH",
    body: {
      revision: note.revision,
      voiceSessionId: live.id,
      fields: { activities: thirdAnswer },
      questionUpdates: [
        {
          questionId: third.question.id,
          state: "answered",
          quote: thirdAnswer,
        },
      ],
    },
  });
  note.revision = finalSaved.note.revision;
  assert.equal(
    (await request(questionPath, { session: manager })).questions.length,
    3,
  );
  const afterLimit = await search(note, live, thirdAnswer, "library");
  assert.ok(
    afterLimit.retrievalId,
    "Searching alone must not consume or reset the question budget",
  );
  await request(questionPath, {
    session: worker,
    body: {
      ...thirdInput,
      retrievalId: afterLimit.retrievalId,
      sourceIds: [afterLimit.sources[0].sourceId],
      revision: note.revision,
      purposeKey: "fourth_after_answer",
      question: "Did Sarah visit the library during this shift?",
    },
    expected: 409,
  });

  await live.close();
  await search(note, live, thirdAnswer, "lunch", {}, 409);
  assert.equal(
    outboundRequests,
    0,
    "Knowledge retrieval must not call external services",
  );
  console.log(
    `${checks} isolated knowledge HTTP checks passed; retrieval, evidence, scope, question state and atomic updates verified.`,
  );
} finally {
  for (const fixture of fixtures) fixture.sqlite.close();
  await mf.dispose();
}
