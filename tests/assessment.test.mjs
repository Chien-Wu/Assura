import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessmentTopics,
  assessmentOutputJsonSchema,
  AssessmentValidationError,
  validateAssessmentOutput,
} from "../lib/assessment.ts";
import { assessmentQuestions } from "../lib/assessment-questions.ts";

const evidence = {
  sourceId: "worker:1",
  quote: "The support arrived late. I do not know the final outcome.",
};
const input = (patch = {}) => ({
  note: { fields: { activities: "Community access" } },
  profile: { risks: ["Historical choking risk"] },
  history: [],
  sources: [{ id: evidence.sourceId, text: evidence.quote }],
  messages: [],
  previous: null,
  ...patch,
});
const routine = (patch = {}) => ({
  action: "show_summary",
  introduction: null,
  nextQuestion: null,
  concerns: [],
  screening: assessmentTopics.map((topic) => ({
    topic,
    state: "not_discussed",
    evidence: [],
  })),
  summary:
    "The worker's shift account is ready for review. Undiscussed topics remain open.",
  missingInformation: [],
  contradictions: [],
  urgentAttention: false,
  urgentMessage: null,
  ...patch,
});
const concern = (patch = {}) => ({
  id: "event_1",
  areas: ["service_exception"],
  title: "Late support",
  whatHappened:
    "The worker reported late support and did not know the final outcome.",
  resolution: "unknown",
  howResolved: null,
  priority: "P2",
  evidence: [evidence],
  missingInformation: ["The worker does not know the final outcome."],
  nextShiftWatchFor: null,
  ...patch,
});
const withConcern = (patch = {}) =>
  routine({
    concerns: [concern()],
    screening: assessmentTopics.map((topic) => ({
      topic,
      state: topic === "service_exception" ? "concern" : "not_discussed",
      evidence: topic === "service_exception" ? [evidence] : [],
    })),
    ...patch,
  });
const ask = () =>
  withConcern({
    action: "ask_question",
    nextQuestion: {
      id: "event_1:event.outcome",
      text: assessmentQuestions["event.outcome"],
    },
    summary: "",
  });
test("coverage can remain undiscussed at summary without six mandatory negative answers", () => {
  assert.equal(
    validateAssessmentOutput(routine(), input()).action,
    "show_summary",
  );
});

test("an unknown outcome can finish with the uncertainty retained", () => {
  const result = validateAssessmentOutput(withConcern(), input());
  assert.equal(result.concerns[0].resolution, "unknown");
  assert.equal(result.concerns[0].priority, "P2");
  assert.equal(result.action, "show_summary");
});

test("strict schema rejects invented fields, wrong enums and omitted nullable fields", () => {
  for (const result of [
    routine({ officialReportable: true }),
    routine({ action: "done" }),
    routine({ nextQuestion: undefined }),
  ])
    assert.throws(
      () => validateAssessmentOutput(result, input()),
      AssessmentValidationError,
    );
  assert.equal(assessmentOutputJsonSchema.additionalProperties, false);
  assert.ok(assessmentOutputJsonSchema.required.includes("nextQuestion"));
});

test("coverage contains all six unique topics and requires evidence for a negative", () => {
  const repeated = routine();
  repeated.screening[5] = repeated.screening[0];
  assert.throws(
    () => validateAssessmentOutput(repeated, input()),
    AssessmentValidationError,
  );
  const negative = routine();
  negative.screening[0].state = "explicit_no";
  assert.throws(
    () => validateAssessmentOutput(negative, input()),
    AssessmentValidationError,
  );
  const denied = input({
    sources: [{ id: "worker:2", text: "There were no injuries." }],
  });
  negative.screening[0].evidence = [
    { sourceId: "worker:2", quote: "There were no injuries." },
  ];
  assert.equal(
    validateAssessmentOutput(negative, denied).screening[0].state,
    "explicit_no",
  );
});

test("unknown and not-applicable coverage need current evidence and are not converted to No", () => {
  for (const state of ["unknown", "not_applicable"]) {
    const output = routine();
    output.screening[5] = {
      topic: "service_exception",
      state,
      evidence: [evidence],
    };
    assert.equal(
      validateAssessmentOutput(output, input()).screening[5].state,
      state,
    );
    output.screening[5].evidence = [];
    assert.throws(
      () => validateAssessmentOutput(output, input()),
      AssessmentValidationError,
    );
  }
});

test("citations reject nonexistent IDs, paraphrases, history-only quotes and blank quotes", () => {
  for (const citation of [
    { sourceId: "nonexistent", quote: evidence.quote },
    { sourceId: evidence.sourceId, quote: "Support arrived very late." },
    { sourceId: "history:1", quote: "Historical choking risk" },
    { sourceId: evidence.sourceId, quote: " " },
  ]) {
    const output = withConcern({
      concerns: [concern({ evidence: [citation] })],
    });
    assert.throws(
      () => validateAssessmentOutput(output, input()),
      AssessmentValidationError,
    );
  }
  assert.throws(
    () =>
      validateAssessmentOutput(
        withConcern(),
        input({
          sources: [
            { id: "worker:1", text: evidence.quote },
            { id: "worker:1", text: "different" },
          ],
        }),
      ),
    AssessmentValidationError,
  );
});

test("one event can have several record areas with consistent screening", () => {
  const output = withConcern({
    concerns: [concern({ areas: ["service_exception", "complaint"] })],
  });
  output.screening[4] = {
    topic: "complaint",
    state: "concern",
    evidence: [evidence],
  };
  assert.equal(validateAssessmentOutput(output, input()).concerns.length, 1);
  output.screening[4] = {
    topic: "complaint",
    state: "not_discussed",
    evidence: [],
  };
  assert.throws(
    () => validateAssessmentOutput(output, input()),
    AssessmentValidationError,
  );
});

test("previously raised events cannot disappear and distinct events need unique IDs", () => {
  assert.throws(
    () =>
      validateAssessmentOutput(routine(), input({ previous: withConcern() })),
    AssessmentValidationError,
  );
  assert.throws(
    () =>
      validateAssessmentOutput(
        withConcern({ concerns: [concern(), concern()] }),
        input(),
      ),
    AssessmentValidationError,
  );
});

test("the next question must be one exact bank entry tied to an existing event", () => {
  assert.equal(validateAssessmentOutput(ask(), input()).action, "ask_question");
  for (const nextQuestion of [
    null,
    { id: "event_9:event.outcome", text: assessmentQuestions["event.outcome"] },
    {
      id: "event_1:event.outcome",
      text: "Tell me everything? Was anyone hurt?",
    },
  ])
    assert.throws(
      () => validateAssessmentOutput({ ...ask(), nextQuestion }, input()),
      AssessmentValidationError,
    );
  assert.throws(
    () =>
      validateAssessmentOutput(
        { ...ask(), introduction: "Was anyone hurt?" },
        input(),
      ),
    AssessmentValidationError,
  );
  for (const question of Object.values(assessmentQuestions))
    assert.equal((question.match(/\?/g) || []).length, 1);
});

test("answered question IDs cannot repeat, including unknown and declined answers", () => {
  for (const answer of [
    "No",
    "Unsure",
    "I do not know",
    "I prefer not to answer",
  ]) {
    const messages = [
      {
        id: "answer-1",
        role: "user",
        text: answer,
        questionId: "event_1:event.outcome",
        createdAt: "2026-09-13T00:00:00Z",
      },
    ];
    assert.throws(
      () => validateAssessmentOutput(ask(), input({ messages })),
      AssessmentValidationError,
    );
    assert.equal(
      validateAssessmentOutput(withConcern(), input({ messages })).action,
      "show_summary",
    );
  }
});

test("summary and question actions cannot carry incompatible nextQuestion values", () => {
  assert.throws(
    () =>
      validateAssessmentOutput(
        routine({ nextQuestion: ask().nextQuestion }),
        input(),
      ),
    AssessmentValidationError,
  );
  assert.throws(
    () => validateAssessmentOutput(routine({ summary: "  " }), input()),
    AssessmentValidationError,
  );
});

test("priority increases from P0 to P4 and remains independent of resolution", () => {
  for (const priority of ["P0", "P1", "P2"])
    assert.equal(
      validateAssessmentOutput(
        withConcern({ concerns: [concern({ priority })] }),
        input(),
      ).urgentAttention,
      false,
    );
  for (const priority of ["P3", "P4"]) {
    const output = withConcern({
      concerns: [
        concern({
          priority,
          resolution: "resolved",
          howResolved: "The worker reported the immediate problem ended.",
        }),
      ],
    });
    assert.throws(
      () => validateAssessmentOutput(output, input()),
      AssessmentValidationError,
    );
    output.urgentAttention = true;
    output.urgentMessage = "Seek urgent responsible-person review.";
    assert.equal(
      validateAssessmentOutput(output, input()).concerns[0].resolution,
      "resolved",
    );
  }
  assert.throws(
    () =>
      validateAssessmentOutput(
        withConcern({ concerns: [concern({ resolution: "resolved" })] }),
        input(),
      ),
    AssessmentValidationError,
  );
  assert.throws(
    () =>
      validateAssessmentOutput(
        withConcern({ concerns: [concern({ missingInformation: [] })] }),
        input(),
      ),
    AssessmentValidationError,
  );
});
