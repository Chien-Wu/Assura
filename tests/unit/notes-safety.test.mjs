import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRP, rpPatch, retentionUntil } from "../../lib/notes/safety.ts";

test("RP times derive overnight duration and reject calendar errors and fractional frequency", () => {
  assert.equal(
    rpPatch(emptyRP(), {
      start_time: "2026-09-12T23:59",
      end_time: "2026-09-13T00:01",
    }).duration_minutes,
    2,
  );
  assert.throws(() => rpPatch(emptyRP(), { start_time: "2026-02-30T12:00" }));
  assert.throws(() => rpPatch(emptyRP(), { uses_in_24h: "1.5" }));
});
test("retention keeps minimum seven years and longer supplied minor rule", () => {
  assert.equal(
    retentionUntil("2026-09-12T00:00:00Z"),
    "2033-09-12T00:00:00.000Z",
  );
  assert.equal(
    retentionUntil("2026-09-12T00:00:00Z", "2016-01-01"),
    "2041-01-01T00:00:00.000Z",
  );
});
