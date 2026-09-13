import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  recorderDynamicVariables,
  recorderFormResult,
  parseRecorderUpdate,
  recorderToolFailure,
} from "../../src/lib/recorder/tools.ts";
import { participants } from "../../src/lib/roster/participant-profiles.ts";

function scheduledNote(profile) {
  return {
    fields: { participant: profile.name },
    shiftId: `shift-${profile.id}`,
    participantSnapshot: profile,
  };
}

test("recorder startup uses the saved participant snapshot and excludes unrelated profile data", () => {
  const demo = participants[0];
  const snapshot = {
    ...structuredClone(demo),
    id: "provider-participant",
    communication: "Uses a communication board during supported activities",
    goals: ["Prepare a shopping list with support"],
    setting: "Community participation",
    ndis: "excluded-identifier",
    dateOfBirth: "2000-01-01",
    conditions: ["Excluded medical condition"],
    risks: ["Excluded risk assessment"],
    medications: [
      {
        name: "Excluded medication",
        description: "Excluded dose",
        routine: true,
      },
    ],
    mealtimePlan: "Excluded mealtime plan",
    behaviourPlan: true,
    plan: [
      {
        id: "excluded-plan",
        category: "physical",
        description: "Excluded restrictive practice",
        behaviour: "Excluded behaviour",
        authorised: true,
      },
    ],
    seizureProtocol: "Excluded clinical instructions",
  };
  const variables = recorderDynamicVariables(scheduledNote(snapshot));
  assert.deepEqual(Object.keys(variables).sort(), [
    "participant_context",
    "participant_name",
  ]);
  assert.equal(variables.participant_name, demo.name);
  assert.deepEqual(JSON.parse(variables.participant_context), {
    name: demo.name,
    communication: snapshot.communication,
    goals: snapshot.goals,
    setting: snapshot.setting,
  });
  assert.notEqual(snapshot.communication, demo.communication);
});

test("recorder startup supports legacy notes using the selected demo profile", () => {
  const profile = participants[1];
  const variables = recorderDynamicVariables({
    fields: { participant: profile.name },
  });
  assert.equal(variables.participant_name, profile.name);
  assert.deepEqual(JSON.parse(variables.participant_context), {
    name: profile.name,
    communication: profile.communication,
    goals: profile.goals,
    setting: profile.setting,
  });
});

test("scheduled recorder startup rejects a missing snapshot even when a demo name matches", () => {
  for (const participantSnapshot of [undefined, null]) {
    assert.throws(() =>
      recorderDynamicVariables({
        fields: { participant: participants[0].name },
        shiftId: "scheduled-without-snapshot",
        participantSnapshot,
      }),
    );
  }
});

test("sequential recorder sessions retain only their own participant context", () => {
  const firstNote = scheduledNote({
    ...structuredClone(participants[0]),
    communication: "First participant communication",
    goals: ["First participant goal"],
  });
  const secondNote = scheduledNote({
    ...structuredClone(participants[1]),
    communication: "Second participant communication",
    goals: ["Second participant goal"],
  });
  const first = recorderDynamicVariables(firstNote);
  const savedFirst = structuredClone(first);
  const second = recorderDynamicVariables(secondNote);
  assert.deepEqual(first, savedFirst);
  assert.equal(second.participant_name, secondNote.fields.participant);
  assert.deepEqual(JSON.parse(second.participant_context), {
    name: secondNote.fields.participant,
    communication: "Second participant communication",
    goals: ["Second participant goal"],
    setting: secondNote.participantSnapshot.setting,
  });
  assert.notEqual(first.participant_context, second.participant_context);
  assert.deepEqual(recorderDynamicVariables(firstNote), savedFirst);
});

test("Agent tool artifact uses vendor response waiting and excludes model-selected patient identities", async () => {
  const tools = JSON.parse(
    await readFile(
      new URL("../../config/agents/main/client-tools.json", import.meta.url),
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
