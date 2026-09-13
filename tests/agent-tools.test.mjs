import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  agentFormResult,
  recorderFormResult,
  parseRecorderUpdate,
  agentKnowledgeResult,
  parseAgentUpdate,
  knowledgeFailure,
  toolSnapshotMatches,
} from "../lib/agent-tools.ts";

test("conversation projection excludes administrative patient data without losing care context", () => {
  const snapshot = {
    id: "patient-private-id",
    name: "Fictional participant",
    ndis: "administrative-number",
    dateOfBirth: "2000-01-01",
    communication: "Allow time to answer",
    behaviourPlan: false,
    medications: [{ name: "Routine medicine", routine: true }],
    plan: [{ id: "RP-02", maxMinutes: 5 }],
  };
  const note = {
    id: "note-private-id",
    providerId: "provider-private-id",
    participantSnapshot: snapshot,
    fields: { activities: "Made cards" },
    revision: 4,
    safety: { fieldStates: { incidents: "not_reviewed" } },
    timezone: "Australia/Melbourne",
  };
  const result = agentFormResult({
    note,
    profile: snapshot,
    nextObservationalQuestions: ["Obsolete fixed question"],
    internalAuditRecord: { ownerEmail: "private@example.invalid" },
    remainingClarifications: 2,
    scheduledShift: {
      id: "shift-private-id",
      expectedStart: "2026-09-13T10:00",
    },
  });
  const serialized = JSON.stringify(result);
  for (const secret of [
    "patient-private-id",
    "administrative-number",
    "2000-01-01",
    "note-private-id",
    "provider-private-id",
    "shift-private-id",
    "private@example.invalid",
    "Obsolete fixed question",
  ])
    assert.equal(serialized.includes(secret), false, secret);
  assert.equal(result.profile.communication, snapshot.communication);
  assert.deepEqual(result.profile.plan, snapshot.plan);
  assert.equal(result.profile.behaviourPlan, false);
  assert.equal(
    result.profile.provenance,
    "saved_note_profile_snapshot_unverified_effective_date",
  );
  assert.match(
    result.profile.guidance.join(" "),
    /false.*do not establish absence/,
  );
  assert.deepEqual(result.note.fields, note.fields);
  assert.deepEqual(result.note.safety, note.safety);
  assert.equal(result.remainingClarifications, 2);
  assert.equal(note.participantSnapshot.ndis, "administrative-number");
});

test("retrieved evidence retains date, attribution, uncertainty, revision and partial coverage", () => {
  const fields = {
    participantResponse:
      "Mother reported dinner was eaten; worker did not observe this.",
    followUp: "unknown",
  };
  const source = {
    sourceId: "note-1@3",
    noteId: "note-1",
    revision: 3,
    shiftStart: "2026-09-08T10:00",
    shiftEnd: "2026-09-08T13:00",
    confirmedAt: "2026-09-08T03:10:00Z",
    workerName: "Test worker",
    fields,
    isSynthetic: true,
    participantSnapshot: { ndis: "do-not-send" },
    internalOwnerId: "private-owner",
  };
  const result = agentKnowledgeResult({
    status: "partial",
    retrievalId: "retrieval-1",
    sources: [source],
    coverage: { returned: 1, omitted: 2, partial: true },
    questions: [{ id: "q1", status: "unknown", answerQuote: "I do not know." }],
    profile: {
      name: "Fictional participant",
      ndis: "do-not-send",
      provenance: "note_snapshot",
    },
  });
  assert.equal(result.sources[0].sourceId, "note-1@3");
  assert.equal(result.sources[0].shiftStart, source.shiftStart);
  assert.deepEqual(result.sources[0].fields, fields);
  assert.equal(result.coverage.partial, true);
  assert.equal(result.questions[0].status, "unknown");
  assert.equal(result.profile.provenance, "note_snapshot");
  assert.equal(JSON.stringify(result).includes("do-not-send"), false);
  assert.equal(JSON.stringify(result).includes("private-owner"), false);
});

test("question answers travel as validated metadata rather than note prose", () => {
  const question_updates = [
    { questionId: "q1", state: "unknown", quote: "I do not know." },
  ];
  const patch = parseAgentUpdate(
    JSON.stringify({
      activities: "Made cards",
      question_updates,
      field_states: { followUp: { state: "not_reviewed" } },
    }),
  );
  assert.deepEqual(patch.fields, { activities: "Made cards" });
  assert.deepEqual(patch.questionUpdates, question_updates);
  assert.equal("question_updates" in patch.fields, false);
  assert.deepEqual(
    parseAgentUpdate(JSON.stringify({ fields: {}, question_updates })).fields,
    {},
  );
  for (const invalid of [undefined, "null", "[]", "malformed"])
    assert.throws(() => parseAgentUpdate(invalid));
});

test("failed or obsolete retrieval cannot be treated as an absence or a current source", () => {
  const old = { revision: 4, workerSequence: 8, interruptionGeneration: 0 };
  assert.equal(toolSnapshotMatches(old, { ...old }), true);
  assert.equal(toolSnapshotMatches(old, { ...old, revision: 5 }), false);
  assert.equal(toolSnapshotMatches(old, { ...old, workerSequence: 9 }), false);
  assert.equal(
    toolSnapshotMatches(old, { ...old, interruptionGeneration: 1 }),
    false,
  );
  // An assistant filler increments the overall event sequence, not the worker
  // cursor. It must not discard evidence for the still-current worker account.
  assert.equal(toolSnapshotMatches(old, { ...old, agentSequence: 10 }), true);
  const failed = knowledgeFailure(new Error("Lookup timed out"));
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "unavailable");
  assert.deepEqual(failed.sources, []);
  assert.match(failed.action, /Continue recording this shift/);
  assert.equal(
    agentKnowledgeResult({ status: "no_match", sources: [] }).status,
    "no_match",
  );
});

test("Agent tool artifact uses vendor response waiting and excludes model-selected patient identities", async () => {
  const tools = JSON.parse(
    await readFile(
      new URL("../docs/elevenlabs-client-tools.json", import.meta.url),
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
