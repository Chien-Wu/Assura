import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  activeWorkerQuery,
  appendManagerActionQuery,
  claimManagerGrantsQuery,
  cleanWorkerProfile,
  createWorkerNoteQuery,
  managedProvidersQuery,
  providerActionsQuery,
  providerRisksQuery,
  providerUsesQuery,
  readableNoteAccess,
} from "../lib/organisation-access.ts";
import {
  boundSql,
  provisioningStatements,
} from "../scripts/provision-provider.mjs";

const now = "2026-09-13T00:00:00.000Z";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0000_confused_green_goblin.sql",
    "0001_eminent_lilandra.sql",
    "0002_amazing_spectrum.sql",
  ])
    db.exec(
      readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"),
    );
  db.prepare(
    `INSERT INTO shift_notes (id,owner_id,worker_name,fields_json,form_version,timezone,created_at,updated_at)
    VALUES ('legacy','legacy-owner','Original worker','{}','demo','Australia/Melbourne',?,?)`,
  ).run(now, now);
  db.exec(
    readFileSync(
      new URL("../drizzle/0004_organisations.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const id of ["provider-a", "provider-b"])
    for (const statement of provisioningStatements(
      { id, name: `Test ${id}`, managerEmail: `${id}@example.test` },
      now,
    ))
      db.prepare(statement.sql).run(...statement.params);
  return db;
}
function worker(db, user, provider) {
  db.prepare("INSERT INTO app_profiles VALUES (?,?,?,?,?)").run(
    user,
    `Test ${user}`,
    provider,
    now,
    now,
  );
  db.prepare("INSERT INTO provider_memberships VALUES (?,?,1,?,?)").run(
    provider,
    user,
    now,
    now,
  );
}
function claim(db, user, provider) {
  db.prepare(claimManagerGrantsQuery).run(
    user,
    now,
    `${provider}@example.test`,
    user,
  );
}
function note(db, id, user, provider) {
  return db.prepare(createWorkerNoteQuery).run(
    id,
    user,
    `Test ${user}`,
    JSON.stringify({
      participant: "Fictional participant",
      shiftStart: "2026-09-13T08:00",
    }),
    "demo",
    "Australia/Melbourne",
    now,
    now,
    "2033-09-13",
    provider,
    user,
    provider,
  );
}
function readable(db, user, id) {
  return db
    .prepare(`SELECT id FROM shift_notes WHERE id=? AND ${readableNoteAccess}`)
    .get(id, user, user);
}

test("direct worker onboarding grants own-note access but never management or another worker's notes", () => {
  const db = fixture();
  try {
    worker(db, "worker-a", "provider-a");
    worker(db, "worker-b", "provider-a");
    note(db, "note-a", "worker-a", "provider-a");
    note(db, "note-b", "worker-b", "provider-a");
    assert.equal(
      db.prepare(activeWorkerQuery).get("worker-a").provider_id,
      "provider-a",
    );
    assert.deepEqual(db.prepare(managedProvidersQuery).all("worker-a"), []);
    assert.ok(readable(db, "worker-a", "note-a"));
    assert.equal(readable(db, "worker-a", "note-b"), undefined);
    assert.equal(readable(db, "worker-a", "legacy"), undefined);
  } finally {
    db.close();
  }
});

test("manager reads only their provider, grants cannot be claimed by another email or user", () => {
  const db = fixture();
  try {
    worker(db, "worker-a", "provider-a");
    worker(db, "worker-b", "provider-b");
    note(db, "note-a", "worker-a", "provider-a");
    note(db, "note-b", "worker-b", "provider-b");
    db.prepare(claimManagerGrantsQuery).run(
      "attacker",
      now,
      "unlisted@example.test",
      "attacker",
    );
    assert.equal(db.prepare(managedProvidersQuery).all("attacker").length, 0);
    claim(db, "manager-a", "provider-a");
    assert.equal(
      db.prepare(managedProvidersQuery).all("manager-a")[0].id,
      "provider-a",
    );
    assert.ok(readable(db, "manager-a", "note-a"));
    assert.equal(readable(db, "manager-a", "note-b"), undefined);
    assert.equal(readable(db, "manager-a", "legacy"), undefined);
    claim(db, "second-user", "provider-a");
    assert.equal(
      db.prepare(managedProvidersQuery).all("second-user").length,
      0,
    );
    // Existing author-only update APIs retain this owner predicate.
    assert.equal(
      db
        .prepare("SELECT id FROM shift_notes WHERE id=? AND owner_id=?")
        .get("note-a", "manager-a"),
      undefined,
    );
    db.prepare(
      "UPDATE provider_manager_grants SET active=0 WHERE provider_id=?",
    ).run("provider-a");
    assert.equal(readable(db, "manager-a", "note-a"), undefined);
  } finally {
    db.close();
  }
});

test("profile and active affiliation are required at note insertion, including an affiliation race", () => {
  const db = fixture();
  try {
    assert.equal(
      Number(note(db, "blocked", "no-profile", "provider-a").changes),
      0,
    );
    worker(db, "worker-a", "provider-a");
    assert.equal(
      Number(note(db, "wrong-provider", "worker-a", "provider-b").changes),
      0,
    );
    db.prepare("UPDATE provider_memberships SET active=0 WHERE user_id=?").run(
      "worker-a",
    );
    assert.equal(
      Number(note(db, "inactive", "worker-a", "provider-a").changes),
      0,
    );
    db.prepare("UPDATE provider_memberships SET active=1 WHERE user_id=?").run(
      "worker-a",
    );
    db.prepare("UPDATE providers SET active=0 WHERE id=?").run("provider-a");
    assert.equal(
      Number(note(db, "inactive-provider", "worker-a", "provider-a").changes),
      0,
    );
  } finally {
    db.close();
  }
});

test("provider changes preserve historical note association and legacy records remain unassigned", () => {
  const db = fixture();
  try {
    worker(db, "worker-a", "provider-a");
    note(db, "old-note", "worker-a", "provider-a");
    db.prepare("UPDATE app_profiles SET provider_id=? WHERE user_id=?").run(
      "provider-b",
      "worker-a",
    );
    db.prepare("UPDATE provider_memberships SET active=0 WHERE user_id=?").run(
      "worker-a",
    );
    db.prepare("INSERT INTO provider_memberships VALUES (?,?,1,?,?)").run(
      "provider-b",
      "worker-a",
      now,
      now,
    );
    assert.equal(
      Number(note(db, "raced-note", "worker-a", "provider-a").changes),
      0,
    );
    note(db, "new-note", "worker-a", "provider-b");
    assert.equal(
      db
        .prepare("SELECT provider_id FROM shift_notes WHERE id='old-note'")
        .get().provider_id,
      "provider-a",
    );
    assert.equal(
      db
        .prepare("SELECT provider_id FROM shift_notes WHERE id='new-note'")
        .get().provider_id,
      "provider-b",
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE shift_notes SET provider_id=? WHERE id=?")
          .run("provider-b", "old-note"),
      /cannot be changed/,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE shift_notes SET provider_id=? WHERE id=?")
          .run("provider-a", "legacy"),
      /cannot be changed/,
    );
    const legacy = db
      .prepare(
        "SELECT owner_id,worker_name,provider_id FROM shift_notes WHERE id='legacy'",
      )
      .get();
    assert.equal(legacy.owner_id, "legacy-owner");
    assert.equal(legacy.worker_name, "Original worker");
    assert.equal(legacy.provider_id, null);
  } finally {
    db.close();
  }
});

test("board risk timelines and monthly counts cannot mix providers even with the same participant", () => {
  const db = fixture();
  try {
    for (const suffix of ["a", "b"]) {
      worker(db, `worker-${suffix}`, `provider-${suffix}`);
      note(db, `note-${suffix}`, `worker-${suffix}`, `provider-${suffix}`);
      db.prepare("UPDATE shift_notes SET safety_json=? WHERE id=?").run(
        JSON.stringify({
          restrictivePractice: { used: "yes", schedule_item: "RP-test" },
        }),
        `note-${suffix}`,
      );
      db.prepare("INSERT INTO risk_events VALUES (?,?,?,?,?,?,?,?)").run(
        `risk-${suffix}`,
        `note-${suffix}`,
        `worker-${suffix}`,
        "test",
        "test",
        "{}",
        now,
        now,
      );
      db.prepare("INSERT INTO risk_actions VALUES (?,?,?,?,?,?,?)").run(
        `action-${suffix}`,
        `risk-${suffix}`,
        `worker-${suffix}`,
        "supervisor_review",
        "{}",
        `manager-${suffix}`,
        now,
      );
    }
    assert.deepEqual(
      db
        .prepare(providerRisksQuery)
        .all("provider-a")
        .map((r) => r.id),
      ["risk-a"],
    );
    assert.deepEqual(
      db
        .prepare(providerActionsQuery)
        .all("provider-a")
        .map((r) => r.id),
      ["action-a"],
    );
    assert.equal(
      db.prepare(providerUsesQuery).all("provider-a", "2026-09")[0].count,
      1,
    );
    claim(db, "manager-a", "provider-a");
    const writeReview = (id, risk, provider, manager) =>
      db
        .prepare(appendManagerActionQuery)
        .run(id, "{}", manager, now, risk, provider, manager);
    assert.equal(
      Number(
        writeReview("review-allowed", "risk-a", "provider-a", "manager-a")
          .changes,
      ),
      1,
    );
    assert.equal(
      Number(
        writeReview("review-denied", "risk-b", "provider-b", "manager-a")
          .changes,
      ),
      0,
    );
    assert.equal(
      Number(
        writeReview("review-worker-denied", "risk-a", "provider-a", "worker-a")
          .changes,
      ),
      0,
    );
    const saved = db
      .prepare(
        "SELECT owner_id,actor FROM risk_actions WHERE id='review-allowed'",
      )
      .get();
    assert.equal(saved.owner_id, "worker-a");
    assert.equal(saved.actor, "manager-a");
    db.prepare(
      "UPDATE provider_manager_grants SET active=0 WHERE provider_id='provider-a'",
    ).run();
    assert.equal(
      Number(
        writeReview("review-revoked", "risk-a", "provider-a", "manager-a")
          .changes,
      ),
      0,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE risk_actions SET actor='other' WHERE id='action-a'")
          .run(),
      /Append-only/,
    );
  } finally {
    db.close();
  }
});

test("profile validation and provisioning serialize apostrophes and SQL syntax as data", () => {
  assert.deepEqual(cleanWorkerProfile("  Jordan   Lee ", "provider-a"), {
    fullName: "Jordan Lee",
    providerId: "provider-a",
  });
  assert.throws(() => cleanWorkerProfile("", "provider-a"));
  assert.throws(() =>
    cleanWorkerProfile("Jordan Lee", "provider-a'; DROP TABLE providers;--"),
  );
  const db = fixture();
  try {
    const name = "O'Brien's care'); DROP TABLE providers; --";
    for (const statement of provisioningStatements(
      { id: "quoted", name, managerEmail: "Owner@Example.TEST" },
      now,
    ))
      db.exec(boundSql(statement));
    assert.equal(
      db.prepare("SELECT name FROM providers WHERE id='quoted'").get().name,
      name,
    );
    assert.equal(
      db
        .prepare(
          "SELECT email FROM provider_manager_grants WHERE provider_id='quoted'",
        )
        .get().email,
      "owner@example.test",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM providers").get().count,
      3,
    );
  } finally {
    db.close();
  }
});
