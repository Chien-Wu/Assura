// Built-Worker integration tests: isolated D1 and real signed session fixtures.
// No application dev server, personal data, or external service is used.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Miniflare, Log, LogLevel } from "miniflare";
import { testAccountStatements } from "../../scripts/provision-test-accounts.mjs";
import {
  TEST_ACCOUNTS,
  TEST_PROVIDER_ID,
} from "../../lib/auth/test-accounts.ts";
import { applyMigrations } from "../support/migration-fixture.mjs";
import {
  createAuthFixture,
  signInFixture,
  testAuthEnvironment,
} from "../support/auth-fixture.mjs";

const root = fileURLToPath(new URL("../../dist/server/", import.meta.url));
const origin = testAuthEnvironment.LEGALMATE_PUBLIC_ORIGIN;
const files = await readdir(root, { recursive: true });
const modules = [
  "index.js",
  ...files.filter((name) => name.endsWith(".js") && name !== "index.js"),
].map((name) => ({ type: "ESModule", path: `${root}${name}` }));
let outboundRequests = 0;
const testPassword = randomUUID() + randomUUID();
const runtimeOptions = {
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
  port: 0,
  host: "127.0.0.1",
  cf: false,
  log: new Log(LogLevel.ERROR),
  outboundService: () => {
    outboundRequests++;
    return new Response("External requests are disabled in integration tests", {
      status: 503,
    });
  },
};
const mf = new Miniflare(runtimeOptions);
let checks = 0;
const fixtures = [];
try {
  let db = await mf.getD1Database("DB");
  await request("/api/health", { expected: 503 });
  await applyMigrations(db);
  async function insert(table, row) {
    const columns = Object.keys(row);
    await db
      .prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      )
      .bind(...Object.values(row))
      .run();
  }
  async function account(email) {
    const fixture = createAuthFixture();
    fixtures.push(fixture);
    const session = await signInFixture(fixture, email);
    await insert("auth_user", session.userRow);
    await insert("auth_session", session.sessionRow);
    return session;
  }
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
        "cf-connecting-ip": "203.0.113.10",
        ...(session ? { Cookie: session.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: expected HTTP ${expected}, received ${response.status}`,
    );
    checks++;
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
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
  // Personal Google sign-in remains required even when limited test accounts
  // are enabled. Deferred email OTP alone cannot satisfy readiness.
  for (const [google, email] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    await mf.setOptions({
      ...runtimeOptions,
      bindings: {
        ...runtimeOptions.bindings,
        GOOGLE_CLIENT_ID: google ? "test-only-google-client" : "",
        GOOGLE_CLIENT_SECRET: google ? "test-only-google-secret" : "",
        RESEND_API_KEY: email ? testAuthEnvironment.RESEND_API_KEY : "",
        LEGALMATE_EMAIL_FROM: email
          ? testAuthEnvironment.LEGALMATE_EMAIL_FROM
          : "",
      },
    });
    const health = await request("/api/health", {
      expected: google ? 200 : 503,
    });
    assert.equal(health.database, true);
    assert.deepEqual(health.authentication, {
      google,
      email,
      testAccounts: true,
    });
    assert.equal(health.status, google ? "ready" : "unavailable");
  }
  // Runtime reconfiguration invalidates Miniflare proxy handles, not D1 data.
  db = await mf.getD1Database("DB");
  await request("/api/onboarding", { expected: 401 });
  await request("/api/notes", {
    expected: 401,
    headers: {
      "oai-authenticated-user-id": "forged",
      "oai-authenticated-user-email": "manager@example.test",
      Cookie: "__sites_local_auth=1",
    },
  });
  await request("/api/management", { expected: 401 });
  const now = new Date().toISOString();
  for (const [id, name, active] of [
    ["provider_a", "Test Provider A", 1],
    ["provider_b", "Test Provider B", 1],
    ["provider_hidden", "Inactive provider", 0],
  ])
    await insert("providers", { id, name, active, created_at: now });
  const publicProviders = await request("/api/providers");
  assert.deepEqual(
    publicProviders.providers.map((p) => p.id),
    ["provider_a", "provider_b"],
  );
  for (const provider of publicProviders.providers)
    assert.deepEqual(Object.keys(provider).sort(), ["id", "name"]);
  const workerA = await account("worker-a@example.test");
  const workerB = await account("worker-b@example.test");
  const workerC = await account("worker-c@example.test");
  const managerA = await account("manager-a@example.test");
  const managerB = await account("manager-b@example.test");
  assert.equal(
    (await request("/api/onboarding", { session: workerA })).profile,
    null,
  );
  await request("/api/notes", {
    session: workerA,
    body: { id: randomUUID() },
    expected: 403,
  });
  await request("/api/onboarding", {
    session: workerA,
    body: { fullName: "Worker A", providerId: "provider_hidden" },
    expected: 400,
  });
  await request("/api/onboarding", {
    session: workerA,
    body: { fullName: "Worker A", providerId: "provider_a" },
  });
  await request("/api/onboarding", {
    session: workerB,
    body: { fullName: "Worker B", providerId: "provider_b" },
  });
  await request("/api/onboarding", {
    session: workerC,
    body: { fullName: "Worker C", providerId: "provider_a" },
  });
  const onboarded = await request("/api/onboarding", { session: workerA });
  assert.deepEqual(onboarded.profile, {
    fullName: "Worker A",
    providerId: "provider_a",
  });
  assert.deepEqual(onboarded.managedProviders, []);
  await request("/api/management", { session: workerA, expected: 403 });
  await request("/api/management", { session: managerA, expected: 403 });
  for (const [session, providerId] of [
    [managerA, "provider_a"],
    [managerB, "provider_b"],
  ])
    await insert("provider_manager_grants", {
      id: randomUUID(),
      provider_id: providerId,
      email: session.user.email,
      active: 1,
      created_at: now,
    });
  async function participant(session, providerId, name) {
    return (
      await request(`/api/participants?providerId=${providerId}`, {
        session,
        body: {
          profile: {
            name,
            communication: "Original communication guidance",
            risks: ["Original support risk"],
          },
        },
        expected: 201,
      })
    ).participant;
  }
  async function shift(
    session,
    providerId,
    participantId,
    workerId,
    changes = {},
  ) {
    return (
      await request(`/api/shifts?providerId=${providerId}`, {
        session,
        body: {
          participantId,
          workerId,
          expectedStart: "2026-09-12T09:00",
          expectedEnd: "2026-09-12T13:00",
          timezone: "Australia/Melbourne",
          ...changes,
        },
        expected: 201,
      })
    ).shift;
  }
  await request("/api/participants", { expected: 401 });
  await request("/api/shifts", { expected: 401 });
  await request("/api/provider-workers", { expected: 401 });
  await request("/api/participants?providerId=provider_a", {
    session: workerA,
    body: { profile: { name: "Worker-created participant" } },
    expected: 403,
  });
  await request("/api/provider-workers?providerId=provider_a", {
    session: workerA,
    expected: 403,
  });
  await request("/api/participants?providerId=provider_b", {
    session: managerA,
    expected: 403,
  });
  const participantA = await participant(
    managerA,
    "provider_a",
    "Participant A",
  );
  const participantB = await participant(
    managerB,
    "provider_b",
    "Participant B",
  );
  assert.deepEqual(
    (
      await request("/api/participants?providerId=provider_a", {
        session: managerA,
      })
    ).participants.map((item) => item.id),
    [participantA.id],
  );
  assert.deepEqual(
    new Set(
      (
        await request("/api/provider-workers?providerId=provider_a", {
          session: managerA,
        })
      ).workers.map((item) => item.userId),
    ),
    new Set([workerA.user.id, workerC.user.id]),
  );
  await request(`/api/participants/${participantB.id}?providerId=provider_a`, {
    session: managerA,
    method: "PATCH",
    body: { profile: { name: "Cross-provider edit" } },
    expected: 404,
  });
  const shiftBody = {
    participantId: participantA.id,
    workerId: workerA.user.id,
    expectedStart: "2026-09-12T09:00",
    expectedEnd: "2026-09-12T13:00",
    timezone: "Australia/Melbourne",
  };
  await request("/api/shifts?providerId=provider_a", {
    session: workerA,
    body: shiftBody,
    expected: 403,
  });
  await request("/api/shifts?providerId=provider_b", {
    session: managerA,
    body: shiftBody,
    expected: 403,
  });
  for (const changes of [
    { participantId: participantB.id },
    { workerId: workerB.user.id },
    { expectedStart: "2026-02-30T09:00" },
    { expectedEnd: "2026-09-12T09:00" },
    { expectedEnd: "2026-09-12T08:00" },
    { timezone: "Not/A_Timezone" },
  ])
    await request("/api/shifts?providerId=provider_a", {
      session: managerA,
      body: { ...shiftBody, ...changes },
      expected: 400,
    });
  const shiftA = await shift(
    managerA,
    "provider_a",
    participantA.id,
    workerA.user.id,
  );
  const shiftB = await shift(
    managerB,
    "provider_b",
    participantB.id,
    workerB.user.id,
  );
  const shiftC = await shift(
    managerA,
    "provider_a",
    participantA.id,
    workerC.user.id,
    {
      expectedStart: "2026-09-12T22:00",
      expectedEnd: "2026-09-13T06:00",
    },
  );
  assert.deepEqual(
    (await request("/api/shifts", { session: workerA })).shifts.map(
      (item) => item.id,
    ),
    [shiftA.id],
  );
  assert.deepEqual(
    new Set(
      (
        await request("/api/shifts?providerId=provider_a", {
          session: managerA,
        })
      ).shifts.map((item) => item.id),
    ),
    new Set([shiftA.id, shiftC.id]),
  );
  await request("/api/shifts?providerId=provider_b", {
    session: managerA,
    expected: 403,
  });
  await request("/api/notes", {
    session: workerA,
    body: { id: randomUUID() },
    expected: 400,
  });
  for (const unavailable of [shiftB.id, shiftC.id, randomUUID()])
    await request("/api/notes", {
      session: workerA,
      body: { id: randomUUID(), shiftId: unavailable },
      expected: 404,
    });
  const noteA = (
    await request("/api/notes", {
      session: workerA,
      body: { id: randomUUID(), shiftId: shiftA.id },
      expected: 201,
    })
  ).note;
  const noteB = (
    await request("/api/notes", {
      session: workerB,
      body: { id: randomUUID(), shiftId: shiftB.id },
      expected: 201,
    })
  ).note;
  assert.equal(noteA.providerId, "provider_a");
  assert.equal(noteB.providerId, "provider_b");
  assert.equal(noteA.shiftId, shiftA.id);
  assert.equal(noteA.participantId, participantA.id);
  assert.equal(noteA.fields.participant, "Participant A");
  assert.equal(noteA.fields.shiftStart, "");
  assert.equal(noteA.fields.shiftEnd, "");
  assert.equal(noteA.expectedStart, shiftA.expectedStart);
  assert.equal(noteA.expectedEnd, shiftA.expectedEnd);
  assert.equal(
    noteA.participantSnapshot.communication,
    "Original communication guidance",
  );
  assert.equal(
    (
      await request("/api/notes", {
        session: workerA,
        body: { id: randomUUID(), shiftId: shiftA.id },
        expected: 201,
      })
    ).note.id,
    noteA.id,
  );
  assert.equal(
    (await request("/api/shifts", { session: workerA })).shifts[0].noteId,
    noteA.id,
  );
  await request(`/api/participants/${participantA.id}?providerId=provider_a`, {
    session: managerA,
    method: "PATCH",
    body: {
      profile: {
        name: "Participant A renamed",
        communication: "Updated guidance",
        risks: [],
      },
    },
  });
  const frozenNote = (
    await request(`/api/notes/${noteA.id}`, { session: workerA })
  ).note;
  assert.deepEqual(frozenNote.participantSnapshot, noteA.participantSnapshot);
  assert.equal(frozenNote.fields.participant, "Participant A");
  await request(`/api/notes/${noteA.id}`, {
    session: workerA,
    method: "PATCH",
    body: { revision: 0, fields: { participant: "Participant B" } },
    expected: 400,
  });
  const actualTimes = (
    await request(`/api/notes/${noteA.id}`, {
      session: workerA,
      method: "PATCH",
      body: {
        revision: 0,
        fields: {
          shiftStart: "2026-09-12T10:00",
          shiftEnd: "2026-09-12T09:00",
          activities: "Fictional community outing",
          supportProvided: "Verbal prompts",
          participantResponse: "Chose an activity",
          goalProgress: "Practised choices",
          incidents: "no",
          followUp: "none",
        },
      },
    })
  ).note;
  const invalidReview = await request(`/api/notes/${noteA.id}/review`, {
    session: workerA,
    body: { revision: actualTimes.revision },
    expected: 422,
  });
  assert.match(invalidReview.error, /end must be after the start/i);
  assert.equal(actualTimes.expectedStart, "2026-09-12T09:00");
  assert.equal(actualTimes.expectedEnd, "2026-09-12T13:00");
  const setupNote = (
    await request(`/api/notes/${noteA.id}`, {
      session: workerA,
      method: "PATCH",
      body: {
        revision: actualTimes.revision,
        fields: { shiftEnd: "2026-09-12T13:00" },
      },
    })
  ).note;
  const setupRequired = await request(`/api/notes/${noteA.id}/assessment`, {
    session: workerA,
    body: { action: "start", revision: setupNote.revision },
    expected: 503,
  });
  assert.match(setupRequired.error, /needs setup/i);
  const setupState = await request(`/api/notes/${noteA.id}/assessment`, {
    session: workerA,
  });
  assert.equal(setupState.enabled, false);
  assert.equal(setupState.assessment, null);
  assert.equal(setupState.note.status, "draft");
  await request(`/api/notes/${noteA.id}`, { session: workerB, expected: 404 });
  await request(`/api/notes/${noteA.id}/audit`, {
    session: workerB,
    expected: 404,
  });
  assert.deepEqual(
    (
      await request("/api/onboarding", { session: managerA })
    ).managedProviders.map((p) => p.id),
    ["provider_a"],
  );
  const boardA = await request("/api/management", { session: managerA });
  assert.deepEqual(
    boardA.notes.map((note) => note.id),
    [noteA.id],
  );
  await request("/api/management?providerId=provider_b", {
    session: managerA,
    expected: 403,
  });
  await request(`/api/notes/${noteA.id}/audit`, { session: managerA });
  await request(`/api/notes/${noteB.id}/audit`, {
    session: managerA,
    expected: 404,
  });
  await request(`/api/notes/${noteA.id}`, {
    session: managerA,
    method: "PATCH",
    body: { revision: 0, fields: { activities: "Manager overwrite" } },
    expected: 404,
  });
  const riskA = randomUUID(),
    riskB = randomUUID();
  for (const [id, note, owner] of [
    [riskA, noteA, workerA],
    [riskB, noteB, workerB],
  ])
    await insert("risk_events", {
      id,
      note_id: note.id,
      owner_id: owner.user.id,
      code: "TEST_REVIEW",
      category: "other",
      data_json: JSON.stringify({ code: "TEST_REVIEW", category: "other" }),
      captured_at: now,
      inbox_at: now,
    });
  await request(`/api/management/${riskA}`, {
    session: workerA,
    body: { comment: "Worker attempt" },
    expected: 403,
  });
  await request(`/api/management/${riskB}`, {
    session: managerA,
    body: { comment: "Other provider attempt" },
    expected: 404,
  });
  await request(`/api/management/${riskA}`, {
    session: managerA,
    body: { comment: "Manager reviewed original record" },
  });
  const actions = await db
    .prepare("SELECT owner_id,actor FROM risk_actions WHERE risk_id=?")
    .bind(riskA)
    .all();
  assert.equal(actions.results.length, 1);
  assert.equal(actions.results[0].owner_id, workerA.user.id);
  assert.equal(actions.results[0].actor, managerA.user.id);
  await request("/api/onboarding", {
    session: workerA,
    body: { fullName: "Worker A", providerId: "provider_b" },
  });
  assert.deepEqual(
    (await request("/api/shifts", { session: workerA })).shifts,
    [],
  );
  await request("/api/notes", {
    session: workerA,
    body: { id: randomUUID(), shiftId: shiftA.id },
    expected: 404,
  });
  const nextShift = await shift(
    managerB,
    "provider_b",
    participantB.id,
    workerA.user.id,
  );
  const nextNote = (
    await request("/api/notes", {
      session: workerA,
      body: { id: randomUUID(), shiftId: nextShift.id },
      expected: 201,
    })
  ).note;
  assert.equal(nextNote.providerId, "provider_b");
  assert.equal(
    (await request(`/api/notes/${noteA.id}`, { session: workerA })).note
      .providerId,
    "provider_a",
  );
  await request(`/api/notes/${noteA.id}/audit`, { session: managerA });
  await request(`/api/notes/${noteA.id}/audit`, {
    session: managerB,
    expected: 404,
  });
  // Affiliation alone never exposes a colleague's notes, even at the same provider.
  await request(`/api/notes/${nextNote.id}`, {
    session: workerB,
    expected: 404,
  });
  await request(`/api/notes/${noteB.id}/audit`, {
    session: workerA,
    expected: 404,
  });
  const boardB = await request("/api/management", { session: managerB });
  assert.deepEqual(
    new Set(boardB.notes.map((note) => note.id)),
    new Set([noteB.id, nextNote.id]),
  );
  await request("/api/auth/sign-out", { session: workerA, body: {} });
  await request("/api/onboarding", { session: workerA, expected: 401 });
  await request("/api/notes", { session: workerA, expected: 401 });
  // Fixed public test aliases use the normal login endpoint and session adapter.
  let loginAttempt = 0;
  async function testLogin(alias, password = testPassword, expected = 200) {
    const result = await request("/api/auth/sign-in/test-account", {
      body: { email: alias, password },
      expected,
      withSession: true,
      headers: { "cf-connecting-ip": `203.0.113.${100 + ++loginAttempt}` },
    });
    if (expected !== 200)
      assert.equal(
        result.cookie,
        "",
        "Rejected logins must not issue a session",
      );
    return result;
  }
  await testLogin("managertest@gmail.com", testPassword, 503);
  const personalGoogle = await account("managertest@gmail.com");
  await insert("auth_account", {
    id: randomUUID(),
    account_id: "google-subject-for-test",
    provider_id: "google",
    user_id: personalGoogle.user.id,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await db.batch(
    testAccountStatements().map(({ sql, params }) =>
      db.prepare(sql).bind(...params),
    ),
  );
  await testLogin("workertest@gmail.com", "incorrect-test-password", 401);
  await testLogin("unknown-person@example.test", testPassword, 401);
  await request("/api/auth/sign-in/test-account", {
    body: { email: "workertest@gmail.com", password: testPassword },
    expected: 403,
    headers: {
      Origin: "https://untrusted.test",
      "cf-connecting-ip": "203.0.113.200",
    },
  });
  const testSessions = {};
  for (const accountDefinition of TEST_ACCOUNTS) {
    const login = await testLogin(accountDefinition.alias);
    assert.deepEqual(login.data, { redirectTo: accountDefinition.redirectTo });
    assert.ok(
      login.cookie,
      "Successful test login must issue a signed session",
    );
    const session = { cookie: login.cookie };
    const authenticated = await request("/api/auth/get-session", { session });
    assert.equal(authenticated.user.id, accountDefinition.id);
    assert.equal(authenticated.user.email, accountDefinition.email);
    assert.equal(authenticated.session.userId, accountDefinition.id);
    testSessions[accountDefinition.role] = session;
    const onboarding = await request("/api/onboarding", { session });
    assert.equal(onboarding.user.userId, accountDefinition.id);
    assert.equal(onboarding.user.email, accountDefinition.email);
    assert.equal(onboarding.user.displayEmail, accountDefinition.alias);
    assert.deepEqual(
      onboarding.providers.map((provider) => provider.id),
      [TEST_PROVIDER_ID],
    );
    if (accountDefinition.role === "worker") {
      assert.equal(onboarding.profile.providerId, TEST_PROVIDER_ID);
      assert.deepEqual(onboarding.managedProviders, []);
    } else {
      assert.deepEqual(
        onboarding.managedProviders.map((provider) => provider.id),
        [TEST_PROVIDER_ID],
      );
    }
  }
  const testWorker = testSessions.worker,
    testManager = testSessions.manager;
  // Stray grants and memberships must not expand the reserved test roles.
  for (const [providerId, accountDefinition] of [
    ["provider_b", TEST_ACCOUNTS.find((account) => account.role === "manager")],
    [
      TEST_PROVIDER_ID,
      TEST_ACCOUNTS.find((account) => account.role === "worker"),
    ],
  ])
    await insert("provider_manager_grants", {
      id: randomUUID(),
      provider_id: providerId,
      email: accountDefinition.email,
      active: 1,
      claimed_user_id: accountDefinition.id,
      claimed_at: now,
      created_at: now,
    });
  await insert("provider_memberships", {
    provider_id: "provider_b",
    user_id: "auth_test_worker",
    active: 1,
    joined_at: now,
    updated_at: now,
  });
  const testParticipant = await participant(
    testManager,
    TEST_PROVIDER_ID,
    "Test participant",
  );
  const testShift = await shift(
    testManager,
    TEST_PROVIDER_ID,
    testParticipant.id,
    "auth_test_worker",
  );
  const testNote = (
    await request("/api/notes", {
      session: testWorker,
      body: { id: randomUUID(), shiftId: testShift.id },
      expected: 201,
    })
  ).note;
  assert.equal(testNote.providerId, TEST_PROVIDER_ID);
  const originalTestRow = await db
    .prepare("SELECT * FROM shift_notes WHERE id=?")
    .bind(testNote.id)
    .first();
  const strayNoteId = randomUUID();
  await insert("shift_notes", {
    ...originalTestRow,
    id: strayNoteId,
    provider_id: "provider_b",
    shift_id: null,
    participant_id: null,
    participant_snapshot_json: null,
    expected_start: null,
    expected_end: null,
  });
  assert.deepEqual(
    (await request("/api/notes", { session: testWorker })).notes.map(
      (note) => note.id,
    ),
    [testNote.id],
  );
  await request(`/api/notes/${strayNoteId}`, {
    session: testWorker,
    expected: 404,
  });
  await request(`/api/notes/${strayNoteId}`, {
    session: testWorker,
    method: "PATCH",
    body: { revision: 0, fields: { activities: "Wrong provider" } },
    expected: 404,
  });
  await request("/api/notes", {
    session: testWorker,
    body: { id: strayNoteId, shiftId: randomUUID() },
    expected: 404,
  });
  await request("/api/management", { session: testWorker, expected: 403 });
  await request("/api/notes", {
    session: testManager,
    body: { id: randomUUID(), shiftId: testShift.id },
    expected: 403,
  });
  await request("/api/onboarding", {
    session: testWorker,
    body: { fullName: "Test worker", providerId: "provider_a" },
    expected: 403,
  });
  await request("/api/management?providerId=provider_b", {
    session: testManager,
    expected: 403,
  });
  await request(`/api/notes/${noteB.id}/audit`, {
    session: testManager,
    expected: 404,
  });
  const colleague = await account("testprovider-colleague@example.test");
  await request("/api/onboarding", {
    session: colleague,
    body: { fullName: "Test colleague", providerId: TEST_PROVIDER_ID },
  });
  const colleagueShift = await shift(
    testManager,
    TEST_PROVIDER_ID,
    testParticipant.id,
    colleague.user.id,
  );
  const colleagueNote = (
    await request("/api/notes", {
      session: colleague,
      body: { id: randomUUID(), shiftId: colleagueShift.id },
      expected: 201,
    })
  ).note;
  await request(`/api/notes/${colleagueNote.id}`, {
    session: testWorker,
    expected: 404,
  });
  await request(`/api/notes/${colleagueNote.id}/audit`, {
    session: testWorker,
    expected: 404,
  });
  const testBoard = await request("/api/management", { session: testManager });
  assert.deepEqual(
    new Set(testBoard.notes.map((note) => note.id)),
    new Set([testNote.id, colleagueNote.id]),
  );
  await request(`/api/notes/${testNote.id}/audit`, { session: testManager });
  const testRiskId = randomUUID();
  await insert("risk_events", {
    id: testRiskId,
    note_id: testNote.id,
    owner_id: "auth_test_worker",
    code: "TEST_REVIEW",
    category: "other",
    data_json: JSON.stringify({ code: "TEST_REVIEW", category: "other" }),
    captured_at: now,
    inbox_at: now,
  });
  await request(`/api/management/${testRiskId}`, {
    session: testWorker,
    body: { comment: "Not a manager" },
    expected: 403,
  });
  await request(`/api/management/${riskB}`, {
    session: testManager,
    body: { comment: "Other provider" },
    expected: 404,
  });
  await request(`/api/management/${testRiskId}`, {
    session: testManager,
    body: { comment: "Shared test manager review" },
  });
  const personalOnboarding = await request("/api/onboarding", {
    session: personalGoogle,
  });
  assert.equal(personalOnboarding.user.userId, personalGoogle.user.id);
  assert.equal(personalOnboarding.user.email, "managertest@gmail.com");
  assert.notEqual(personalOnboarding.user.userId, "auth_test_manager");
  assert.deepEqual(personalOnboarding.managedProviders, []);
  assert.equal(personalOnboarding.profile, null);
  await request("/api/management", { session: personalGoogle, expected: 403 });
  await request(`/api/notes/${testNote.id}/audit`, {
    session: personalGoogle,
    expected: 404,
  });
  const personalPassword = await db
    .prepare("SELECT password FROM auth_account WHERE user_id=?")
    .bind(personalGoogle.user.id)
    .all();
  assert.deepEqual(
    personalPassword.results.map((account) => account.password),
    [null],
  );
  for (const session of [testWorker, testManager]) {
    await request("/api/auth/sign-out", { session, body: {} });
    await request("/api/onboarding", { session, expected: 401 });
  }
  await mf.setOptions({
    ...runtimeOptions,
    bindings: { ...runtimeOptions.bindings, LEGALMATE_TEST_PASSWORD: "" },
  });
  assert.equal((await request("/api/auth/status")).testAccounts, false);
  await testLogin("workertest@gmail.com", testPassword, 503);
  assert.equal(outboundRequests, 0, "No external services should be called");
  console.log(
    `${checks} isolated built-Worker HTTP checks passed; auth sessions, provider scopes, audit access and logout verified.`,
  );
} finally {
  for (const fixture of fixtures) fixture.sqlite.close();
  await mf.dispose();
}
