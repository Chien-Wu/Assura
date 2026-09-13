import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  recorderFormResult,
  parseRecorderUpdate,
  recorderToolFailure,
} from "../lib/agent-tools.ts";

test("Agent tool artifact uses vendor response waiting and excludes model-selected patient identities", async () => {
  const tools = JSON.parse(
    await readFile(
      new URL("../config/agents/main/client-tools.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 2);
  for (const tool of tools) {
    assert.equal(tool.type, "client");
    assert.equal(tool.expects_response, true);
    assert.ok(tool.response_timeout_secs > 18);
    for (const key of [
      "patientId",
      "participantId",
      "workerId",
      "providerId",
      "noteId",
      "revision",
      "voiceSessionId",
    ])
      assert.equal(key in tool.parameters.properties, false);
  }
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["get_form_context", "update_and_check_form"],
  );
});

test("recorder excludes detector state and refuses classification or completion writes", () => {
  const fields = {
    participant: "Test",
    shiftStart: "2026-09-13T08:00",
    shiftEnd: "2026-09-13T10:00",
    activities: "Walked",
    supportProvided: "Assisted",
    participantResponse: "Appeared content",
    goalProgress: "Completed walk",
    incidents: "unanswered",
    incidentDetails: "",
    followUp: "unanswered",
    followUpDetails: "",
  };
  const value = recorderFormResult({
    note: {
      fields,
      revision: 1,
      status: "draft",
      riskFlags: [{ classification: "unverified" }],
    },
    requiredFacts: ["screening"],
    summary: "not approved",
  });
  assert.equal(value.validation.complete, true);
  assert.equal("incidents" in value.note.fields, false);
  assert.equal("riskFlags" in value.note, false);
  assert.equal("requiredFacts" in value, false);
  assert.deepEqual(
    parseRecorderUpdate(
      JSON.stringify({ fields: { activities: "Worker described a fall." } }),
    ),
    { fields: { activities: "Worker described a fall." } },
  );
  for (const payload of [
    { fields: { incidents: "no" } },
    { fields: { participant: "Other" } },
    { fields: {}, field_states: {} },
    { fields: {}, restrictive_practice: { used: "yes" } },
  ])
    assert.throws(
      () => parseRecorderUpdate(JSON.stringify(payload)),
      /stage records basic/,
    );
});

test("recorder failures preserve an unsaved state and invalid JSON cannot become a patch", () => {
  const failed = recorderToolFailure(new Error("Save timed out"));
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "unavailable");
  assert.deepEqual(failed.sources, []);
  for (const invalid of [undefined, "null", "[]", "malformed"])
    assert.throws(() => parseRecorderUpdate(invalid));
  assert.throws(() =>
    parseRecorderUpdate(JSON.stringify({ fields: {}, question_updates: [] })),
  );
});
