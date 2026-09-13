import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  buildHistoryRows,
  importHistory,
  melbourneTime,
  readHistory,
  validateHistory,
} from "../../scripts/seed-patient-history.mjs";
import { testAccountStatements } from "../../scripts/provision-test-accounts.mjs";

const importedAt = "2026-09-13T02:00:00.000Z";
const authTables = [
  "providers",
  "app_profiles",
  "provider_memberships",
  "provider_manager_grants",
  "auth_user",
];
const contentTables = [
  "provider_participants",
  "scheduled_shifts",
  "shift_notes",
];
const evidenceTables = [
  "transcript_events",
  "note_changes",
  "note_snapshots",
  "risk_events",
  "risk_actions",
  "voice_sessions",
];

function snapshot(db, tables) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => ({ ...row })),
    ]),
  );
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0000_confused_green_goblin.sql",
    "0001_eminent_lilandra.sql",
    "0002_amazing_spectrum.sql",
    "0003_auth.sql",
    "0004_organisations.sql",
    "0005_scheduled_shifts.sql",
  ])
    sqlite.exec(
      readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8"),
    );
  for (const statement of testAccountStatements(importedAt)) {
    sqlite.prepare(statement.sql).run(...statement.params);
  }
  // An unrelated existing record must survive every successful/error path.
  sqlite
    .prepare(
      `INSERT INTO shift_notes
    (id,owner_id,worker_name,fields_json,form_version,timezone,created_at,updated_at)
    VALUES ('existing-note','unrelated-owner','Existing worker','{}','legacy','Australia/Melbourne',?,?)`,
    )
    .run(importedAt, importedAt);
  const adapter = {
    batches: 0,
    beforeBatch: null,
    prepare(sql) {
      const statement = {
        params: [],
        bind(...params) {
          return { ...statement, params };
        },
        async first() {
          return sqlite.prepare(sql).get(...this.params) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...this.params) };
        },
        run() {
          return sqlite.prepare(sql).run(...this.params);
        },
      };
      return statement;
    },
    async batch(statements) {
      this.batches += 1;
      this.beforeBatch?.();
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => ({
          meta: statement.run(),
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, adapter };
}

test("the authored fixture contains ten chronological histories for one fictional participant", async () => {
  const fixture = await readHistory();
  assert.equal(validateHistory(fixture), fixture);
  assert.equal(fixture.notes.length, 10);
  assert.equal(
    new Set(fixture.notes.map((note) => note.fields.participant)).size,
    1,
  );
  assert.equal(melbourneTime("2026-09-12T04:15:00Z"), "2026-09-12T14:15");
  assert.equal(melbourneTime("2026-01-12T04:15:00Z"), "2026-01-12T15:15");
  assert.notDeepEqual(
    fixture.notes.map((note) => note.expectedEnd),
    fixture.notes.map((note) => note.fields.shiftEnd),
  );
});

test("validation rejects altered scope, identities, chronology, enums and confirmation timing", async () => {
  const fixture = await readHistory();
  for (const corrupt of [
    (value) => {
      value.synthetic = false;
    },
    (value) => {
      value.providerId = "other-provider";
    },
    (value) => {
      value.workerId = "other-worker";
    },
    (value) => {
      value.participant.name = "Unmarked real-looking name";
    },
    (value) => {
      value.notes.pop();
    },
    (value) => {
      value.notes[1].id = value.notes[0].id;
    },
    (value) => {
      value.notes[1].shiftId = value.notes[0].id;
    },
    (value) => {
      value.notes[0].fields.participant = "Other participant";
    },
    (value) => {
      value.notes[0].participantId = "other";
    },
    (value) => {
      value.notes[0].fields.incidents = "probably";
    },
    (value) => {
      value.notes[0].fields.shiftEnd = value.notes[0].fields.shiftStart;
    },
    (value) => {
      value.notes[0].expectedEnd = "2026-09-13T01:00";
    },
    (value) => {
      value.notes[1].expectedStart = value.notes[0].expectedStart;
    },
    (value) => {
      value.notes[0].recordedAt = "2026-02-30T04:00:00Z";
    },
    (value) => {
      value.notes[0].simulatedConfirmedAt = "2026-01-01T00:00:00Z";
    },
  ]) {
    const invalid = structuredClone(fixture);
    corrupt(invalid);
    assert.throws(() => validateHistory(invalid));
  }
});

test("import preserves authored fields, real schema relationships and synthetic provenance without fabricated evidence", async () => {
  const fixture = await readHistory();
  const { sqlite, adapter } = database();
  try {
    const originalAuth = snapshot(sqlite, authTables);
    const originalNote = sqlite
      .prepare("SELECT * FROM shift_notes WHERE id='existing-note'")
      .get();
    const result = await importHistory(adapter, fixture, importedAt);
    assert.equal(result.inserted, 21);
    assert.equal(adapter.batches, 1);
    assert.deepEqual(snapshot(sqlite, authTables), originalAuth);
    assert.deepEqual(
      sqlite
        .prepare("SELECT * FROM shift_notes WHERE id='existing-note'")
        .get(),
      originalNote,
    );
    const counts = sqlite
      .prepare(
        `SELECT COUNT(*) AS total FROM shift_notes AS note
      JOIN scheduled_shifts AS shift ON shift.id=note.shift_id
      JOIN provider_participants AS participant ON participant.id=note.participant_id
      WHERE participant.id=? AND participant.provider_id=note.provider_id
        AND shift.participant_id=participant.id AND shift.provider_id=note.provider_id
        AND shift.worker_id=note.owner_id AND note.status='complete'`,
      )
      .get(fixture.participant.id);
    assert.equal(counts.total, 10);
    for (const authored of fixture.notes) {
      const row = sqlite
        .prepare("SELECT * FROM shift_notes WHERE id=?")
        .get(authored.id);
      assert.deepEqual(JSON.parse(row.fields_json), authored.fields);
      assert.deepEqual(
        JSON.parse(row.participant_snapshot_json),
        fixture.participant,
      );
      assert.equal(row.expected_start, authored.expectedStart);
      assert.equal(row.expected_end, authored.expectedEnd);
      assert.equal(row.created_at, authored.recordedAt);
      assert.equal(row.confirmed_at, authored.simulatedConfirmedAt);
      assert.equal(row.confirmation_id, null);
      const evidence = JSON.parse(row.confirmation_evidence);
      assert.equal(evidence.method, "synthetic_fixture");
      assert.equal(evidence.synthetic, true);
      assert.equal(evidence.importedAt, importedAt);
      assert.equal(evidence.quote, undefined);
      const safety = JSON.parse(row.safety_json);
      assert.equal(safety.restrictivePractice.used, "not_reviewed");
      if (authored.fields.incidents === "no")
        assert.equal(safety.fieldStates.incidents, "stated_negative");
      if (authored.fields.followUp === "none")
        assert.equal(safety.fieldStates.followUp, "stated_negative");
      assert.equal(safety.fieldStates.activities, "stated_positive");
    }
    for (const table of evidenceTables)
      assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total,
        0,
      );
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS total FROM scheduled_shifts WHERE created_by=?",
        )
        .get(`synthetic_fixture:${fixture.datasetId}`).total,
      10,
    );
  } finally {
    sqlite.close();
  }
});

test("identical reruns verify the complete history and perform no further writes", async () => {
  const fixture = await readHistory();
  const { sqlite, adapter } = database();
  try {
    await importHistory(adapter, fixture, importedAt);
    const before = snapshot(sqlite, [
      ...contentTables,
      ...authTables,
      ...evidenceTables,
    ]);
    const result = await importHistory(
      adapter,
      fixture,
      "2026-09-14T02:00:00.000Z",
    );
    assert.equal(result.inserted, 0);
    assert.equal(adapter.batches, 1);
    assert.deepEqual(
      snapshot(sqlite, [...contentTables, ...authTables, ...evidenceTables]),
      before,
    );
    const altered = structuredClone(fixture);
    altered.notes[0].fields.activities += " A changed narrative.";
    await assert.rejects(
      importHistory(adapter, altered, importedAt),
      /Fixture conflict/,
    );
    assert.equal(adapter.batches, 1);
    assert.deepEqual(
      snapshot(sqlite, contentTables),
      Object.fromEntries(contentTables.map((table) => [table, before[table]])),
    );
  } finally {
    sqlite.close();
  }
});

test("missing, moved or inactive account scope fails without provisioning or content writes", async () => {
  const fixture = await readHistory();
  for (const mutation of [
    "UPDATE providers SET active=0 WHERE id='testprovider'",
    "UPDATE providers SET name='Other provider' WHERE id='testprovider'",
    "DELETE FROM app_profiles WHERE user_id='auth_test_worker'",
    "UPDATE provider_memberships SET active=0 WHERE user_id='auth_test_worker'",
    "DELETE FROM provider_manager_grants WHERE claimed_user_id='auth_test_manager'",
    "UPDATE provider_manager_grants SET active=0 WHERE claimed_user_id='auth_test_manager'",
    "UPDATE auth_user SET email='other@example.test' WHERE id='auth_test_worker'",
  ]) {
    const { sqlite, adapter } = database();
    try {
      sqlite.exec(mutation);
      const before = snapshot(sqlite, [...contentTables, ...authTables]);
      await assert.rejects(
        importHistory(adapter, fixture, importedAt),
        /Existing active TestProvider/,
      );
      assert.equal(adapter.batches, 0);
      assert.deepEqual(
        snapshot(sqlite, [...contentTables, ...authTables]),
        before,
      );
    } finally {
      sqlite.close();
    }
  }
});

test("partial or conflicting fixture IDs never cause an upsert or deletion", async () => {
  const fixture = await readHistory();
  for (const collision of ["participant", "note"]) {
    const { sqlite, adapter } = database();
    try {
      if (collision === "participant") {
        const row = buildHistoryRows(fixture, importedAt).participant;
        sqlite
          .prepare("INSERT INTO provider_participants VALUES (?,?,?,?,?,?)")
          .run(...Object.values(row));
      } else {
        sqlite
          .prepare("UPDATE shift_notes SET id=? WHERE id='existing-note'")
          .run(fixture.notes[0].id);
      }
      const before = snapshot(sqlite, contentTables);
      await assert.rejects(
        importHistory(adapter, fixture, importedAt),
        /Partial history|fixture ID collision/,
      );
      assert.equal(adapter.batches, 0);
      assert.deepEqual(snapshot(sqlite, contentTables), before);
    } finally {
      sqlite.close();
    }
  }
});

test("failure on a later note rolls the entire participant/shift/note batch back", async () => {
  const fixture = await readHistory();
  const { sqlite, adapter } = database();
  try {
    // A constraint-like failure after earlier inserts have already executed.
    sqlite.exec(`CREATE TRIGGER reject_sixth_history_note BEFORE INSERT ON shift_notes
      WHEN (SELECT COUNT(*) FROM shift_notes WHERE participant_id IS NOT NULL)=5
      BEGIN SELECT RAISE(ABORT, 'simulated later insert failure'); END`);
    const before = snapshot(sqlite, [...contentTables, ...authTables]);
    await assert.rejects(
      importHistory(adapter, fixture, importedAt),
      /simulated later insert failure/,
    );
    assert.equal(adapter.batches, 1);
    assert.deepEqual(
      snapshot(sqlite, [...contentTables, ...authTables]),
      before,
    );
  } finally {
    sqlite.close();
  }
});

test("scope revocation between preflight and batch blocks every fixture insert", async () => {
  const fixture = await readHistory();
  const { sqlite, adapter } = database();
  try {
    const before = snapshot(sqlite, contentTables);
    adapter.beforeBatch = () =>
      sqlite.exec("UPDATE provider_manager_grants SET active=0");
    await assert.rejects(
      importHistory(adapter, fixture, importedAt),
      /NOT NULL/,
    );
    assert.deepEqual(snapshot(sqlite, contentTables), before);
    assert.equal(
      sqlite.prepare("SELECT active FROM provider_manager_grants").get().active,
      0,
    );
  } finally {
    sqlite.close();
  }
});
