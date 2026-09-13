import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyVoiceState,
  appendVoiceEvent,
  isVoiceConfirmation,
} from "../lib/voice-state.ts";

const prepared = (readbackSequence = null) => ({
  ...emptyVoiceState(),
  review: {
    confirmationId: "current",
    revision: 2,
    afterSequence: 0,
    readbackSequence,
  },
});
const add = (state, kind, text) =>
  appendVoiceEvent(state, { sequence: state.events.length + 1, kind, text });

test("early user statements invalidate a saved legacy review", () => {
  for (const text of [
    "Actually I finished at five",
    "I confirm this shift note.",
  ])
    assert.equal(add(prepared(), "user", text).review, null);
  assert.equal(
    isVoiceConfirmation("I confirm this shift note, but change the time"),
    false,
  );
});

test("corrections and interruptions invalidate legacy review state without losing events", () => {
  const state = add(prepared(1), "agent", "Saved historical readback");
  const confirmed = add(state, "user", "I confirm this shift note.");
  assert.deepEqual(confirmed.review, state.review);
  for (const [kind, text] of [
    ["interrupt", "Interrupted"],
    ["user", "Actually the shift ended later"],
  ]) {
    const next = add(confirmed, kind, text);
    assert.equal(next.review, null);
    assert.equal(next.events.length, confirmed.events.length + 1);
  }
});

test("transcript retries are idempotent while conflicting, missing and closed events are rejected", () => {
  const event = { sequence: 1, kind: "user", text: "Hello" };
  const state = appendVoiceEvent(emptyVoiceState(), event);
  assert.equal(appendVoiceEvent(state, event), state);
  assert.throws(() => appendVoiceEvent(state, { ...event, text: "Different" }));
  assert.throws(() => appendVoiceEvent(state, { ...event, sequence: 3 }));
  assert.throws(() => appendVoiceEvent(state, undefined));
  assert.throws(() => appendVoiceEvent({ ...state, closed: true }, event));
});
