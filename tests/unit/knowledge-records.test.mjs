import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  activeKnowledgeScopeSql,
  boundedKnowledgeSources,
  eligibleKnowledgeSql,
  knowledgeCutoff,
  literalKnowledgeQuery,
  melbourneInstant,
  minimizedProfile,
  sourceIsHistorical,
} from "../../lib/knowledge/records.ts";
import {
  buildHistoryRows,
  readHistory,
} from "../../scripts/seed-patient-history.mjs";
import { testAccountStatements } from "../../scripts/provision-test-accounts.mjs";

const fixture = await readHistory();
const fixtureRows = buildHistoryRows(fixture, "2026-09-13T02:00:00.000Z");
const cutoff = knowledgeCutoff(
  "2026-09-13T10:00",
  null,
  "Australia/Melbourne",
  false,
  Date.parse("2026-09-14T00:00:00Z"),
).cutoff;
const migration = (name) =>
  readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), "utf8");
function insert(db, table, row) {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...Object.values(row));
}
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "0000_confused_green_goblin.sql",
    "0001_eminent_lilandra.sql",
    "0002_amazing_spectrum.sql",
    "0003_auth.sql",
    "0004_organisations.sql",
    "0005_scheduled_shifts.sql",
  ])
    db.exec(migration(name));
  for (const statement of testAccountStatements("2026-09-13T02:00:00.000Z"))
    db.prepare(statement.sql).run(...statement.params);
  insert(db, "provider_participants", fixtureRows.participant);
  for (const row of fixtureRows.shifts) insert(db, "scheduled_shifts", row);
  for (const row of fixtureRows.notes) insert(db, "shift_notes", row);
  const lastShift = fixtureRows.shifts.at(-1);
  insert(db, "scheduled_shifts", {
    ...lastShift,
    id: "current-shift",
    expected_start: "2026-09-13T10:00",
    expected_end: "2026-09-13T14:00",
  });
  insert(db, "shift_notes", {
    ...fixtureRows.notes.at(-1),
    id: "current-note",
    shift_id: "current-shift",
    expected_start: "2026-09-13T10:00",
    expected_end: "2026-09-13T14:00",
    status: "draft",
    confirmed_at: null,
    fields_json: JSON.stringify({
      ...fixture.notes.at(-1).fields,
      shiftStart: "2026-09-13T10:00",
      shiftEnd: "",
    }),
  });
  db.exec(migration("0006_participant_knowledge.sql"));
  return db;
}
function search(db, query, historyCutoff = cutoff) {
  return db
    .prepare(
      `SELECT source.* FROM knowledge_fts
    JOIN shift_notes AS source ON source.id=knowledge_fts.note_id AND source.revision=knowledge_fts.revision
    WHERE knowledge_fts MATCH ? AND ${eligibleKnowledgeSql}
    ORDER BY json_extract(source.fields_json,'$.shiftStart') DESC`,
    )
    .all(
      literalKnowledgeQuery(query).match,
      fixture.workerId,
      fixture.providerId,
      fixture.participant.id,
      "current-note",
      historyCutoff.local,
      historyCutoff.utc,
    );
}
function source(index) {
  const note = fixture.notes[index];
  const fields = { ...note.fields };
  delete fields.participant;
  return {
    sourceId: `${note.id}@1`,
    noteId: note.id,
    revision: 1,
    shiftStart: fields.shiftStart,
    shiftEnd: fields.shiftEnd,
    confirmedAt: note.simulatedConfirmedAt,
    workerName: fixture.workerName,
    fields,
    isSynthetic: true,
  };
}

test("Melbourne history cutoffs handle summer, winter and fail closed for DST gaps/overlaps", () => {
  assert.equal(
    melbourneInstant("2026-09-12T14:00"),
    "2026-09-12T04:00:00.000Z",
  );
  assert.equal(
    melbourneInstant("2026-01-12T14:00"),
    "2026-01-12T03:00:00.000Z",
  );
  assert.equal(melbourneInstant("2026-04-05T02:30"), null);
  assert.equal(melbourneInstant("2026-10-04T02:30"), null);
  assert.equal(melbourneInstant("2026-02-30T14:00"), null);
  assert.equal(
    knowledgeCutoff("", "2026-09-12T14:00", "Australia/Melbourne", false)
      .timeStatus,
    "actual_shift_start_required",
  );
  assert.equal(
    knowledgeCutoff("", "2026-09-12T14:00", "Australia/Melbourne", true).cutoff
      .provisional,
    true,
  );
  assert.equal(
    knowledgeCutoff("invalid", "2026-09-12T14:00", "Australia/Melbourne", true)
      .cutoff,
    null,
  );
  assert.equal(
    knowledgeCutoff("2026-09-12T14:00", null, "UTC", false).timeStatus,
    "unsupported_timezone",
  );
  assert.equal(
    knowledgeCutoff(
      "2026-09-12T14:00",
      null,
      "Australia/Melbourne",
      false,
      Date.parse("2026-09-11T00:00:00Z"),
    ).timeStatus,
    "future_shift_start",
  );
});

test("literal search cannot activate FTS operators and explicitly rejects unsupported query text", () => {
  assert.equal(
    literalKnowledgeQuery('craft" OR note_id:* NOT "meal').match,
    '"craft" OR "id" OR "not" OR "meal"',
  );
  assert.throws(() => literalKnowledgeQuery("吃得比較少"), {
    code: "unsupported_query_language",
    status: 422,
  });
  assert.throws(() => literalKnowledgeQuery("AND OR THE"), {
    code: "unsupported_query_language",
  });
  assert.throws(() => literalKnowledgeQuery("a".repeat(301)), {
    code: "invalid_query",
  });
  const db = database();
  try {
    assert.doesNotThrow(() => search(db, 'craft" OR note_id:* NOT "meal'));
    assert.equal(search(db, "xylophonetrumpet").length, 0);
    assert.ok(
      search(db, "crafts").some((row) => row.id === fixture.notes.at(-1).id),
    );
  } finally {
    db.close();
  }
});

test("migration backfills only confirmed records and keeps FTS revision/content synchronized", () => {
  const db = database();
  try {
    assert.equal(
      db.prepare("SELECT count(*) AS total FROM knowledge_fts").get().total,
      10,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS total FROM knowledge_fts WHERE note_id='current-note'",
        )
        .get().total,
      0,
    );
    const id = fixture.notes[0].id;
    db.prepare(
      "UPDATE shift_notes SET fields_json=json_set(fields_json,'$.activities','uniquesearchword'),revision=revision+1 WHERE id=?",
    ).run(id);
    const result = search(db, "uniquesearchword");
    assert.equal(result.length, 1);
    assert.equal(result[0].revision, 2);
    assert.equal(
      db.prepare("SELECT revision FROM knowledge_fts WHERE note_id=?").get(id)
        .revision,
      2,
    );
    db.prepare(
      "UPDATE shift_notes SET status='draft',confirmed_at=NULL WHERE id=?",
    ).run(id);
    assert.equal(search(db, "uniquesearchword").length, 0);
    db.prepare(
      "UPDATE shift_notes SET status='complete',confirmed_at=? WHERE id=?",
    ).run(fixture.notes[0].simulatedConfirmedAt, id);
    assert.equal(search(db, "uniquesearchword").length, 1);
    db.prepare("DELETE FROM shift_notes WHERE id=?").run(id);
    assert.equal(search(db, "uniquesearchword").length, 0);
    const text = db
      .prepare("SELECT group_concat(content) AS content FROM knowledge_fts")
      .get().content;
    assert.doesNotMatch(
      text,
      /Hypoglycaemia|metformin|41902|synthetic_fixture|datasetId/,
    );
  } finally {
    db.close();
  }
});

test("Sarah food search retains the later report and backfilled shift cutoffs exclude future observations or confirmations", () => {
  const db = database();
  try {
    const current = search(db, "sandwich tired");
    assert.ok(current.some((row) => row.id === fixture.notes[6].id));
    assert.ok(current.some((row) => row.id === fixture.notes[7].id));
    assert.match(
      JSON.parse(
        current.find((row) => row.id === fixture.notes[7].id).fields_json,
      ).participantResponse,
      /[Mm]other/,
    );
    const backfill = knowledgeCutoff(
      "2026-09-08T10:00",
      null,
      "Australia/Melbourne",
      false,
    ).cutoff;
    const old = search(db, "sandwich tired", backfill);
    assert.ok(
      old.every(
        (row) => JSON.parse(row.fields_json).shiftStart < "2026-09-08T10:00",
      ),
    );
    db.prepare(
      "UPDATE shift_notes SET confirmed_at='2026-09-14T00:00:00Z' WHERE id=?",
    ).run(fixture.notes[0].id);
    assert.ok(
      search(db, "library").every((row) => row.id !== fixture.notes[0].id),
    );
    assert.equal(sourceIsHistorical(source(9), cutoff), true);
    assert.equal(sourceIsHistorical(source(9), backfill), false);
    assert.equal(
      sourceIsHistorical(
        { ...source(0), confirmedAt: "2026-09-01T00:00:00Z" },
        cutoff,
      ),
      false,
    );
  } finally {
    db.close();
  }
});

test("scope SQL requires active current assignment and source SQL never adds cross-worker sharing", () => {
  const db = database();
  try {
    const allowed = () =>
      db
        .prepare(
          `SELECT id FROM shift_notes AS current_note WHERE id='current-note' AND ${activeKnowledgeScopeSql}`,
        )
        .get();
    assert.ok(allowed());
    const originalId = fixture.notes[0].id;
    // An otherwise valid source may still be readable elsewhere in the app,
    // but this retrieval policy is deliberately restricted to the owner.
    db.prepare(
      "UPDATE shift_notes SET owner_id='another-worker' WHERE id=?",
    ).run(originalId);
    assert.ok(search(db, "library").every((row) => row.id !== originalId));
    db.prepare("UPDATE provider_memberships SET active=0 WHERE user_id=?").run(
      fixture.workerId,
    );
    assert.equal(allowed(), undefined);
    db.prepare("UPDATE provider_memberships SET active=1 WHERE user_id=?").run(
      fixture.workerId,
    );
    db.prepare("UPDATE provider_participants SET active=0 WHERE id=?").run(
      fixture.participant.id,
    );
    assert.equal(allowed(), undefined);
  } finally {
    db.close();
  }
});

test("model DTO omits identity numbers and plans without effective dates; bounds preserve whole source clauses", () => {
  const profile = minimizedProfile(fixture.participant);
  assert.equal(profile.ndis, undefined);
  assert.equal(profile.dateOfBirth, undefined);
  assert.equal(profile.medications, undefined);
  assert.match(profile.provenance, /effective dates are not recorded/);
  const oversized = {
    ...source(0),
    fields: { ...source(0).fields, activities: "A".repeat(12001) },
  };
  const selected = boundedKnowledgeSources(
    [oversized, source(6), source(7), source(8), source(9)],
    4,
  );
  assert.equal(selected.oversized, 1);
  assert.equal(selected.sources.length, 4);
  assert.deepEqual(selected.sources[0].fields, source(6).fields);
  assert.ok(selected.characters <= 24000);
  assert.equal(
    selected.sources.some((item) => item.noteId === oversized.noteId),
    false,
  );
});
