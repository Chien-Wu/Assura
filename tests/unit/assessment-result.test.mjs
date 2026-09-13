import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  riskTypes,
  riskLevelLabels,
  riskResultJsonSchema,
  RiskValidationError,
  validateRiskResult,
  normalizeRiskResult,
  overallRiskLevel,
} from "../../src/lib/assessment/result.ts";
import { riskAssessmentSystemPrompt } from "../../src/lib/assessment/prompt.ts";
import {
  runRiskAssessmentModel,
  RiskAssessmentModelError,
  riskAssessmentInputByteLimit,
  riskAssessmentResponseByteLimit,
} from "../../src/lib/assessment/model.ts";

const evidence = { sourceId: "transcript:1", quote: "Support arrived late." };
const input = (patch = {}) => ({
  note: { fields: { activities: "Community access" } },
  sources: [
    {
      id: evidence.sourceId,
      text: `${evidence.quote} The outcome is unknown.`,
    },
  ],
  ...patch,
});
const routine = (patch = {}) => ({
  risks: [],
  summary: "No concern was identified in the supplied account.",
  ...patch,
});
const risk = (patch = {}) => ({
  type: "service_exception",
  level: "P2",
  evidence: [evidence],
  ...patch,
});
const concerned = (patch = {}) =>
  routine({
    risks: [risk()],
    summary: "Late support was reported. The outcome is unknown.",
    ...patch,
  });
const options = { apiKey: "test-key-not-a-real-credential" };
const modelError = (code) => (error) =>
  error instanceof RiskAssessmentModelError && error.code === code;
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
const legacyTopics = [
  "incident_safeguarding",
  "health_wellbeing",
  "medication",
  "behaviour_restriction",
  "complaint",
  "service_exception",
];
const legacyConcern = (patch = {}) => ({
  id: "event_1",
  areas: ["service_exception"],
  title: "Late support",
  whatHappened: evidence.quote,
  resolution: "unknown",
  howResolved: null,
  priority: "P2",
  evidence: [evidence],
  missingInformation: ["Outcome unknown"],
  nextShiftWatchFor: null,
  ...patch,
});
const legacy = (patch = {}) => ({
  action: "show_summary",
  introduction: null,
  nextQuestion: null,
  concerns: [],
  screening: legacyTopics.map((topic) => ({
    topic,
    state: "not_discussed",
    evidence: [],
  })),
  summary: "The supplied shift account has been reviewed.",
  missingInformation: [],
  contradictions: [],
  urgentAttention: false,
  urgentMessage: null,
  ...patch,
});

test("an empty successful check is P0 and urgency increases from P1 to P4", () => {
  assert.equal(overallRiskLevel(validateRiskResult(routine(), input())), "P0");
  for (const level of ["P1", "P2", "P3", "P4"]) {
    assert.equal(
      overallRiskLevel(
        validateRiskResult(concerned({ risks: [risk({ level })] }), input()),
      ),
      level,
    );
  }
  assert.equal(
    overallRiskLevel(
      concerned({
        risks: [
          risk({ type: "complaint", level: "P4" }),
          risk({ level: "P1" }),
        ],
      }),
    ),
    "P4",
  );
  assert.deepEqual(Object.keys(riskLevelLabels), [
    "P0",
    "P1",
    "P2",
    "P3",
    "P4",
  ]);
});

test("results contain only five unique types, no P0 entries, and required evidence", () => {
  assert.equal(
    validateRiskResult(
      concerned({ risks: riskTypes.map((type) => risk({ type })) }),
      input(),
    ).risks.length,
    5,
  );
  for (const risks of [
    [risk(), risk()],
    [risk({ level: "P0" })],
    [risk({ type: "made_up" })],
    [risk({ evidence: [] })],
  ]) {
    assert.throws(
      () => validateRiskResult(concerned({ risks }), input()),
      RiskValidationError,
    );
  }
});

test("risk evidence must quote an exact contiguous substring of the named supplied source", () => {
  assert.deepEqual(validateRiskResult(concerned(), input()), concerned());
  for (const item of [
    { ...evidence, sourceId: "invented" },
    { ...evidence, quote: "support arrived late." },
    { ...evidence, quote: "Support ... late." },
    { ...evidence, quote: " " },
  ])
    assert.throws(
      () =>
        validateRiskResult(
          concerned({ risks: [risk({ evidence: [item] })] }),
          input(),
        ),
      RiskValidationError,
    );
  assert.throws(
    () =>
      validateRiskResult(
        concerned(),
        input({
          sources: [
            { id: evidence.sourceId, text: evidence.quote },
            { id: evidence.sourceId, text: evidence.quote },
          ],
        }),
      ),
    RiskValidationError,
  );
});

test("unknowns can stay declarative while follow-up questions and interview fields are rejected", () => {
  assert.equal(
    validateRiskResult(concerned(), input()).summary,
    concerned().summary,
  );
  for (const output of [
    routine({ nextQuestion: null }),
    routine({ action: "show_summary" }),
    routine({ summary: "What was the outcome?" }),
    routine({ summary: "What happened？" }),
    routine({ summary: "Ask the worker about the outcome." }),
    routine({ summary: "Please clarify whether the participant is safe." }),
    routine({ summary: " " }),
    routine({ summary: "x".repeat(1001) }),
  ])
    assert.throws(
      () => validateRiskResult(output, input()),
      RiskValidationError,
    );
  assert.equal(riskResultJsonSchema.additionalProperties, false);
  assert.deepEqual(riskResultJsonSchema.required, ["risks", "summary"]);
});

test("legacy normalization groups categories at their maximum priority and preserves all evidence", () => {
  const other = {
    sourceId: "transcript:2",
    quote: "A second event was reported.",
  };
  const original = legacy({
    concerns: [
      legacyConcern({
        areas: ["incident_injury", "incident_near_miss", "health_wellbeing"],
        priority: "P1",
      }),
      legacyConcern({
        id: "event_2",
        areas: ["safeguarding", "missing_person", "medication"],
        priority: "P4",
        evidence: [evidence, other],
      }),
      legacyConcern({
        id: "event_3",
        areas: [
          "behaviour",
          "restrictive_practice",
          "complaint",
          "service_exception",
        ],
        priority: "P2",
      }),
    ],
    urgentAttention: true,
    urgentMessage: "Seek immediate review.",
  });
  const before = JSON.stringify(original);
  const result = normalizeRiskResult(original);
  assert.deepEqual(
    result.risks.map(({ type, level }) => [type, level]),
    [
      ["incident_safeguarding", "P4"],
      ["health_medication", "P4"],
      ["behaviour_restrictive_practice", "P2"],
      ["complaint", "P2"],
      ["service_exception", "P2"],
    ],
  );
  assert.deepEqual(result.risks[0].evidence, [evidence, other]);
  assert.equal(result.summary, original.summary);
  assert.equal(JSON.stringify(original), before);
});

test("legacy normalization preserves long original summaries and merged evidence on repeated reads", () => {
  const original = legacy({
    summary: "A supported historical summary. ".repeat(80),
    concerns: [
      legacyConcern({
        evidence: Array.from({ length: 10 }, (_, index) => ({
          sourceId: `source:${index}`,
          quote: `Saved quote ${index}.`,
        })),
      }),
    ],
  });
  const result = normalizeRiskResult(original);
  assert.equal(result.summary, original.summary);
  assert.equal(result.risks[0].evidence.length, 10);
  assert.deepEqual(normalizeRiskResult(result), result);
});

test("malformed, failed or unfinished historical data never normalizes to routine", () => {
  for (const value of [
    null,
    {},
    { status: "failed", result: null },
    { concerns: [], summary: "Looks routine" },
    legacy({
      action: "ask_question",
      nextQuestion: { id: "question", text: "What happened?" },
    }),
    legacy({ urgentAttention: true }),
    legacy({
      screening: legacyTopics.map((topic) => ({
        topic,
        state: "concern",
        evidence: [evidence],
      })),
    }),
    legacy({
      screening: legacyTopics.map(() => ({
        topic: "complaint",
        state: "unknown",
        evidence: [],
      })),
    }),
    legacy({ concerns: [legacyConcern({ areas: ["invented"] })] }),
    concerned({
      risks: [risk({ evidence: [{ sourceId: " ", quote: "some text" }] })],
    }),
    concerned({ risks: [risk(), risk()] }),
  ])
    assert.equal(normalizeRiskResult(value), null);
  assert.equal(overallRiskLevel(normalizeRiskResult(legacy())), "P0");
  assert.equal(
    overallRiskLevel(
      normalizeRiskResult(
        legacy({ concerns: [legacyConcern({ priority: "P0" })] }),
      ),
    ),
    "P0",
  );
});

test("the adapter sends only note and sources with strict short output and no history or tools", async (t) => {
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
    assert.equal(body.max_output_tokens, 2200);
    assert.deepEqual(body.tools, []);
    assert.equal(body.input.length, 1);
    assert.equal(body.previous_response_id, undefined);
    const sent = JSON.parse(body.input[0].content[0].text);
    assert.deepEqual(sent, input());
    return Response.json(envelope(concerned()));
  });
  assert.deepEqual(
    await runRiskAssessmentModel(
      input({
        profile: { secret: "profile" },
        history: ["history"],
        messages: ["interview"],
        previous: legacy(),
        sources: [{ ...input().sources[0], extra: "excluded" }],
      }),
      options,
    ),
    concerned(),
  );
  assert.equal(calls, 1);
});

test("missing configuration, invalid sources, oversized input and pre-cancellation never call the provider", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("provider must not be called"),
  );
  await assert.rejects(
    runRiskAssessmentModel(input(), { apiKey: " " }),
    modelError("setup_required"),
  );
  await assert.rejects(
    runRiskAssessmentModel(input(), { ...options, model: "unsafe model\n" }),
    modelError("setup_required"),
  );
  await assert.rejects(
    runRiskAssessmentModel(
      input({ note: "界".repeat(riskAssessmentInputByteLimit / 2) }),
      options,
    ),
    modelError("input_too_large"),
  );
  for (const sources of [
    [],
    [{ id: "", text: "text" }],
    [{ id: "source", text: 123 }],
    [input().sources[0], input().sources[0]],
  ])
    await assert.rejects(
      runRiskAssessmentModel(input({ sources }), options),
      modelError("invalid_input"),
    );
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(
    runRiskAssessmentModel(input({ note: cyclic }), options),
    modelError("invalid_input"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runRiskAssessmentModel(input(), { ...options, signal: controller.signal }),
    modelError("cancelled"),
  );
});

test("HTTP failures expose only a safe error code and never provider content", async (t) => {
  for (const [status, code] of [
    [401, "setup_required"],
    [403, "setup_required"],
    [429, "rate_limited"],
    [500, "provider_error"],
  ]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response("sensitive provider context", { status }),
    );
    await assert.rejects(
      runRiskAssessmentModel(input(), options),
      (error) =>
        modelError(code)(error) && !error.message.includes("sensitive"),
    );
    mock.mock.restore();
  }
});

test("refusal, truncation, unexpected tool calls, malformed output and invented evidence fail visibly", async (t) => {
  const refusal = envelope();
  refusal.output[1].content = [
    { type: "refusal", refusal: "sensitive content" },
  ];
  const toolCall = envelope();
  toolCall.output.push({ type: "function_call", name: "interview" });
  for (const [body, code] of [
    [refusal, "refused"],
    [{ ...envelope(), status: "incomplete" }, "incomplete"],
    [toolCall, "invalid_output"],
    [{ ...envelope(), output: [] }, "invalid_output"],
    [
      envelope(
        concerned({
          risks: [
            risk({
              evidence: [
                { sourceId: "invented", quote: "sensitive fabrication" },
              ],
            }),
          ],
        }),
      ),
      "invalid_output",
    ],
    [
      envelope(routine({ summary: "Can you explain what happened?" })),
      "invalid_output",
    ],
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json(body),
    );
    await assert.rejects(
      runRiskAssessmentModel(input(), options),
      (error) =>
        modelError(code)(error) && !error.message.includes("sensitive"),
    );
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));
  await assert.rejects(
    runRiskAssessmentModel(input(), options),
    modelError("invalid_output"),
  );
});

test("oversized provider responses are rejected by byte count and content length", async (t) => {
  for (const response of [
    new Response("x".repeat(riskAssessmentResponseByteLimit + 1)),
    new Response("{}", {
      headers: {
        "content-length": String(riskAssessmentResponseByteLimit + 1),
      },
    }),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      runRiskAssessmentModel(input(), options),
      modelError("invalid_output"),
    );
    mock.mock.restore();
  }
});

test("caller cancellation aborts an in-flight check and cannot return a routine result", async (t) => {
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("sensitive context")),
          { once: true },
        );
        controller.abort();
      }),
  );
  await assert.rejects(
    runRiskAssessmentModel(input(), { ...options, signal: controller.signal }),
    modelError("cancelled"),
  );
});

test("the short adapter timeout aborts provider work with a retryable failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("timed out")),
          { once: true },
        );
      }),
  );
  const pending = runRiskAssessmentModel(input(), options);
  t.mock.timers.tick(35_000);
  await assert.rejects(pending, modelError("timeout"));
});

test("the reviewable prompt matches the silent runtime prompt and ascending user priorities", async () => {
  const document = await readFile(
    new URL("../../config/agents/ai2/system-prompt.txt", import.meta.url),
    "utf8",
  );
  assert.equal(document, riskAssessmentSystemPrompt);
  for (const expression of [
    /NEVER INTERVIEW/,
    /Never ask a question/,
    /P0 Routine/,
    /P4 Critical/,
    /untrusted data/,
    /1–3 short declarative sentences/,
    /at most one entry per type/,
  ])
    assert.match(document, expression);
});
