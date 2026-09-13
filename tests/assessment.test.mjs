import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessmentTopics,
  assessmentOutputJsonSchema,
  AssessmentValidationError,
  validateAssessmentOutput,
} from "../lib/assessment.ts";
import { assessmentQuestions } from "../lib/assessment-questions.ts";
import {
  runAssessmentModel,
  AssessmentModelError,
  assessmentInputByteLimit,
  assessmentResponseByteLimit,
} from "../lib/assessment-model.ts";

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
const envelope = (output = routine()) => ({
  status: "completed",
  error: null,
  output: [
    { type: "reasoning", summary: [] },
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(output) }],
    },
  ],
});
const options = { apiKey: "test-key-not-a-real-credential" };
const modelError = (code) => (error) =>
  error instanceof AssessmentModelError && error.code === code;

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

test("adapter uses strict Responses output, low reasoning, bounded tokens and no stored conversation", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-5.6-terra");
    assert.equal(body.store, false);
    assert.equal(body.truncation, "disabled");
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.max_output_tokens, 8000);
    assert.deepEqual(body.tools, []);
    assert.equal(body.input.length, 1);
    assert.equal(body.input[0].role, "user");
    assert.equal(body.previous_response_id, undefined);
    return Response.json(envelope());
  });
  assert.equal(
    (await runAssessmentModel(input(), options)).action,
    "show_summary",
  );
  assert.equal(calls, 1);
});

test("missing setup, oversized UTF-8 input, invalid source IDs and pre-abort never call the provider", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("must not call provider");
  });
  await assert.rejects(
    runAssessmentModel(input(), { apiKey: " " }),
    modelError("setup_required"),
  );
  await assert.rejects(
    runAssessmentModel(
      input({ note: "界".repeat(assessmentInputByteLimit / 2) }),
      options,
    ),
    modelError("input_too_large"),
  );
  await assert.rejects(
    runAssessmentModel(input({ sources: [{ id: "", text: "test" }] }), options),
    modelError("invalid_input"),
  );
  await assert.rejects(
    runAssessmentModel(input({ sources: [] }), options),
    modelError("invalid_input"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runAssessmentModel(input(), { ...options, signal: controller.signal }),
    modelError("cancelled"),
  );
});

test("provider HTTP errors are safe and never include raw provider content", async (t) => {
  for (const [status, code] of [
    [401, "setup_required"],
    [403, "setup_required"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response("sensitive provider body", { status }),
    );
    await assert.rejects(
      runAssessmentModel(input(), options),
      (error) =>
        modelError(code)(error) && !error.message.includes("sensitive"),
    );
    mock.mock.restore();
  }
});

test("refusals, incomplete responses and malformed JSON never become ready assessments", async (t) => {
  const refusal = envelope();
  refusal.output[1].content = [
    { type: "refusal", refusal: "raw sensitive text" },
  ];
  for (const [body, code] of [
    [refusal, "refused"],
    [{ ...envelope(), status: "incomplete" }, "incomplete"],
    [{ ...envelope(), output: [] }, "invalid_output"],
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json(body),
    );
    await assert.rejects(
      runAssessmentModel(input(), options),
      modelError(code),
    );
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("invalid JSON"));
  await assert.rejects(
    runAssessmentModel(input(), options),
    modelError("invalid_output"),
  );
});

test("output size limits and failed evidence checks return sanitized invalid-output errors", async (t) => {
  const large = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("x".repeat(assessmentResponseByteLimit + 1)),
  );
  await assert.rejects(
    runAssessmentModel(input(), options),
    modelError("invalid_output"),
  );
  large.mock.restore();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      envelope(
        withConcern({
          concerns: [
            concern({
              evidence: [
                { sourceId: "made-up", quote: "private hallucination" },
              ],
            }),
          ],
        }),
      ),
    ),
  );
  await assert.rejects(
    runAssessmentModel(input(), options),
    (error) =>
      modelError("invalid_output")(error) &&
      !error.message.includes("private hallucination"),
  );
});

test("caller cancellation aborts the in-flight provider request without exposing provider errors", async (t) => {
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("private context")),
          { once: true },
        );
        controller.abort();
      }),
  );
  await assert.rejects(
    runAssessmentModel(input(), { ...options, signal: controller.signal }),
    modelError("cancelled"),
  );
});

test("the adapter timeout aborts provider work and remains a visible failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("provider timed out")),
          { once: true },
        );
      }),
  );
  const pending = runAssessmentModel(input(), options);
  t.mock.timers.tick(55_000);
  await assert.rejects(pending, modelError("timeout"));
});
