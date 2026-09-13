import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecorderHandoff } from "../../lib/recorder/handoff.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("review waits for admitted writes and receives the newest saved fields", async () => {
  const startup = deferred();
  const write = deferred();
  const draining = deferred();
  const calls = [];
  let saved = { revision: 7, fields: { goalProgress: "Earlier account" } };
  let completed;
  const finish = createRecorderHandoff({
    stopAdmission() {
      calls.push("stop");
    },
    waitForStartup() {
      calls.push("startup");
      return startup.promise;
    },
    async drainWrites() {
      calls.push("drain");
      draining.resolve();
      await write.promise;
    },
    async closeSession() {
      calls.push("close");
    },
    async readSaved() {
      calls.push("read");
      return saved;
    },
    complete(outcome) {
      calls.push("complete");
      completed = outcome;
    },
  });

  const pending = finish();
  assert.deepEqual(calls, ["stop", "startup"]);
  assert.equal(completed, undefined);
  startup.resolve();
  await draining.promise;
  assert.deepEqual(calls, ["stop", "startup", "drain"]);
  saved = { revision: 8, fields: { goalProgress: "Worker correction" } };
  write.resolve();
  const outcome = await pending;
  assert.equal(outcome.note, saved);
  assert.equal(outcome.error, null);
  assert.equal(completed, outcome);
  assert.deepEqual(calls, [
    "stop",
    "startup",
    "drain",
    "close",
    "read",
    "complete",
  ]);
});

test("review, End, and synchronous SDK disconnect share one handoff", async () => {
  let disconnected;
  let stops = 0;
  let closes = 0;
  let completions = 0;
  const finish = createRecorderHandoff({
    stopAdmission() {
      stops++;
      disconnected = finish();
    },
    async waitForStartup() {},
    async drainWrites() {},
    async closeSession() {
      closes++;
    },
    async readSaved() {
      return { revision: 2 };
    },
    complete() {
      completions++;
    },
  });

  const first = finish();
  assert.equal(disconnected, first);
  assert.equal(finish(), first);
  const result = await first;
  assert.equal(await finish(), result);
  assert.equal(stops, 1);
  assert.equal(closes, 1);
  assert.equal(completions, 1);
});

for (const failedStep of ["stop", "startup", "drain", "close", "read"]) {
  test(`${failedStep} failure is preserved while remaining cleanup runs`, async () => {
    const failure = new Error(`${failedStep} failed`);
    const calls = [];
    const saved = { revision: 3 };
    let completed;
    function step(name) {
      calls.push(name);
      if (name === failedStep) throw failure;
    }
    const finish = createRecorderHandoff({
      stopAdmission() {
        step("stop");
      },
      async waitForStartup() {
        step("startup");
      },
      async drainWrites() {
        step("drain");
      },
      async closeSession() {
        step("close");
      },
      async readSaved() {
        step("read");
        return saved;
      },
      complete(outcome) {
        calls.push("complete");
        completed = outcome;
      },
    });

    const outcome = await finish();
    assert.equal(outcome.error, failure);
    assert.equal(outcome.note, failedStep === "read" ? null : saved);
    assert.equal(completed, outcome);
    assert.deepEqual(calls, [
      "stop",
      "startup",
      "drain",
      "close",
      "read",
      "complete",
    ]);
  });
}

test("a failed drain cannot become a clean review after successful refresh", async () => {
  const firstFailure = new Error("Transcript save failed");
  const finish = createRecorderHandoff({
    stopAdmission() {},
    async waitForStartup() {},
    async drainWrites() {
      throw firstFailure;
    },
    async closeSession() {
      throw new Error("Close failed too");
    },
    async readSaved() {
      return { revision: 9 };
    },
    complete() {},
  });
  const outcome = await finish();
  assert.deepEqual(outcome.note, { revision: 9 });
  assert.equal(outcome.error, firstFailure);
});

test("cancelling startup still closes the session created before cancellation", async () => {
  const connection = deferred();
  const cancelled = new Error("Startup cancelled");
  let session;
  let closed;
  let completed = 0;
  const finish = createRecorderHandoff({
    stopAdmission() {},
    async waitForStartup() {
      await connection.promise;
      session = { id: "late-created-session" };
      throw cancelled;
    },
    async drainWrites() {},
    async closeSession() {
      closed = session.id;
    },
    async readSaved() {
      return null;
    },
    complete() {
      completed++;
    },
  });

  const pending = finish();
  assert.equal(closed, undefined);
  connection.resolve();
  assert.deepEqual(await pending, { note: null, error: cancelled });
  assert.equal(closed, "late-created-session");
  assert.equal(completed, 1);
});

test("completion failure resolves once with an error instead of hanging callers", async () => {
  const failure = new Error("Could not update the editor");
  let completions = 0;
  const finish = createRecorderHandoff({
    stopAdmission() {},
    async waitForStartup() {},
    async drainWrites() {},
    async closeSession() {},
    async readSaved() {
      return { revision: 4 };
    },
    complete() {
      completions++;
      throw failure;
    },
  });
  assert.equal((await finish()).error, failure);
  assert.equal((await finish()).error, failure);
  assert.equal(completions, 1);
});
