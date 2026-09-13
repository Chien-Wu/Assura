import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAssessmentAnswerDraft,
  sameAssessmentAnswerScope,
} from "../lib/assessment-answer-draft.ts";

const scope = {
  assessmentId: "assessment-1",
  questionId: "event_1:event.outcome",
};
const pending = {
  action: "answer",
  ...scope,
  revision: 2,
  answer: "I do not know.",
  requestId: "saved-answer-1",
};

test("a typed draft restores only to the same assessment and question", () => {
  const draft = parseAssessmentAnswerDraft(
    JSON.stringify({ text: "An unsent answer", ...scope, pending: null }),
  );
  assert.equal(draft.text, "An unsent answer");
  assert.equal(sameAssessmentAnswerScope(draft, scope), true);
  assert.equal(
    sameAssessmentAnswerScope(draft, {
      ...scope,
      questionId: "event_1:event.actions",
    }),
    false,
  );
  assert.equal(
    sameAssessmentAnswerScope(draft, {
      ...scope,
      assessmentId: "restarted-assessment",
    }),
    false,
  );
  assert.equal(sameAssessmentAnswerScope(draft, null), false);
});

test("legacy unscoped text remains available as a detached copy", () => {
  const draft = parseAssessmentAnswerDraft(
    JSON.stringify({ answer: "Answer to an old question", pending: null }),
  );
  assert.equal(draft.text, "Answer to an old question");
  assert.equal(draft.assessmentId, null);
  assert.equal(draft.questionId, null);
  assert.equal(sameAssessmentAnswerScope(draft, scope), false);
});

test("saved retries preserve their original question, text and idempotency key", () => {
  const draft = parseAssessmentAnswerDraft(
    JSON.stringify({ answer: "new unsaved display text", pending }),
  );
  assert.deepEqual(draft.pending, pending);
  assert.equal(draft.text, pending.answer);
  assert.equal(draft.assessmentId, pending.assessmentId);
  assert.equal(draft.questionId, pending.questionId);
  assert.equal(sameAssessmentAnswerScope(draft, scope), true);
  assert.equal(
    sameAssessmentAnswerScope(draft, {
      ...scope,
      questionId: "screen.medication",
    }),
    false,
  );
});

test("outer scope metadata cannot rebind an already pending saved answer", () => {
  const draft = parseAssessmentAnswerDraft(
    JSON.stringify({
      text: "Different text",
      assessmentId: "new-assessment",
      questionId: "new-question",
      pending,
    }),
  );
  assert.equal(draft.text, "I do not know.");
  assert.equal(sameAssessmentAnswerScope(draft, scope), true);
  assert.equal(
    sameAssessmentAnswerScope(draft, {
      assessmentId: "new-assessment",
      questionId: "new-question",
    }),
    false,
  );
});

test("corrupt local storage does not create a retry request", () => {
  for (const value of ["not json", "null", "[]", "{}"])
    assert.equal(parseAssessmentAnswerDraft(value), null);
  const draft = parseAssessmentAnswerDraft(
    JSON.stringify({
      text: "Keep this draft",
      pending: { ...pending, requestId: {}, revision: -1 },
    }),
  );
  assert.equal(draft.pending, null);
  assert.equal(draft.text, "Keep this draft");
  assert.equal(sameAssessmentAnswerScope(draft, scope), false);
});
