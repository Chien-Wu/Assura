// Built-Worker integration tests: isolated D1 and real signed session fixtures.
// No application dev server, personal data, or external service is used.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Miniflare, Log, LogLevel } from "miniflare";
import {
  createAuthFixture,
  signInFixture,
  testAuthEnvironment,
} from "./auth-fixture.mjs";

const root = fileURLToPath(new URL("../dist/server/", import.meta.url));
const origin = testAuthEnvironment.LEGALMATE_PUBLIC_ORIGIN;
const files = await readdir(root, { recursive: true });
const modules = [
  "index.js",
  ...files.filter((name) => name.endsWith(".js") && name !== "index.js"),
].map((name) => ({ type: "ESModule", path: `${root}${name}` }));
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
});
let checks = 0;
const fixtures = [];
try {
  const db = await mf.getD1Database("DB");
  await request("/api/health", { expected: 503 });
  const migrationRoot = new URL("../drizzle/", import.meta.url);
  for (const migration of (await readdir(migrationRoot))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(new URL(migration, migrationRoot), "utf8");
    // D1 exec splits by line. Our migrations contain CREATE/ALTER statements
    // and trigger bodies; keep each complete trigger intact when batching.
    const statements = sql
      .replace(/--[^\n]*/g, "")
      .split(/;\s*(?=(?:CREATE|ALTER)\b)/i)
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
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
    return text ? JSON.parse(text) : null;
  }
  await request("/api/health");
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
  const onboarded = await request("/api/onboarding", { session: workerA });
  assert.deepEqual(onboarded.profile, {
    fullName: "Worker A",
    providerId: "provider_a",
  });
  assert.deepEqual(onboarded.managedProviders, []);
  const noteA = (
    await request("/api/notes", {
      session: workerA,
      body: { id: randomUUID() },
      expected: 201,
    })
  ).note;
  const noteB = (
    await request("/api/notes", {
      session: workerB,
      body: { id: randomUUID() },
      expected: 201,
    })
  ).note;
  assert.equal(noteA.providerId, "provider_a");
  assert.equal(noteB.providerId, "provider_b");
  await request(`/api/notes/${noteA.id}`, { session: workerB, expected: 404 });
  await request(`/api/notes/${noteA.id}/audit`, {
    session: workerB,
    expected: 404,
  });
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
  const nextNote = (
    await request("/api/notes", {
      session: workerA,
      body: { id: randomUUID() },
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
  assert.equal(outboundRequests, 0, "No external services should be called");
  console.log(
    `${checks} isolated built-Worker HTTP checks passed; auth sessions, provider scopes, audit access and logout verified.`,
  );
} finally {
  for (const fixture of fixtures) fixture.sqlite.close();
  await mf.dispose();
}
