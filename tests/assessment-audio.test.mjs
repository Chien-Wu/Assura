import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AssessmentAudioError,
  assessmentAudioByteLimit,
  assessmentAudioBodyByteLimit,
  assessmentAudioDurationMs,
  normaliseAssessmentAudioMimeType,
  readAssessmentAudioRequest,
  requireCurrentAudioQuestion,
  transcribeAssessmentAudio,
} from "../lib/assessment-audio.ts";

const webm = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const payload = (patch = {}) => ({
  assessmentId: "assessment-1",
  revision: 2,
  questionId: "event_1:event.outcome",
  mimeType: "audio/webm;codecs=opus",
  durationMs: 2000,
  audioBase64: Buffer.from(webm).toString("base64"),
  ...patch,
});
const request = (patch = {}) =>
  new Request("https://legalmate.test/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload(patch)),
  });
const current = (patch = {}) => ({
  id: "assessment-1",
  revision: 2,
  status: "needs_answer",
  result: {
    action: "ask_question",
    nextQuestion: {
      id: "event_1:event.outcome",
      text: "What was the final outcome?",
    },
  },
  ...patch,
});
const code = (value) => (error) =>
  error instanceof AssessmentAudioError && error.code === value;
const options = (patch = {}) => ({
  apiKey: "fictional-test-key",
  readCurrent: async () => current(),
  ...patch,
});

test("valid browser audio is decoded without altering the current-question binding", async () => {
  const parsed = await readAssessmentAudioRequest(request());
  assert.deepEqual(parsed.audio, webm);
  assert.equal(parsed.questionId, payload().questionId);
  assert.equal(parsed.revision, 2);
  assert.equal(parsed.mimeType, "audio/webm;codecs=opus");
  requireCurrentAudioQuestion(current(), parsed);
});

test("normal browser codec variants are accepted but arbitrary MIME types are rejected", async () => {
  assert.equal(
    normaliseAssessmentAudioMimeType('audio/webm; codecs="opus"'),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    normaliseAssessmentAudioMimeType("audio/mp4;codecs=mp4a.40.2"),
    "audio/mp4;codecs=mp4a.40.2",
  );
  assert.equal(normaliseAssessmentAudioMimeType("text/plain"), null);
  await assert.rejects(
    readAssessmentAudioRequest(request({ mimeType: "image/png" })),
    code("invalid_audio"),
  );
  await assert.rejects(
    readAssessmentAudioRequest(request({ mimeType: "audio/mp4" })),
    code("invalid_audio"),
  );
  const mp4 = Uint8Array.from([
    0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0,
  ]);
  assert.equal(
    (
      await readAssessmentAudioRequest(
        request({
          mimeType: "audio/mp4",
          audioBase64: Buffer.from(mp4).toString("base64"),
        }),
      )
    ).audio.byteLength,
    16,
  );
});

test("malformed base64, nonaudio content and provider option injection are rejected", async () => {
  for (const patch of [
    { audioBase64: "%%%=" },
    { audioBase64: "data:audio/webm;base64,AAAA" },
    { audioBase64: "AB==" },
    { audioBase64: Buffer.from("this is not audio").toString("base64") },
    { source_url: "https://elsewhere.invalid/audio" },
    { revision: -1 },
    { questionId: null },
  ])
    await assert.rejects(
      readAssessmentAudioRequest(request(patch)),
      code("invalid_audio"),
    );
});

test("the 90-second declared duration and 5 MB decoded audio limits are enforced", async () => {
  assert.equal(
    (
      await readAssessmentAudioRequest(
        request({ durationMs: assessmentAudioDurationMs }),
      )
    ).durationMs,
    90_000,
  );
  for (const durationMs of [99, 90_001, null])
    await assert.rejects(
      readAssessmentAudioRequest(request({ durationMs })),
      code("too_long"),
    );
  const oversized = new Uint8Array(assessmentAudioByteLimit + 1);
  oversized.set(webm);
  await assert.rejects(
    readAssessmentAudioRequest(
      request({ audioBase64: Buffer.from(oversized).toString("base64") }),
    ),
    code("too_large"),
  );
});

test("chunked request bodies cannot bypass the 7 MB limit with a false Content-Length", async () => {
  let cancelled = false;
  let part = 0;
  const body = new ReadableStream({
    pull(controller) {
      part++;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
      if (part > 10) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamRequest = new Request("https://legalmate.test/api/transcribe", {
    method: "POST",
    headers: { "Content-Length": "1" },
    body,
    duplex: "half",
  });
  await assert.rejects(
    readAssessmentAudioRequest(streamRequest),
    code("too_large"),
  );
  assert.equal(cancelled, true);
  const declared = new Request("https://legalmate.test/api/transcribe", {
    method: "POST",
    headers: { "Content-Length": String(assessmentAudioBodyByteLimit + 1) },
    body: "{}",
  });
  await assert.rejects(readAssessmentAudioRequest(declared), code("too_large"));
});

test("stale, answered, foreign, and revised questions fail before any provider request", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Must not upload rejected audio"),
  );
  const parsed = await readAssessmentAudioRequest(request());
  for (const assessment of [
    null,
    current({ id: "other-assessment" }),
    current({ revision: 3 }),
    current({ status: "ready" }),
    current({ status: "stale" }),
    current({
      result: {
        action: "ask_question",
        nextQuestion: { id: "other-question" },
      },
    }),
  ])
    await assert.rejects(
      transcribeAssessmentAudio(
        parsed,
        options({ readCurrent: async () => assessment }),
      ),
      code("stale_question"),
    );
});

test("transcription forwards only audio with server-owned Scribe settings and returns text for review", async (t) => {
  let checked = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.elevenlabs.io/v1/speech-to-text");
    assert.equal(init.headers["xi-api-key"], "fictional-test-key");
    assert.equal(init.headers["Content-Type"], undefined);
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get("model_id"), "scribe_v2");
    assert.equal(init.body.get("tag_audio_events"), "false");
    assert.equal(init.body.get("diarize"), "false");
    assert.equal(init.body.get("timestamps_granularity"), "none");
    assert.equal(init.body.get("assessmentId"), null);
    assert.equal(init.body.get("questionId"), null);
    const file = init.body.get("file");
    assert.equal(file.name, "answer.webm");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), webm);
    return Response.json({ text: "  I do not know the final outcome.  " });
  });
  const parsed = await readAssessmentAudioRequest(request());
  const text = await transcribeAssessmentAudio(
    parsed,
    options({
      readCurrent: async () => {
        checked++;
        return current();
      },
    }),
  );
  assert.equal(text, "I do not know the final outcome.");
  assert.equal(checked, 2);
});

test("a question answered or changed during transcription suppresses the late transcript", async (t) => {
  let checked = 0;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ text: "Old answer" }),
  );
  const parsed = await readAssessmentAudioRequest(request());
  await assert.rejects(
    transcribeAssessmentAudio(
      parsed,
      options({
        readCurrent: async () =>
          ++checked === 1 ? current() : current({ revision: 3 }),
      }),
    ),
    code("stale_question"),
  );
  assert.equal(checked, 2);
});

test("missing setup and pre-cancelled work never upload audio", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Must not upload audio"),
  );
  const parsed = await readAssessmentAudioRequest(request());
  await assert.rejects(
    transcribeAssessmentAudio(parsed, options({ apiKey: "" })),
    code("setup_required"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transcribeAssessmentAudio(parsed, options({ signal: controller.signal })),
    code("cancelled"),
  );
});

test("provider failures expose no audio, transcript, credentials or raw provider messages", async (t) => {
  const parsed = await readAssessmentAudioRequest(request());
  for (const [status, expected] of [
    [401, "setup_required"],
    [403, "setup_required"],
    [429, "provider_error"],
    [500, "provider_error"],
  ]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response("private provider payload", { status }),
    );
    await assert.rejects(
      transcribeAssessmentAudio(parsed, options()),
      (error) => code(expected)(error) && !error.message.includes("private"),
    );
    mock.mock.restore();
  }
});

test("empty, malformed, oversized and excessively long transcripts stay editable failures", async (t) => {
  const parsed = await readAssessmentAudioRequest(request());
  for (const [value, expected] of [
    [{ text: "  " }, "no_speech"],
    [{ text: 123 }, "provider_error"],
    [{ text: "x".repeat(6001) }, "too_long"],
    [{ text: "x".repeat(210_000) }, "provider_error"],
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json(value),
    );
    await assert.rejects(
      transcribeAssessmentAudio(parsed, options()),
      code(expected),
    );
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("invalid JSON"));
  await assert.rejects(
    transcribeAssessmentAudio(parsed, options()),
    code("provider_error"),
  );
});

test("caller cancellation aborts the provider upload", async (t) => {
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("private error")),
          { once: true },
        );
        controller.abort();
      }),
  );
  const parsed = await readAssessmentAudioRequest(request());
  await assert.rejects(
    transcribeAssessmentAudio(parsed, options({ signal: controller.signal })),
    code("cancelled"),
  );
});

test("provider timeout aborts instead of leaving transcription stuck", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true },
        );
        began();
      }),
  );
  const parsed = await readAssessmentAudioRequest(request());
  const pending = transcribeAssessmentAudio(parsed, options());
  await started;
  t.mock.timers.tick(45_000);
  await assert.rejects(pending, code("timeout"));
});
