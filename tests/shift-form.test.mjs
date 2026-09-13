import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyFields,
  applyFieldPatch,
  checkForm,
  noteText,
} from "../lib/shift-form.ts";

const complete = () => ({
  ...emptyFields(),
  participant: "Alex (fictional)",
  shiftStart: "2026-09-12T14:00",
  shiftEnd: "2026-09-12T18:00",
  activities: "Shopping",
  supportProvided: "Verbal prompts at checkout",
  participantResponse: "Chose items independently",
  goalProgress: "Practised shopping",
  incidents: "no",
  followUp: "none",
});
test("silence is not treated as no incident or follow-up", () => {
  const fields = emptyFields();
  assert.equal(fields.incidents, "unanswered");
  assert.equal(checkForm(fields).ready, false);
  assert.ok(checkForm(fields).reviewReasons.length > 0);
});
test("correcting a status preserves disclosed details", () => {
  const previous = {
    ...complete(),
    incidents: "yes",
    incidentDetails: "Old statement",
    followUp: "needed",
    followUpDetails: "Old handover",
  };
  const corrected = applyFieldPatch(previous, {
    incidents: "no",
    followUp: "none",
  });
  assert.equal(corrected.incidentDetails, "Old statement");
  assert.equal(corrected.followUpDetails, "Old handover");
  assert.equal(corrected.activities, previous.activities);
});
test("yes requires detail, explicit unknown remains marked for review", () => {
  assert.equal(checkForm({ ...complete(), incidents: "yes" }).ready, false);
  const unknown = checkForm({ ...complete(), incidents: "unknown" });
  assert.equal(unknown.ready, true);
  assert.ok(unknown.reviewReasons.length > 0);
});
test("invalid dates and reversed times are rejected, overnight shifts work", () => {
  assert.equal(
    checkForm({ ...complete(), shiftStart: "2026-02-30T14:00" }).ready,
    false,
  );
  assert.equal(
    checkForm({ ...complete(), shiftEnd: "2026-09-12T13:00" }).ready,
    false,
  );
  assert.equal(
    checkForm({
      ...complete(),
      shiftStart: "2026-09-12T22:00",
      shiftEnd: "2026-09-13T06:00",
    }).ready,
    true,
  );
});
test("unknown fields, wrong types, and invalid choices cannot be persisted", () => {
  assert.throws(() =>
    applyFieldPatch(emptyFields(), { ownerId: "another-user" }),
  );
  assert.throws(() =>
    applyFieldPatch(emptyFields(), { incidents: "probably" }),
  );
  assert.throws(() => applyFieldPatch(emptyFields(), { activities: null }));
});

test("completed record export retains AI2 findings and uncertainties without inventing negative screens", () => {
  const assessment = {
    summary: "Transport did not arrive. Replacement pickup time is unknown.",
    risks: [
      {
        type: "service_exception",
        level: "P2",
        evidence: [
          { sourceId: "transcript:1", quote: "Transport did not arrive." },
        ],
      },
    ],
  };
  const text = noteText({
    fields: { ...complete(), incidents: "unanswered", followUp: "unanswered" },
    workerName: "Test worker",
    status: "complete",
    timezone: "Australia/Melbourne",
    confirmedAt: "2026-09-13T01:00:00Z",
    assessment,
  });
  assert.match(text, /P2: Service exception/);
  assert.match(text, /Evidence \(transcript:1\): Transport did not arrive/);
  assert.match(text, /Replacement pickup time is unknown/);
  assert.equal(text.includes("Coverage:"), false);
  assert.equal(text.includes("No incidents"), false);
  assert.match(text, /Activities\nShopping/);
});
