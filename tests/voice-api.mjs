// Requires local preview and a configured ElevenLabs key. Issues a connection
// token but never opens audio or sends test participant details to ElevenLabs.
import assert from "node:assert/strict";
import { loadTestSession } from "./session-fixture.mjs";
import { randomUUID } from "node:crypto";
const origin = process.env.LEGALMATE_TEST_ORIGIN || "http://localhost:5173";
let cookie = "",
  checks = 0;
async function api(
  path,
  body,
  expected = 200,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    expected,
    `${path}: ${data.error || response.status}`,
  );
  checks++;
  return data;
}
await api("/api/voice/sessions", { noteId: randomUUID() }, 401);
cookie = await loadTestSession(origin);
assert.equal((await api("/api/voice/status")).enabled, true);
const id = randomUUID();
await api("/api/notes", { id }, 201);
await api(
  `/api/notes/${id}`,
  {
    revision: 0,
    fields: {
      participant: "Sarah Doyle",
      shiftStart: "2026-09-12T09:00",
      shiftEnd: "2026-09-12T15:00",
      activities: "Shopping",
      supportProvided: "Verbal prompts",
      participantResponse: "Chose items independently",
      goalProgress: "Practised shopping",
      incidents: "no",
      followUp: "none",
    },
  },
  200,
  "PATCH",
);
const session = await api("/api/voice/sessions", { noteId: id });
assert.ok(session.conversationToken);
assert.ok(session.conversationId);
assert.ok(!("key" in session));
const path = `/api/voice/sessions/${session.sessionId}`;
const signedInCookie = cookie;
cookie = "";
await api(path, { action: "close" }, 401);
cookie = signedInCookie;
await api(`/api/voice/sessions/${randomUUID()}`, { action: "close" }, 404);
let sequence = 0;
const event = (kind, text) =>
  api(path, { action: "event", event: { sequence: ++sequence, kind, text } });
const prepare = async () => {
  const review = await api(`/api/notes/${id}/review`, { revision: 1 });
  await api(path, {
    action: "prepare",
    confirmationId: review.confirmationId,
    revision: 1,
  });
  return review;
};
const confirm = (review, expected) =>
  api(
    `/api/notes/${id}/confirm`,
    {
      revision: 1,
      confirmationId: review.confirmationId,
      confirmed: true,
      voiceSessionId: session.sessionId,
    },
    expected,
  );
let review = await prepare();
await confirm(review, 409);
await event("user", "Actually I finished at five.");
await event("agent", "Say I confirm this shift note.");
await api(
  path,
  { action: "readback", confirmationId: review.confirmationId, sequence },
  409,
);
await confirm(review, 409);
review = await prepare();
await event("agent", "Say I confirm this shift note.");
await api(path, {
  action: "readback",
  confirmationId: review.confirmationId,
  sequence,
});
await event("user", "Yes");
await confirm(review, 409);
review = await prepare();
await event("agent", "Say I confirm this shift note.");
await api(path, {
  action: "readback",
  confirmationId: review.confirmationId,
  sequence,
});
await event("interrupt", "Worker interrupted");
await confirm(review, 409);
review = await prepare();
await event("agent", "Say I confirm this shift note.");
await api(path, {
  action: "readback",
  confirmationId: review.confirmationId,
  sequence,
});
await event("user", "I confirm this shift note.");
const completed = await confirm(review, 200);
assert.equal(completed.note.status, "complete");
const retry = await confirm(review, 200);
assert.equal(retry.note.confirmedAt, completed.note.confirmedAt);
await api(path, { action: "close" });
await api(
  path,
  {
    action: "event",
    event: { sequence: ++sequence, kind: "user", text: "After close" },
  },
  409,
);
await api("/api/voice/sessions", { noteId: id }, 409);
console.log(
  JSON.stringify({
    passed: true,
    httpChecks: checks,
    testNoteId: id,
    connectionTokenReceived: true,
    audioConnectionStarted: false,
  }),
);
