import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesShiftRisk,
  summarizeShiftRisk,
} from "../../src/lib/assessment/shift-risk.ts";

const note = { id: "note-1", revision: 3, status: "draft" };
const risk = (level = "P2", type = "health_medication") => ({
  type,
  level,
  evidence: [{ sourceId: "transcript:1", quote: "Medication was missed." }],
});
const assessment = (patch = {}) => ({
  id: "assessment-1",
  noteId: note.id,
  sourceRevision: note.revision,
  schemaVersion: 2,
  status: "ready",
  updatedAt: "2026-09-14T00:00:00.000Z",
  result: { risks: [], summary: "No concerns identified in this shift." },
  ...patch,
});
const finding = (patch = {}) => ({
  assessmentId: "assessment-1",
  noteId: note.id,
  sourceRevision: note.revision,
  isCurrent: true,
  type: "health_medication",
  aiLevel: "P2",
  managerLevel: null,
  reviewStatus: "open",
  ...patch,
});
const summaryFor = (risks, findings = []) =>
  summarizeShiftRisk(
    note,
    [assessment({ result: { risks, summary: "The shift was reviewed." } })],
    findings,
  );

test("a completed routine assessment is P0 even without findings; missing checks stay unassessed", () => {
  const routine = summarizeShiftRisk(note, [assessment()], []);
  assert.equal(routine.level, "P0");
  assert.equal(routine.status, "ready");
  assert.deepEqual(routine.riskTypes, []);
  assert.equal(matchesShiftRisk(routine, "none", "P0-1"), true);
  const absent = summarizeShiftRisk(note, [], []);
  assert.equal(absent.level, null);
  assert.equal(absent.status, "unassessed");
  for (const value of [absent, undefined, null]) {
    assert.equal(matchesShiftRisk(value, "all", "all"), true);
    assert.equal(matchesShiftRisk(value, "all", "unassessed"), true);
    assert.equal(matchesShiftRisk(value, "none", "P0-1"), false);
  }
});

test("every assessed shift belongs to exactly one requested seriousness group", () => {
  const summaries = [
    summaryFor([]),
    ...["P1", "P2", "P3", "P4"].map((level) => summaryFor([risk(level)])),
  ];
  assert.deepEqual(
    ["P4", "P2-3", "P0-1"].map(
      (group) =>
        summaries.filter((summary) => matchesShiftRisk(summary, "all", group))
          .length,
    ),
    [1, 2, 2],
  );
  for (const summary of summaries) {
    assert.equal(
      ["P4", "P2-3", "P0-1"].filter((group) =>
        matchesShiftRisk(summary, "all", group),
      ).length,
      1,
    );
    assert.equal(matchesShiftRisk(summary, "all", summary.level), true);
  }
});

test("the highest effective finding determines the shift priority and managers can set P0", () => {
  const risks = [risk("P4"), risk("P1", "service_exception")];
  const summary = summaryFor(risks, [finding({ managerLevel: "P2" })]);
  assert.equal(summary.level, "P2");
  assert.deepEqual(summary.riskTypes, [
    "health_medication",
    "service_exception",
  ]);
  assert.equal(matchesShiftRisk(summary, "service_exception", "P2-3"), true);
  assert.equal(matchesShiftRisk(summary, "complaint", "P2-3"), false);
  assert.equal(matchesShiftRisk(summary, "health_medication", "P4"), false);
  const downgraded = summaryFor(
    [risk("P4")],
    [finding({ managerLevel: "P0", reviewStatus: "closed" })],
  );
  assert.equal(downgraded.level, "P0");
  assert.equal(matchesShiftRisk(downgraded, "health_medication", "P0-1"), true);
  assert.equal(matchesShiftRisk(downgraded, "none"), false);
});

test("historical or unrelated manager reviews never change current shift classification", () => {
  const irrelevant = [
    { assessmentId: "old-assessment" },
    { noteId: "different-note" },
    { sourceRevision: 2 },
    { isCurrent: false },
    { type: "complaint" },
  ];
  for (const patch of irrelevant)
    assert.equal(
      summaryFor([risk("P2")], [finding({ managerLevel: "P4", ...patch })])
        .level,
      "P2",
    );
  assert.equal(
    summarizeShiftRisk(note, [assessment()], [finding({ managerLevel: "P4" })])
      .level,
    "P0",
  );
});

test("unfinished, failed, stale and invalid assessments never become routine", () => {
  for (const [patch, expectedStatus] of [
    [{ status: "running" }, "running"],
    [{ status: "failed" }, "failed"],
    [{ status: "stale" }, "stale"],
    [{ status: "needs_answer" }, "stale"],
    [{ sourceRevision: 2 }, "stale"],
    [{ schemaVersion: 1 }, "stale"],
    [{ result: null }, "failed"],
    [{ result: {} }, "failed"],
    [{ result: { risks: [], summary: "" } }, "failed"],
  ]) {
    const summary = summarizeShiftRisk(note, [assessment(patch)], []);
    assert.equal(summary.level, null);
    assert.equal(summary.status, expectedStatus);
    assert.equal(matchesShiftRisk(summary, "all", "P0-1"), false);
    assert.equal(matchesShiftRisk(summary, "unassessed", "unassessed"), true);
    assert.equal(matchesShiftRisk(summary, "none"), false);
  }
});

test("newer revisions and schema versions win even when retained results were updated later", () => {
  const earlier = assessment({
    id: "earlier",
    sourceRevision: 2,
    updatedAt: "2026-09-15T00:00:00.000Z",
  });
  const current = assessment({ status: "running", result: null });
  assert.equal(
    summarizeShiftRisk(note, [earlier, current], []).status,
    "running",
  );
  const oldSchema = assessment({
    id: "old-schema",
    schemaVersion: 1,
    updatedAt: "2026-09-15T00:00:00.000Z",
  });
  assert.equal(
    summarizeShiftRisk(note, [oldSchema, current], []).status,
    "running",
  );
  assert.equal(
    summarizeShiftRisk(note, [assessment({ noteId: "other-note" })], []).status,
    "unassessed",
  );
});
