import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkflowQueue } from "../../lib/workflow/queue.ts";
test("client tool waits for durable transcript source before saving", async () => {
  const queue = createWorkflowQueue();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const order = [];
  const source = queue.run(async () => {
    await gate;
    order.push("source committed");
  });
  const tool = queue.run(async () => {
    order.push("tool save");
    return "saved";
  });
  await Promise.resolve();
  assert.deepEqual(order, []);
  release();
  await source;
  assert.equal(await tool, "saved");
  assert.deepEqual(order, ["source committed", "tool save"]);
});
test("failed writes remain observable and do not strand session cleanup", async () => {
  const queue = createWorkflowQueue();
  const failure = queue.run(async () => {
    throw Error("write failed");
  });
  const cleanup = queue.run(async () => "closed");
  await assert.rejects(failure, /write failed/);
  assert.equal(await cleanup, "closed");
  await queue.drain();
});
