import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesShiftDate } from "../../src/lib/roster/shift-date-filter.ts";

test("no date filter includes shifts with unknown or invalid start times", () => {
  for (const value of [undefined, null, "", "invalid", "2026-09-14T09:00"])
    assert.equal(matchesShiftDate(value, "", ""), true);
});

test("date ranges include both full boundary days and exclude surrounding dates", () => {
  const start = "2026-09-14";
  const end = "2026-09-16";
  for (const value of [
    "2026-09-14T00:00",
    "2026-09-15T12:30",
    "2026-09-16T23:59:59.999",
  ])
    assert.equal(matchesShiftDate(value, start, end), true);
  for (const value of ["2026-09-13T23:59", "2026-09-17T00:00"])
    assert.equal(matchesShiftDate(value, start, end), false);
  assert.equal(matchesShiftDate("2026-09-14T23:59", start, start), true);
});

test("one-sided date ranges work across month and year boundaries", () => {
  assert.equal(matchesShiftDate("2027-01-01T08:00", "2026-12-31", ""), true);
  assert.equal(matchesShiftDate("2026-12-30T23:59", "2026-12-31", ""), false);
  assert.equal(matchesShiftDate("2026-08-31T23:59", "", "2026-09-01"), true);
  assert.equal(matchesShiftDate("2026-09-02T00:00", "", "2026-09-01"), false);
});

test("offset timestamps use their recorded shift date without timezone conversion", () => {
  for (const value of [
    "2026-09-14T00:30:00+10:00",
    "2026-09-14T23:30:00-10:00",
    "2026-09-14T12:00:00.000Z",
  ]) {
    assert.equal(matchesShiftDate(value, "2026-09-14", "2026-09-14"), true);
    assert.equal(matchesShiftDate(value, "2026-09-13", "2026-09-13"), false);
    assert.equal(matchesShiftDate(value, "2026-09-15", "2026-09-15"), false);
  }
});

test("active date filters exclude missing and malformed shift dates and times", () => {
  for (const value of [
    undefined,
    null,
    "",
    "not a date",
    "2026-09-14",
    "2026-02-29T09:00",
    "2026-09-31T09:00",
    "2026-13-01T09:00",
    "2026-00-14T09:00",
    "2026-09-00T09:00",
    "2026-09-14T24:00",
    "2026-09-14T09:60",
    "2026-09-14T09:00:60",
    "2026-09-14T09:00garbage",
  ]) {
    assert.equal(matchesShiftDate(value, "2026-01-01", ""), false);
    assert.equal(matchesShiftDate(value, "", "2026-12-31"), false);
  }
  assert.equal(matchesShiftDate("2028-02-29T09:00", "2028-02-29", ""), true);
  assert.equal(matchesShiftDate("2100-02-29T09:00", "", "2100-03-01"), false);
  assert.equal(matchesShiftDate("2000-02-29T09:00", "2000-02-29", ""), true);
});

test("invalid bounds and reversed ranges match no shifts", () => {
  const value = "2026-09-14T09:00";
  for (const [start, end] of [
    ["2026-09-15", "2026-09-13"],
    ["2026-02-29", ""],
    ["", "2026-09-31"],
    ["14/09/2026", ""],
    ["", "not a date"],
  ])
    assert.equal(matchesShiftDate(value, start, end), false);
});
