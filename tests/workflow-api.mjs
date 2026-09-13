import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import {
  startHarness,
  startGateway,
} from "../scripts/experiments/workflow-backend-harness.mjs";
import {
  workflowRiskTypes,
  workflowFormDefinitions,
} from "../lib/workflow-case.ts";

const directory = await mkdtemp(join(tmpdir(), "legalmate-workflow-test-"));
let h,
  gateway,
  checks = 0;
const expect = async (promise, status = 200) => {
  const value = await promise;
  assert.equal(value.status, status, JSON.stringify(value.data));
  checks++;
  return value.data;
};
const field = (value, source = "worker:1") => ({
  value,
  state: value === null ? "unknown" : "known",
  source_ids: [source],
});
try {
  h = await startHarness({ persistDirectory: directory });
  const user = await h.account(),
    other = await h.account(),
    noteId = await h.note(user);
  await expect(h.request("/api/workflow/sessions", { body: { noteId } }), 401);
  await expect(
    h.request("/api/workflow/sessions", { session: other, body: { noteId } }),
    404,
  );
  const connect = await expect(
    h.request("/api/workflow/sessions", { session: user, body: { noteId } }),
  );
  assert.equal(h.providerCalls[0].versionId, "synthetic-version");
  checks++;
  const authorization = connect.dynamicVariables.secret__workflow_token,
    path = `/api/workflow/cases/${connect.caseId}`;
  assert(!connect.dynamicVariables.case_context.includes(authorization));
  checks++;
  await expect(h.request(path, { session: other }), 404);
  await expect(h.request("/api/workflow/tools/context"), 401);
  await expect(
    h.request("/api/workflow/tools/context", {
      authorization: authorization + "x",
    }),
    401,
  );
  let current = await expect(
    h.request(path, {
      session: user,
      body: {
        action: "source",
        expected_revision: 0,
        source: {
          id: "worker:1",
          kind: "worker_utterance",
          text: "Fictional event at one pm; medication name unknown. The support worker recorded the facts.",
        },
      },
    }),
  );
  const patch = {
    risk_type: "medication",
    expected_revision: current.revision,
    followup_status: "handled",
    fields_json: JSON.stringify({
      fields: { medication_name: field(null), scheduled_time: field("13:00") },
      shared_fields: { occurred_at: field("13:00") },
    }),
  };
  const simultaneous = await Promise.all([
    expect(
      h.request("/api/workflow/tools/save", { authorization, body: patch }),
    ),
    expect(
      h.request("/api/workflow/tools/save", { authorization, body: patch }),
    ),
  ]);
  let saved = simultaneous[0];
  assert(
    simultaneous.every(
      (result) => result.ok && result.event_id === saved.event_id,
    ),
  );
  assert.equal(simultaneous[0].revision, simultaneous[1].revision);
  checks++;
  assert.equal(saved.ok, true);
  checks++;
  const eventId = saved.event_id;
  const repeat = await expect(
    h.request("/api/workflow/tools/save", { authorization, body: patch }),
  );
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.revision, saved.revision);
  checks++;
  // All six schemas save through the same authenticated tool to one shared event.
  for (const riskType of workflowRiskTypes.filter((x) => x !== "medication")) {
    const key = Object.keys(workflowFormDefinitions[riskType].fields)[0];
    saved = await expect(
      h.request("/api/workflow/tools/save", {
        authorization,
        body: {
          risk_type: riskType,
          event_id: eventId,
          expected_revision: saved.revision,
          followup_status: "handled",
          fields_json: JSON.stringify({
            fields: { [key]: field("Reported synthetic fact") },
          }),
        },
      }),
    );
    assert.equal(saved.ok, true);
    checks++;
  }
  const before = await expect(h.request(path, { session: user }));
  assert.equal(Object.keys(before.case.events[0].risk_forms).length, 6);
  checks++;
  current = await expect(
    h.request(path, {
      session: user,
      body: {
        action: "source",
        expected_revision: saved.revision,
        source: {
          id: "edit:1",
          kind: "worker_form_edit",
          text: "Correction: the event happened at 14:00.",
        },
      },
    }),
  );
  const stale = await expect(
    h.request("/api/workflow/tools/save", {
      authorization,
      body: { ...patch, event_id: eventId, expected_revision: 0 },
    }),
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "stale_revision");
  checks++;
  saved = await expect(
    h.request("/api/workflow/tools/save", {
      authorization,
      body: {
        risk_type: "medication",
        event_id: eventId,
        expected_revision: current.revision,
        followup_status: "handled",
        fields_json: JSON.stringify({
          shared_fields: { occurred_at: field("14:00", "edit:1") },
        }),
      },
    }),
  );
  assert.equal(
    saved.context.events[0].shared_fields.occurred_at.value,
    "14:00",
  );
  assert.equal(
    saved.context.events[0].risk_forms.health_wellbeing.followup_status,
    "pending",
  );
  checks++;
  const bad = {
    risk_type: "medication",
    event_id: eventId,
    expected_revision: saved.revision,
    fields_json: JSON.stringify({
      fields: { symptoms: field("Invented", "other-case-source") },
    }),
  };
  for (let i = 0; i < 3; i++) {
    const rejected = await expect(
      h.request("/api/workflow/tools/save", { authorization, body: bad }),
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, i === 2 ? "retry_limit" : "invalid_source");
    checks++;
  }
  await expect(
    h.request(path, {
      session: user,
      body: { action: "review", expected_revision: saved.revision },
    }),
    409,
  );
  gateway = await startGateway(() => h);
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${gateway.port}/api/workflow/sessions`, {
        method: "POST",
      })
    ).status,
    404,
  );
  checks++;
  assert.equal(
    (await fetch(`http://127.0.0.1:${gateway.port}/api/workflow/tools/context`))
      .status,
    401,
  );
  checks++;
  // Force a multi-byte Chinese character across HTTP chunks. The gateway must
  // decode the complete UTF-8 stream before parsing JSON, even on a rejected save.
  const probe = Buffer.from(JSON.stringify({ probe: "藥物" }));
  const split = probe.indexOf(Buffer.from("藥")) + 1;
  const probeStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `http://127.0.0.1:${gateway.port}/api/workflow/tools/save`,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.write(probe.subarray(0, split));
    setTimeout(() => req.end(probe.subarray(split)), 30);
  });
  assert.equal(probeStatus, 200);
  assert.equal(gateway.requests.at(-1).body.probe, "藥物");
  checks += 2;
  await gateway.close();
  gateway = null;
  // Persisted D1 is reopened in a fresh Worker, proving process-restart durability.
  const databaseId = h.databaseId;
  await h.close();
  h = await startHarness({
    persistDirectory: directory,
    databaseId,
    initialize: false,
  });
  const reopened = await expect(h.request(path, { session: user }));
  assert.equal(
    reopened.case.events[0].shared_fields.occurred_at.value,
    "14:00",
  );
  checks++;
  await expect(h.request(path, { session: user, body: { action: "close" } }));
  await expect(
    h.request("/api/workflow/tools/context", { authorization }),
    401,
  );
  const review = await expect(
    h.request(path, {
      session: user,
      body: { action: "review", expected_revision: saved.revision },
    }),
  );
  assert.equal(review.noteConfirmed, false);
  checks++;
  const resumed = await expect(
    h.request("/api/workflow/sessions", { session: user, body: { noteId } }),
  );
  assert.equal(
    (await expect(h.request(path, { session: user }))).reviewed,
    false,
  );
  checks++;
  await h.db
    .prepare("UPDATE workflow_sessions SET expires_at=? WHERE id=?")
    .bind("2000-01-01T00:00:00.000Z", resumed.sessionId)
    .run();
  await expect(
    h.request("/api/workflow/tools/context", {
      authorization: resumed.dynamicVariables.secret__workflow_token,
    }),
    401,
  );
  const anotherNote = await h.note(user, "Another fictional participant");
  const another = await expect(
    h.request("/api/workflow/sessions", {
      session: user,
      body: { noteId: anotherNote },
    }),
  );
  const otherPath = `/api/workflow/cases/${another.caseId}`;
  const anotherSource = await expect(
    h.request(otherPath, {
      session: user,
      body: {
        action: "source",
        expected_revision: 0,
        source: {
          id: "worker:1",
          kind: "worker_utterance",
          text: "A different participant's event.",
        },
      },
    }),
  );
  const wrongEvent = await expect(
    h.request("/api/workflow/tools/save", {
      authorization: another.dynamicVariables.secret__workflow_token,
      body: {
        ...patch,
        event_id: eventId,
        expected_revision: anotherSource.revision,
      },
    }),
  );
  assert.equal(wrongEvent.code, "missing_event");
  assert.equal(wrongEvent.ok, false);
  checks++;
  await h.db
    .prepare("UPDATE shift_notes SET revision=revision+1 WHERE id=?")
    .bind(noteId)
    .run();
  assert.equal(
    (await expect(h.request(path, { session: user }))).reviewed,
    false,
  );
  checks++;
  const successor = await expect(
    h.request("/api/workflow/sessions", {
      session: user,
      body: { noteId: anotherNote },
    }),
  );
  await expect(
    h.request(otherPath, {
      session: user,
      body: { action: "close", sessionId: another.sessionId },
    }),
  );
  await expect(
    h.request("/api/workflow/tools/context", {
      authorization: successor.dynamicVariables.secret__workflow_token,
    }),
  );
  await h.db
    .prepare("UPDATE shift_notes SET status='complete' WHERE id=?")
    .bind(anotherNote)
    .run();
  await expect(
    h.request(otherPath, {
      session: user,
      body: { action: "close", sessionId: successor.sessionId },
    }),
  );
  const ended = await h.db
    .prepare("SELECT closed_at FROM workflow_sessions WHERE id=?")
    .bind(successor.sessionId)
    .first();
  assert(
    ended.closed_at,
    "A complete note still allows its session to be closed",
  );
  checks++;
  await h.close();
  h = await startHarness({ testPassword: "synthetic-demo-login-test" });
  await expect(
    h.request("/api/auth/sign-in/test-account", {
      body: { email: "workertest@gmail.com", password: "incorrect" },
    }),
    401,
  );
  assert.equal(
    (await h.db.prepare("SELECT COUNT(*) AS n FROM providers").first()).n,
    0,
  );
  checks++;
  await expect(
    h.request("/api/auth/sign-in/test-account", {
      body: {
        email: "workertest@gmail.com",
        password: "synthetic-demo-login-test",
      },
    }),
  );
  assert(
    await h.db
      .prepare(
        "SELECT user_id FROM app_profiles WHERE user_id='auth_test_worker'",
      )
      .first(),
  );
  checks++;
  await expect(
    h.request("/api/auth/sign-in/test-account", {
      body: {
        email: "managertest@gmail.com",
        password: "synthetic-demo-login-test",
      },
    }),
  );
  await h.db
    .prepare("UPDATE providers SET active=0 WHERE id='testprovider'")
    .run();
  await expect(
    h.request("/api/auth/sign-in/test-account", {
      body: {
        email: "workertest@gmail.com",
        password: "synthetic-demo-login-test",
      },
    }),
    503,
  );
  assert.equal(
    (
      await h.db
        .prepare("SELECT active FROM providers WHERE id='testprovider'")
        .first()
    ).active,
    0,
  );
  checks++;
  await h.close();
  h = await startHarness({ enabled: false });
  await expect(h.request("/api/workflow/sessions", { body: { noteId } }), 404);
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      sixSchemasSaved: true,
      reopenedD1: true,
      providerCalls: "mocked",
      productionDatabaseUsed: false,
    }),
  );
} finally {
  if (gateway) await gateway.close();
  if (h) await h.close();
  await rm(directory, { recursive: true, force: true });
}
