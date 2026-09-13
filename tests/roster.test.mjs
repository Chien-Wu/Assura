import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  cleanParticipantInput,
  createProviderParticipantQuery,
  monthlyParticipantUses,
  providerParticipantQuery,
  providerParticipantsQuery,
  providerWorkersQuery,
  updateProviderParticipantQuery,
} from "../lib/roster.ts";
import { participants } from "../lib/participants.ts";

const now = "2026-09-13T00:00:00.000Z";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0000_confused_green_goblin.sql",
    "0001_eminent_lilandra.sql",
    "0002_amazing_spectrum.sql",
    "0004_organisations.sql",
    "0005_scheduled_shifts.sql",
  ])
    db.exec(
      readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"),
    );
  for (const id of ["provider-a", "provider-b"]) {
    db.prepare("INSERT INTO providers VALUES (?,?,1,?)").run(id, id, now);
    db.prepare(
      `INSERT INTO provider_manager_grants
      (id,provider_id,email,active,claimed_user_id,claimed_at,created_at)
      VALUES (?,?,?,1,?,?,?)`,
    ).run(`grant-${id}`, id, `${id}@example.test`, `manager-${id}`, now, now);
  }
  return db;
}

function create(
  db,
  id,
  providerId = "provider-a",
  managerId = `manager-${providerId}`,
) {
  const profile = {
    ...cleanParticipantInput({ name: `Participant ${id}` }),
    id,
  };
  return db
    .prepare(createProviderParticipantQuery)
    .run(
      id,
      providerId,
      JSON.stringify(profile),
      now,
      now,
      providerId,
      managerId,
    );
}

function update(
  db,
  id,
  providerId = "provider-a",
  managerId = `manager-${providerId}`,
) {
  const profile = { ...cleanParticipantInput({ name: "Updated profile" }), id };
  return db
    .prepare(updateProviderParticipantQuery)
    .run(JSON.stringify(profile), now, id, providerId, providerId, managerId);
}

test("participant setup requires only a name and leaves unspecified care details empty", () => {
  assert.deepEqual(
    cleanParticipantInput({
      name: "  Example Participant  ",
      id: "untrusted",
      providerId: "untrusted",
    }),
    {
      name: "Example Participant",
      ndis: "",
      setting: "",
      conditions: [],
      risks: [],
      communication: "",
      mealtimePlan: "",
      behaviourPlan: false,
      medications: [],
      goals: [],
      plan: [],
      dateOfBirth: null,
    },
  );
  for (const participant of participants) {
    const { id, ...profile } = participant;
    assert.ok(id);
    assert.deepEqual(cleanParticipantInput(participant), profile);
  }
});

test("participant validation rejects malformed profiles and impossible dates", () => {
  for (const profile of [
    null,
    [],
    "name",
    {},
    { name: " " },
    { name: "x".repeat(121) },
    { name: "Example\u0000Participant" },
    { name: "Example", conditions: "a condition" },
    { name: "Example", risks: [null] },
    { name: "Example", goals: Array(101).fill("goal") },
    { name: "Example", behaviourPlan: "true" },
    { name: "Example", dateOfBirth: "2025-02-29" },
    { name: "Example", dateOfBirth: "2000-13-01" },
    { name: "Example", dateOfBirth: "9999-01-01" },
    { name: "Example", dateOfBirth: 2020 },
    { name: "Example", medications: [{ name: "", routine: true }] },
    {
      name: "Example",
      medications: [{ name: "Recorded medicine", routine: "false" }],
    },
    { name: "Example", seizureProtocol: {} },
    { name: "Example", risks: Array(100).fill("x".repeat(2000)) },
  ])
    assert.throws(() => cleanParticipantInput(profile));
  assert.equal(
    cleanParticipantInput({ name: "Example", dateOfBirth: "2000-02-29" })
      .dateOfBirth,
    "2000-02-29",
  );
  assert.equal(
    cleanParticipantInput({ name: "Example", dateOfBirth: "" }).dateOfBirth,
    null,
  );
});

test("plan validation preserves supplied details and does not infer authorisation", () => {
  const item = {
    id: "RP-1",
    category: "recorded category",
    description: "Recorded plan",
  };
  const result = cleanParticipantInput({ name: "Example", plan: [item] });
  assert.deepEqual(result.plan, [
    { ...item, behaviour: "", authorised: false },
  ]);
  for (const plan of [
    [item, item],
    [{ ...item, maxMinutes: -1 }],
    [{ ...item, maxDoseMg: Infinity }],
    [{ ...item, maxDoseMg: "0.5" }],
    [{ ...item, maxUses24h: 1.5 }],
    [{ ...item, authorised: "yes" }],
  ])
    assert.throws(() => cleanParticipantInput({ name: "Example", plan }));
});

test("participants are read and updated only within their provider", () => {
  const db = fixture();
  try {
    assert.equal(create(db, "a").changes, 1);
    assert.equal(create(db, "b", "provider-b").changes, 1);
    assert.deepEqual(
      db
        .prepare(providerParticipantsQuery)
        .all("provider-a")
        .map((row) => row.id),
      ["a"],
    );
    assert.equal(
      db.prepare(providerParticipantQuery).get("provider-a", "b"),
      undefined,
    );
    assert.equal(update(db, "b").changes, 0);
    assert.equal(
      update(db, "a", "provider-a", "manager-provider-b").changes,
      0,
    );
    assert.equal(
      create(db, "wrong", "provider-a", "manager-provider-b").changes,
      0,
    );
    assert.equal(
      create(db, "worker-attempt", "provider-a", "worker-a").changes,
      0,
    );
    assert.equal(update(db, "a").changes, 1);
    assert.equal(
      JSON.parse(
        db.prepare(providerParticipantQuery).get("provider-a", "a")
          .profile_json,
      ).name,
      "Updated profile",
    );
    assert.equal(
      JSON.parse(
        db.prepare(providerParticipantQuery).get("provider-b", "b")
          .profile_json,
      ).name,
      "Participant b",
    );
  } finally {
    db.close();
  }
});

test("revoked or unclaimed manager grants block participant writes at SQL execution", () => {
  for (const mutation of [
    "UPDATE provider_manager_grants SET active=0 WHERE provider_id='provider-a'",
    "UPDATE provider_manager_grants SET claimed_user_id=NULL WHERE provider_id='provider-a'",
    "UPDATE providers SET active=0 WHERE id='provider-a'",
  ]) {
    const db = fixture();
    try {
      create(db, "existing");
      db.exec(mutation);
      assert.equal(create(db, "attempt").changes, 0);
      assert.equal(update(db, "existing").changes, 0);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM provider_participants").get()
          .count,
        1,
      );
      assert.equal(
        JSON.parse(
          db.prepare("SELECT profile_json FROM provider_participants").get()
            .profile_json,
        ).name,
        "Participant existing",
      );
    } finally {
      db.close();
    }
  }
});

test("inactive participants and providers are excluded and profile identity cannot change", () => {
  const db = fixture();
  try {
    create(db, "a");
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE provider_participants SET profile_json=? WHERE id='a'",
          )
          .run(JSON.stringify({ name: "Missing ID" })),
      /CHECK/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE provider_participants SET profile_json=? WHERE id='a'",
          )
          .run(JSON.stringify({ id: "different", name: "Changed ID" })),
      /CHECK/,
    );
    db.exec("UPDATE provider_participants SET active=0 WHERE id='a'");
    assert.deepEqual(
      db.prepare(providerParticipantsQuery).all("provider-a"),
      [],
    );
    assert.equal(
      db.prepare(providerParticipantQuery).get("provider-a", "a"),
      undefined,
    );
    assert.equal(update(db, "a").changes, 0);
    create(db, "b");
    db.exec("UPDATE providers SET active=0 WHERE id='provider-a'");
    assert.deepEqual(
      db.prepare(providerParticipantsQuery).all("provider-a"),
      [],
    );
  } finally {
    db.close();
  }
});

test("worker directory includes only active memberships matching the current profile provider", () => {
  const db = fixture();
  try {
    for (const [id, provider] of [
      ["worker-a", "provider-a"],
      ["worker-b", "provider-b"],
      ["revoked", "provider-a"],
      ["moved", "provider-b"],
    ]) {
      db.prepare("INSERT INTO app_profiles VALUES (?,?,?,?,?)").run(
        id,
        `Name ${id}`,
        provider,
        now,
        now,
      );
      db.prepare("INSERT INTO provider_memberships VALUES (?,?,1,?,?)").run(
        provider,
        id,
        now,
        now,
      );
    }
    db.prepare(
      "INSERT INTO provider_memberships VALUES ('provider-a','moved',1,?,?)",
    ).run(now, now);
    db.exec("UPDATE provider_memberships SET active=0 WHERE user_id='revoked'");
    assert.deepEqual(
      db
        .prepare(providerWorkersQuery)
        .all("provider-a")
        .map((row) => ({ ...row })),
      [{ userId: "worker-a", fullName: "Name worker-a" }],
    );
    db.exec("UPDATE providers SET active=0 WHERE id='provider-a'");
    assert.deepEqual(db.prepare(providerWorkersQuery).all("provider-a"), []);
  } finally {
    db.close();
  }
});

test("monthly use totals distinguish matching names and attach only unambiguous legacy records", () => {
  const profile = cleanParticipantInput({
    name: "Same name",
    plan: [{ id: "RP-1", category: "Recorded", description: "Recorded plan" }],
  });
  const directory = [
    { ...profile, id: "one" },
    { ...profile, id: "two" },
  ];
  const uses = [
    {
      participantId: "one",
      legacyParticipantName: null,
      item: "RP-1",
      count: 2,
    },
    {
      participantId: "two",
      legacyParticipantName: null,
      item: "RP-1",
      count: 5,
    },
    {
      participantId: null,
      legacyParticipantName: "Same name",
      item: "RP-1",
      count: 7,
    },
  ];
  assert.deepEqual(
    monthlyParticipantUses(directory, uses, "2026-09").map(
      (item) => item.recordedUses,
    ),
    [2, 5],
  );
  assert.equal(
    monthlyParticipantUses([directory[0]], uses, "2026-09")[0].recordedUses,
    9,
  );
});
