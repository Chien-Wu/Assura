import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  cleanShiftInput,
  createScheduledNoteQuery,
  createScheduledShiftQuery,
  shiftSelect,
  validLocalTime,
} from "../lib/shifts.ts";
import {
  cleanParticipantInput,
  createProviderParticipantQuery,
  providerParticipantUsesQuery,
} from "../lib/roster.ts";
import { emptyFields, FORM_VERSION } from "../lib/shift-form.ts";

const now = "2026-09-13T00:00:00.000Z";
const expectedStart = "2026-09-13T08:00";
const expectedEnd = "2026-09-13T16:00";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0000_confused_green_goblin.sql",
    "0001_eminent_lilandra.sql",
    "0002_amazing_spectrum.sql",
    "0004_organisations.sql",
  ])
    db.exec(
      readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"),
    );
  // Keep an existing record through the migration to verify historical notes.
  db.prepare(
    `INSERT INTO shift_notes
    (id,owner_id,worker_name,fields_json,form_version,timezone,created_at,updated_at)
    VALUES ('legacy','legacy-worker','Original worker',?,'legacy','Australia/Melbourne',?,?)`,
  ).run(
    JSON.stringify({ ...emptyFields(), participant: "Original participant" }),
    now,
    now,
  );
  db.exec(
    readFileSync(
      new URL("../drizzle/0005_scheduled_shifts.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const suffix of ["a", "b"]) {
    const provider = `provider-${suffix}`;
    const worker = `worker-${suffix}`;
    const manager = `manager-${suffix}`;
    db.prepare("INSERT INTO providers VALUES (?,?,1,?)").run(
      provider,
      `Provider ${suffix}`,
      now,
    );
    db.prepare(
      `INSERT INTO provider_manager_grants
      (id,provider_id,email,active,claimed_user_id,claimed_at,created_at)
      VALUES (?,?,?,1,?,?,?)`,
    ).run(
      `grant-${suffix}`,
      provider,
      `${manager}@example.test`,
      manager,
      now,
      now,
    );
    db.prepare("INSERT INTO app_profiles VALUES (?,?,?,?,?)").run(
      worker,
      `Worker ${suffix}`,
      provider,
      now,
      now,
    );
    db.prepare("INSERT INTO provider_memberships VALUES (?,?,1,?,?)").run(
      provider,
      worker,
      now,
      now,
    );
    const profile = {
      ...cleanParticipantInput({
        name: `Participant ${suffix}`,
        risks: ["Recorded risk"],
      }),
      id: `participant-${suffix}`,
    };
    db.prepare(createProviderParticipantQuery).run(
      profile.id,
      provider,
      JSON.stringify(profile),
      now,
      now,
      provider,
      manager,
    );
  }
  return db;
}

function shift(db, id = "shift-a", options = {}) {
  const providerId = options.providerId ?? "provider-a";
  const managerId = options.managerId ?? "manager-a";
  return db
    .prepare(createScheduledShiftQuery)
    .run(
      id,
      providerId,
      expectedStart,
      expectedEnd,
      "Australia/Melbourne",
      managerId,
      now,
      options.participantId ?? "participant-a",
      providerId,
      options.workerId ?? "worker-a",
      managerId,
    );
}

function note(
  db,
  id = "note-a",
  shiftId = "shift-a",
  workerId = "worker-a",
  providerId = "provider-a",
) {
  return db
    .prepare(createScheduledNoteQuery)
    .run(
      id,
      JSON.stringify(emptyFields()),
      FORM_VERSION,
      now,
      now,
      "2033-09-13",
      shiftId,
      workerId,
      providerId,
    );
}

test("shift dates must be real local times with an explicit later end date for overnight shifts", () => {
  const input = {
    participantId: "participant-a",
    workerId: "worker-a",
    expectedStart,
    expectedEnd,
  };
  assert.deepEqual(cleanShiftInput(input), {
    ...input,
    timezone: "Australia/Melbourne",
  });
  assert.equal(
    cleanShiftInput({
      ...input,
      expectedStart: "2026-09-13T22:00",
      expectedEnd: "2026-09-14T06:00",
    }).expectedEnd,
    "2026-09-14T06:00",
  );
  for (const value of [
    "2026-02-29T08:00",
    "2026-09-13T24:01",
    "2026-13-13T08:00",
    "2026-09-13T08:00Z",
    null,
  ])
    assert.equal(validLocalTime(value), false);
  for (const invalid of [
    { ...input, participantId: "" },
    { ...input, workerId: " " },
    { ...input, expectedEnd: expectedStart },
    { ...input, expectedEnd: "2026-09-13T06:00" },
    { ...input, expectedStart: "2026-02-29T08:00" },
    { ...input, timezone: "UTC" },
  ])
    assert.throws(() => cleanShiftInput(invalid));
});

test("only an active manager can assign a participant and current worker within their provider", () => {
  const db = fixture();
  try {
    assert.equal(shift(db).changes, 1);
    for (const options of [
      { participantId: "participant-b" },
      { workerId: "worker-b" },
      { managerId: "manager-b" },
      { managerId: "worker-a" },
      { providerId: "provider-b" },
    ])
      assert.equal(shift(db, "forbidden", options).changes, 0);
    const result = db
      .prepare(shiftSelect + " WHERE shift.provider_id=?")
      .all("provider-a");
    assert.equal(result.length, 1);
    assert.equal(result[0].participantId, "participant-a");
    assert.equal(result[0].workerId, "worker-a");
    assert.equal(result[0].noteId, null);
  } finally {
    db.close();
  }
});

test("shift assignment rechecks manager, provider, participant and worker status in the insert", () => {
  for (const mutation of [
    "UPDATE provider_manager_grants SET active=0 WHERE provider_id='provider-a'",
    "UPDATE provider_manager_grants SET claimed_user_id=NULL WHERE provider_id='provider-a'",
    "UPDATE providers SET active=0 WHERE id='provider-a'",
    "UPDATE provider_participants SET active=0 WHERE id='participant-a'",
    "UPDATE provider_memberships SET active=0 WHERE user_id='worker-a'",
    "UPDATE app_profiles SET provider_id='provider-b' WHERE user_id='worker-a'",
  ]) {
    const db = fixture();
    try {
      db.exec(mutation);
      assert.equal(shift(db).changes, 0);
    } finally {
      db.close();
    }
  }
});

test("workers create only their assigned notes, actual times start empty, and retries keep the original note", () => {
  const db = fixture();
  try {
    shift(db);
    assert.equal(
      note(db, "foreign-worker", "shift-a", "worker-b", "provider-a").changes,
      0,
    );
    assert.equal(
      note(db, "foreign-provider", "shift-a", "worker-a", "provider-b").changes,
      0,
    );
    assert.equal(note(db).changes, 1);
    assert.equal(note(db, "retry-note").changes, 0);
    const saved = db
      .prepare("SELECT * FROM shift_notes WHERE shift_id='shift-a'")
      .get();
    assert.equal(saved.id, "note-a");
    assert.equal(saved.owner_id, "worker-a");
    assert.equal(saved.provider_id, "provider-a");
    assert.equal(saved.participant_id, "participant-a");
    assert.equal(saved.expected_start, expectedStart);
    assert.equal(saved.expected_end, expectedEnd);
    const fields = JSON.parse(saved.fields_json);
    assert.equal(fields.participant, "Participant a");
    assert.equal(fields.shiftStart, "");
    assert.equal(fields.shiftEnd, "");
    assert.equal(
      JSON.parse(saved.participant_snapshot_json).id,
      "participant-a",
    );
    assert.equal(
      db.prepare(shiftSelect + " WHERE shift.id=?").get("shift-a").noteId,
      "note-a",
    );
  } finally {
    db.close();
  }
});

test("new notes reject removed participants, inactive providers, or workers whose affiliation changed", () => {
  for (const mutation of [
    "UPDATE providers SET active=0 WHERE id='provider-a'",
    "UPDATE provider_participants SET active=0 WHERE id='participant-a'",
    "UPDATE provider_memberships SET active=0 WHERE user_id='worker-a'",
    "UPDATE app_profiles SET provider_id='provider-b' WHERE user_id='worker-a'",
  ]) {
    const db = fixture();
    try {
      shift(db);
      db.exec(mutation);
      assert.equal(note(db).changes, 0);
    } finally {
      db.close();
    }
  }
});

test("saved note attribution, planned times and profile snapshot remain immutable", () => {
  const db = fixture();
  try {
    shift(db);
    note(db);
    for (const mutation of [
      "UPDATE shift_notes SET shift_id=NULL WHERE id='note-a'",
      "UPDATE shift_notes SET participant_id='participant-b' WHERE id='note-a'",
      "UPDATE shift_notes SET provider_id='provider-b' WHERE id='note-a'",
      "UPDATE shift_notes SET participant_snapshot_json='{}' WHERE id='note-a'",
      "UPDATE shift_notes SET expected_start='2026-09-13T09:00' WHERE id='note-a'",
      "UPDATE shift_notes SET expected_end='2026-09-13T18:00' WHERE id='note-a'",
      "UPDATE shift_notes SET fields_json=json_set(fields_json,'$.participant','Different participant') WHERE id='note-a'",
      "UPDATE shift_notes SET fields_json=json_remove(fields_json,'$.participant') WHERE id='note-a'",
    ])
      assert.throws(() => db.exec(mutation), /cannot be changed/);
    db.exec(
      "UPDATE provider_participants SET profile_json=json_set(profile_json,'$.name','Renamed participant','$.risks',json('[]')) WHERE id='participant-a'",
    );
    db.exec(
      "UPDATE shift_notes SET fields_json=json_set(fields_json,'$.shiftStart','2026-09-13T08:15','$.activities','Recorded activity') WHERE id='note-a'",
    );
    const saved = db
      .prepare("SELECT * FROM shift_notes WHERE id='note-a'")
      .get();
    assert.equal(JSON.parse(saved.fields_json).shiftStart, "2026-09-13T08:15");
    assert.equal(
      JSON.parse(saved.participant_snapshot_json).name,
      "Participant a",
    );
    assert.deepEqual(JSON.parse(saved.participant_snapshot_json).risks, [
      "Recorded risk",
    ]);
  } finally {
    db.close();
  }
});

test("database insert constraints reject mismatched shift attribution even outside the normal create helper", () => {
  const db = fixture();
  try {
    shift(db);
    const profile = JSON.parse(
      db
        .prepare(
          "SELECT profile_json FROM provider_participants WHERE id='participant-a'",
        )
        .get().profile_json,
    );
    const insert = db.prepare(`INSERT INTO shift_notes
      (id,owner_id,worker_name,fields_json,form_version,timezone,created_at,updated_at,provider_id,shift_id,participant_id,participant_snapshot_json,expected_start,expected_end)
      VALUES (?,?,?,?,'test','Australia/Melbourne',?, ?,?,?,?,?,?,?)`);
    const base = [
      "direct-note",
      "worker-a",
      "Worker a",
      JSON.stringify({ ...emptyFields(), participant: profile.name }),
      now,
      now,
      "provider-a",
      "shift-a",
      "participant-a",
      JSON.stringify(profile),
      expectedStart,
      expectedEnd,
    ];
    for (const [index, value] of [
      [1, "worker-b"],
      [6, "provider-b"],
      [8, "participant-b"],
      [9, "{}"],
      [10, "2026-09-13T09:00"],
      [3, JSON.stringify({ ...emptyFields(), participant: "Other person" })],
    ]) {
      const values = [...base];
      values[index] = value;
      assert.throws(() => insert.run(...values), /assigned shift/);
    }
  } finally {
    db.close();
  }
});

test("roster migration preserves legacy records without attaching a shift or participant", () => {
  const db = fixture();
  try {
    const legacy = db
      .prepare("SELECT * FROM shift_notes WHERE id='legacy'")
      .get();
    assert.equal(legacy.owner_id, "legacy-worker");
    assert.equal(legacy.provider_id, null);
    assert.equal(legacy.shift_id, null);
    assert.equal(legacy.participant_id, null);
    assert.equal(legacy.participant_snapshot_json, null);
    assert.equal(
      JSON.parse(legacy.fields_json).participant,
      "Original participant",
    );
  } finally {
    db.close();
  }
});

test("monthly reporting uses provider-scoped participant IDs and limits name matching to legacy notes", () => {
  const db = fixture();
  try {
    shift(db);
    note(db);
    shift(db, "shift-b", {
      providerId: "provider-b",
      managerId: "manager-b",
      workerId: "worker-b",
      participantId: "participant-b",
    });
    note(db, "note-b", "shift-b", "worker-b", "provider-b");
    db.prepare(
      `INSERT INTO shift_notes
      (id,owner_id,worker_name,fields_json,form_version,timezone,created_at,updated_at,provider_id)
      VALUES ('legacy-a','worker-a','Worker a',?,'legacy','Australia/Melbourne',?,?,'provider-a')`,
    ).run(
      JSON.stringify({ ...emptyFields(), participant: "Participant a" }),
      now,
      now,
    );
    db.exec(`UPDATE shift_notes SET fields_json=json_set(fields_json,'$.shiftStart','2026-09-13T08:00'),
      safety_json='{"restrictivePractice":{"used":"yes","schedule_item":"RP-1"}}'`);
    const uses = db
      .prepare(providerParticipantUsesQuery)
      .all("provider-a", "2026-09")
      .map((row) => ({ ...row }));
    assert.deepEqual(uses, [
      {
        participantId: null,
        legacyParticipantName: "Participant a",
        item: "RP-1",
        count: 1,
      },
      {
        participantId: "participant-a",
        legacyParticipantName: null,
        item: "RP-1",
        count: 1,
      },
    ]);
    assert.deepEqual(
      db.prepare(providerParticipantUsesQuery).all("provider-a", "2026-08"),
      [],
    );
  } finally {
    db.close();
  }
});
