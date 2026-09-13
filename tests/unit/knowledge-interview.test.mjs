import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanQuestionInput,
  cleanQuestionUpdates,
  normalizeQuestion,
} from "../../src/lib/knowledge/interview.ts";

const input = {
  retrievalId: "retrieval-1",
  sourceIds: ["note-1@2"],
  purposeKey: "craft_group_sep12",
  question: "Did Sarah receive the craft group's session details?",
};
test("question registration requires bounded returned references and one reviewable question", () => {
  assert.equal(cleanQuestionInput(input).question, input.question);
  for (const bad of [
    { sourceIds: [] },
    { sourceIds: ["note-1@2", "note-1@2"] },
    { sourceIds: Array.from({ length: 5 }, (_, i) => `note-${i}@1`) },
    { question: "Is it?" },
    { question: "Did Sarah receive details? Did she go?" },
    { question: "All good" },
    { question: "...........?" },
    { question: "1234 5678 90?" },
    { question: "x".repeat(701) + "?" },
    { purposeKey: "../../patient" },
    { retrievalId: null },
  ])
    assert.throws(() => cleanQuestionInput({ ...input, ...bad }));
});
test("emission matching tolerates speech punctuation but preserves words", () => {
  const registered = normalizeQuestion(input.question);
  assert.ok(
    normalizeQuestion(
      "Previously recorded: DID SARAH RECEIVE THE CRAFT GROUP’S SESSION DETAILS?",
    ).includes(registered),
  );
  assert.ok(
    !normalizeQuestion("Sarah has received the craft details.").includes(
      registered,
    ),
  );
});
test("answer updates require actual quote metadata and never become current note fields", () => {
  assert.deepEqual(cleanQuestionUpdates(undefined), []);
  assert.deepEqual(
    cleanQuestionUpdates([
      { questionId: "q1", state: "unknown", quote: "  I don't know.  " },
    ]),
    [{ questionId: "q1", state: "unknown", quote: "I don't know." }],
  );
  for (const bad of [
    {},
    [{ questionId: "q1", state: "complete", quote: "Yes." }],
    [{ questionId: "q1", state: "answered", quote: "" }],
    [{ questionId: "q1", state: "answered", quote: "a".repeat(2001) }],
    [
      { questionId: "q1", state: "answered", quote: "Yes." },
      { questionId: "q1", state: "unknown", quote: "Unsure." },
    ],
  ])
    assert.throws(() => cleanQuestionUpdates(bad));
});
