import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecorderParticipantContext } from "../../src/lib/recorder/context.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  let snapshot = {
    sessionId: "session-a",
    noteId: "note-a",
    revision: 3,
    workerSequence: 2,
    interruptionGeneration: 0,
    formSaveFailed: false,
  };
  let queue = Promise.resolve();
  const reads = [];
  const queueErrors = [];
  const result = () => ({
    status: "partial",
    noteRevision: snapshot.revision,
    profile: { name: "Participant A" },
    sources: [{ sourceId: "history-a@2" }],
    retrievalId: "retrieval-a",
    cutoff: { provisional: true },
    coverage: { partial: true },
    questions: [{ question: "Legacy question" }],
    remainingClarifications: 0,
    guidance: ["Legacy interview instructions"],
  });
  const steps = {
    capture: () => snapshot && { ...snapshot },
    enqueue(job) {
      const work = queue.then(job);
      queue = work.catch((error) => {
        queueErrors.push(error);
      });
      return work;
    },
    async read(noteId) {
      reads.push(noteId);
      return result();
    },
  };
  return {
    steps,
    reads,
    queueErrors,
    result,
    change: (value) => {
      snapshot = value && { ...snapshot, ...value };
    },
  };
}
function assertNoContext(result, status) {
  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  assert.deepEqual(result.sources, []);
  assert.equal("profile" in result, false);
}

test("participant context waits for transcript and form saves, then uses the saved revision", async () => {
  const h = harness();
  const gate = deferred();
  const order = [];
  h.steps.enqueue(async () => {
    await gate.promise;
    order.push("transcript");
  });
  h.steps.enqueue(async () => {
    h.change({ revision: 4 });
    order.push("form");
  });
  const read = h.steps.read;
  h.steps.read = async (noteId) => {
    order.push("context");
    return read(noteId);
  };
  const pending = readRecorderParticipantContext(h.steps);
  await Promise.resolve();
  assert.deepEqual(h.reads, []);
  gate.resolve();
  const result = await pending;
  assert.deepEqual(order, ["transcript", "form", "context"]);
  assert.deepEqual(h.reads, ["note-a"]);
  assert.equal(result.ok, true);
  assert.equal(result.noteRevision, 4);
  assert.equal(result.retrievalId, "retrieval-a");
  assert.equal(result.coverage.partial, true);
  assert.equal(result.cutoff.provisional, true);
  assert.equal("questions" in result, false);
  assert.equal("remainingClarifications" in result, false);
  assert.ok(!result.guidance.includes("Legacy interview instructions"));
});

test("changing sessions before the queued read prevents requesting either participant", async () => {
  const h = harness();
  const gate = deferred();
  h.steps.enqueue(() => gate.promise);
  const pending = readRecorderParticipantContext(h.steps);
  h.change({ sessionId: "session-b", noteId: "note-b" });
  gate.resolve();
  assertNoContext(await pending, "stale");
  assert.deepEqual(h.reads, []);
});

test("a preceding failed form save prevents reading with the old shift-start cutoff", async () => {
  const h = harness();
  h.steps.enqueue(async () => {
    h.change({ formSaveFailed: true });
  });
  assertNoContext(await readRecorderParticipantContext(h.steps), "unavailable");
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.queueErrors, []);
});

test("cancelling a queued context read during handoff does not reject the save queue", async () => {
  const h = harness();
  const gate = deferred();
  h.steps.enqueue(() => gate.promise);
  const pending = readRecorderParticipantContext(h.steps);
  h.change(null);
  gate.resolve();
  assertNoContext(await pending, "stale");
  await h.steps.enqueue(async () => {});
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.queueErrors, []);
});

for (const change of [
  null,
  { sessionId: "session-b", noteId: "note-b" },
  { noteId: "note-b" },
  { revision: 4 },
  { workerSequence: 3 },
  { interruptionGeneration: 1 },
  { formSaveFailed: true },
]) {
  test(`late participant context is discarded after ${JSON.stringify(change)}`, async () => {
    const h = harness();
    const started = deferred();
    const response = deferred();
    const value = h.result();
    h.steps.read = async (noteId) => {
      h.reads.push(noteId);
      started.resolve();
      return response.promise;
    };
    const pending = readRecorderParticipantContext(h.steps);
    await started.promise;
    h.change(change);
    response.resolve(value);
    assertNoContext(await pending, "stale");
    assert.deepEqual(h.reads, ["note-a"]);
  });
}

test("a server revision mismatch never delivers profile or historical sources", async () => {
  const h = harness();
  h.steps.read = async () => ({ ...h.result(), noteRevision: 2 });
  assertNoContext(await readRecorderParticipantContext(h.steps), "stale");
});

test("HTTP failures and malformed context preserve a usable recorder with no invented history", async () => {
  for (const value of [
    null,
    {},
    { status: "ok", noteRevision: 3, sources: null },
  ]) {
    const h = harness();
    h.steps.read = async () => value;
    assertNoContext(
      await readRecorderParticipantContext(h.steps),
      "unavailable",
    );
  }
  const h = harness();
  h.steps.read = async () => {
    throw new Error("History is unavailable for this participant assignment.");
  };
  assertNoContext(await readRecorderParticipantContext(h.steps), "unavailable");
  assert.deepEqual(h.queueErrors, []);
});
