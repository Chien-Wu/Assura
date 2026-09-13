// Historical recorder protocol; see tests/legacy/README.md.
if (process.env.LEGALMATE_TEST_LEGACY_PROTOCOL !== "1")
  throw new Error(
    "Retired protocol: see tests/legacy/README.md before opting in.",
  );

import assert from "node:assert/strict";
import {
  loadAssignedTestShift,
  loadTestSession,
} from "../support/session-fixture.mjs";
import { randomUUID } from "node:crypto";
const origin = process.env.LEGALMATE_TEST_ORIGIN || "http://localhost:5173";
let cookie = "",
  providerId,
  checks = 0;
async function api(
  path,
  body,
  expected = 200,
  method = body === undefined ? "GET" : "POST",
) {
  if (providerId && path.startsWith("/api/management"))
    path += `${path.includes("?") ? "&" : "?"}providerId=${encodeURIComponent(providerId)}`;
  const r = await fetch(origin + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(d)}`);
  checks++;
  return d;
}
await api("/api/management", undefined, 401);
const testSession = await loadTestSession(origin, {
  manager: true,
  withProfile: true,
});
cookie = testSession.cookie;
providerId = testSession.profile.providerId;
const shift = await loadAssignedTestShift(origin, cookie, {
  environment: "LEGALMATE_TEST_SAFETY_SHIFT_ID",
  participantName: "Minh Pham",
});
const id = randomUUID();
await api("/api/notes", { id, shiftId: shift.id }, 201);
await api(
  `/api/notes/${id}`,
  {
    revision: 0,
    fields: {
      participant: "Minh Pham",
      shiftStart: "2026-09-12T09:00",
      shiftEnd: "2026-09-12T13:00",
    },
  },
  200,
  "PATCH",
);
const session = await api("/api/voice/sessions", { noteId: id, mode: "text" });
const path = `/api/voice/sessions/${session.sessionId}`;
let seq = 0;
const event = (kind, text) =>
  api(path, { action: "event", event: { sequence: ++seq, kind, text } });
const raw =
  'Minh coughed during lunch at 12:15 for 30 seconds. I locked the kitchen door from 12:20 to 12:30. He said "I want more food".';
const captured = await event("user", raw);
assert.ok(captured.riskFlags.some((f) => f.category === "environmental"));
assert.ok(captured.escalation.status === "in_app_inbox");
assert.equal(captured.note.revision, 1);
await event("agent", "How long did he cough? Could he speak?");
assert.equal((await api(`/api/notes/${id}`)).remainingClarifications, 1);
const disputed = await event("user", "I disagree. It was not an incident.");
assert.ok(disputed.riskFlags.some((f) => f.code === "WORKER_DISAGREEMENT"));
assert.ok(disputed.riskFlags.some((f) => f.category === "environmental"));
let update = await api(
  `/api/notes/${id}`,
  {
    revision: 1,
    voiceSessionId: session.sessionId,
    fields: {
      activities: "Lunch",
      supportProvided: "Prompted Minh to sit upright",
      participantResponse: 'He said "I want more food".',
      goalProgress: "Meal preparation goal discussed",
      incidents: "no",
      followUp: "none",
      incidentDetails: raw,
    },
  },
  200,
  "PATCH",
);
assert.equal(update.note.fields.incidents, "unknown");
assert.equal(update.note.fields.followUp, "unknown");
assert.equal(update.note.safety.fieldStates.incidents, "not_reviewed");
assert.ok(update.warnings.length >= 2);
assert.ok(update.note.riskFlags.some((f) => f.category === "environmental"));
const review = await api(`/api/notes/${id}/review`, { revision: 2 });
assert.ok(review.summary.includes("Not yet reviewed"));
const firstAudit = await api(`/api/notes/${id}/audit`);
assert.equal(firstAudit.transcript[0].content, raw);
assert.equal(firstAudit.draftV0.revision, 2);
assert.ok(firstAudit.changes.length > 0);
update = await api(
  `/api/notes/${id}`,
  { revision: 2, fields: { incidentDetails: "No concerns." } },
  200,
  "PATCH",
);
assert.ok(update.note.riskFlags.some((f) => f.code === "RISK_CONTENT_REMOVED"));
await api(`/api/notes/${id}/review`, { revision: 3 });
const secondAudit = await api(`/api/notes/${id}/audit`);
assert.deepEqual(secondAudit.draftV0, firstAudit.draftV0);
assert.equal(secondAudit.transcript[0].content, raw);
const board = await api("/api/management?month=2026-09");
const incident = board.incidents.find(
  (i) => i.noteId === id && i.category === "environmental",
);
assert.ok(incident);
assert.equal(incident.providerBecameAwareAt, null);
assert.equal(incident.notificationStatus, "in_app_only");
await api(
  `/api/management/${encodeURIComponent(incident.id)}`,
  { providerBecameAwareAt: "2026-09-11T01:00:00Z" },
  400,
);
await api(`/api/management/${encodeURIComponent(incident.id)}`, {
  eventAt: "2026-09-11T00:00:00Z",
  providerBecameAwareAt: "2026-09-11T01:00:00Z",
  awarenessSource: "Fictional worker phone call test",
  comment: "Test review entry",
});
await api(`/api/management/${encodeURIComponent(incident.id)}`, {
  providerBecameAwareAt: "2026-09-11T02:00:00Z",
  awarenessSource: "Later fictional test review",
});
const after = (await api("/api/management")).incidents.find(
  (i) => i.id === incident.id,
);
assert.equal(after.providerBecameAwareAt, "2026-09-11T01:00:00.000Z");
assert.equal(after.eventToAwarenessMinutes, 60);
assert.equal(after.history.length, 2);
await api("/api/management?month=2026-99", undefined, 400);
await api("/api/management/not-owned", { comment: "test" }, 404);
await api(path, { action: "close" });
console.log(
  JSON.stringify({
    passed: true,
    httpChecks: checks,
    testNoteId: id,
    safetyChecks: [
      "capture-before-extraction",
      "negative-evidence",
      "question-budget",
      "snapshot-immutable",
      "edit-risk",
      "manager-timeline",
      "earliest-awareness",
      "owner-scope",
    ],
  }),
);
