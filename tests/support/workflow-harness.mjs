// Real built application + isolated D1 + the normal signed application session.
import { readdir, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Miniflare, Log, LogLevel } from "miniflare";
import { applyMigrations } from "./migration-fixture.mjs";
import {
  createAuthFixture,
  signInFixture,
  testAuthEnvironment,
} from "./auth-fixture.mjs";
import { emptyFields, FORM_VERSION } from "../../lib/notes/form.ts";

export async function startHarness({
  provider,
  persistDirectory,
  databaseId = randomUUID(),
  enabled = true,
  initialize = true,
  testPassword,
} = {}) {
  const root = fileURLToPath(new URL("../../dist/server/", import.meta.url));
  const files = await readdir(root, { recursive: true });
  const modules = [
    "index.js",
    ...files.filter((name) => name.endsWith(".js") && name !== "index.js"),
  ].map((name) => ({ type: "ESModule", path: `${root}${name}` }));
  if (persistDirectory)
    await mkdir(persistDirectory, { recursive: true, mode: 0o700 });
  const providerCalls = [];
  const mf = new Miniflare({
    modules,
    modulesRoot: root,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      ...testAuthEnvironment,
      ...(testPassword ? { LEGALMATE_TEST_PASSWORD: testPassword } : {}),
      LEGALMATE_WORKFLOW_ENABLED: String(enabled),
      ELEVENLABS_API_KEY: provider?.key ?? "synthetic-key",
      ELEVENLABS_WORKFLOW_AGENT_ID: provider?.agentId ?? "synthetic-workflow",
      ELEVENLABS_WORKFLOW_VERSION_ID:
        provider?.versionId ?? "synthetic-version",
    },
    d1Databases: { DB: databaseId },
    d1Persist: persistDirectory ?? false,
    host: "127.0.0.1",
    port: 0,
    cf: false,
    log: new Log(LogLevel.ERROR),
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (
        url.origin !== "https://api.elevenlabs.io" ||
        ![
          "/v1/convai/conversation/get-signed-url",
          "/v1/convai/conversation/token",
        ].includes(url.pathname)
      )
        throw Error(
          "Unexpected external request from isolated workflow Worker",
        );
      providerCalls.push({
        agentId: url.searchParams.get("agent_id"),
        versionId: url.searchParams.get("version_id"),
        path: url.pathname,
      });
      if (provider) {
        // Exclude Miniflare loopback transport headers when forwarding.
        const response = await fetch(request.url, {
          method: "GET",
          headers: { "xi-api-key": provider.key },
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
        providerCalls[providerCalls.length - 1].status = response.status;
        return response;
      }
      const conversationId = randomUUID();
      return Response.json({
        signed_url: `wss://example.test/conversation?conversation_id=${conversationId}`,
        conversation_id: conversationId,
        token: "synthetic-token",
      });
    },
  });
  const db = await mf.getD1Database("DB");
  if (initialize) await applyMigrations(db);
  const fixtures = [];
  const origin = testAuthEnvironment.LEGALMATE_PUBLIC_ORIGIN;
  async function insert(table, row) {
    const keys = Object.keys(row);
    await db
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      )
      .bind(...Object.values(row))
      .run();
  }
  async function account() {
    const fixture = createAuthFixture();
    fixtures.push(fixture);
    const session = await signInFixture(
      fixture,
      `workflow-${randomUUID()}@example.test`,
      "Synthetic Workflow Worker",
    );
    await insert("auth_user", session.userRow);
    await insert("auth_session", session.sessionRow);
    return session;
  }
  async function note(session, participant = "Jordan — fictional test") {
    const id = randomUUID(),
      stamp = new Date().toISOString();
    await insert("shift_notes", {
      id,
      owner_id: session.user.id,
      worker_name: "Synthetic Workflow Worker",
      fields_json: JSON.stringify({ ...emptyFields(), participant }),
      revision: 0,
      status: "draft",
      form_version: FORM_VERSION,
      timezone: "Australia/Melbourne",
      created_at: stamp,
      updated_at: stamp,
      safety_json: "{}",
    });
    return id;
  }
  async function request(
    path,
    {
      session,
      authorization,
      body,
      method = body === undefined ? "GET" : "POST",
    } = {},
  ) {
    const response = await mf.dispatchFetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.70",
        ...(session ? { Cookie: session.cookie } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw Error(
        `Workflow response was not JSON (${response.status}): ${raw.slice(0, 120)}`,
      );
    }
    return { status: response.status, data };
  }
  return {
    mf,
    db,
    providerCalls,
    databaseId,
    account,
    note,
    request,
    insert,
    async close() {
      await mf.dispose();
      for (const fixture of fixtures) fixture.sqlite.close();
    },
  };
}
