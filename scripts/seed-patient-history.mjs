import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanParticipantInput } from "../lib/roster/participants.ts";
import {
  applyFieldPatch,
  checkForm,
  definitions,
  emptyFields,
  FORM_VERSION,
} from "../lib/notes/form.ts";
import { emptySafety, retentionUntil } from "../lib/notes/safety.ts";
import { validLocalTime } from "../lib/roster/shifts.ts";
import {
  TEST_ACCOUNTS,
  TEST_PROVIDER_ID,
  TEST_PROVIDER_NAME,
} from "../lib/auth/test-accounts.ts";

export const DATASET_ID = "sarah-doyle-history-v1";
export const PARTICIPANT_ID = "829d744b-71e8-4c82-9ca4-3c999004982c";
const FIXTURE_URL = new URL(
  "../fixtures/sarah-doyle-history.json",
  import.meta.url,
);
const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const HISTORICAL_CUTOFF = "2026-09-13T00:00";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER = TEST_ACCOUNTS.find((account) => account.role === "worker");
const MANAGER = TEST_ACCOUNTS.find((account) => account.role === "manager");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function validInstant(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().replace(".000Z", "Z") ===
      value.replace(".000Z", "Z")
  );
}

// Intl gives the actual Melbourne wall time (including DST); comparisons never
// depend on the timezone of the machine running this script.
export function melbourneTime(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function validateHistory(dataset) {
  invariant(
    dataset && typeof dataset === "object",
    "A history fixture is required.",
  );
  invariant(
    dataset.datasetId === DATASET_ID && dataset.synthetic === true,
    "Only the explicitly synthetic Sarah Doyle dataset is supported.",
  );
  invariant(
    dataset.timezone === "Australia/Melbourne",
    "Use Australia/Melbourne.",
  );
  invariant(
    dataset.providerId === TEST_PROVIDER_ID &&
      dataset.workerId === WORKER.id &&
      dataset.workerName === WORKER.name &&
      dataset.managerId === MANAGER.id,
    "The fixture must use the existing test account scope.",
  );
  invariant(
    dataset.participant?.id === PARTICIPANT_ID &&
      dataset.participant.name === "Sarah Doyle (fictional demo)",
    "The fixture must identify the single fictional demo participant.",
  );
  const { id, ...profile } = dataset.participant;
  assert.deepEqual(
    cleanParticipantInput(profile),
    profile,
    "Participant input must already be complete and normalized.",
  );
  invariant(
    Array.isArray(dataset.notes) && dataset.notes.length === 10,
    "The dataset must contain exactly 10 notes.",
  );
  const ids = new Set([id]);
  let previousExpectedEnd = "";
  let previousActualEnd = "";
  let previousConfirmedAt = "";
  for (const note of dataset.notes) {
    for (const key of ["id", "shiftId"]) {
      invariant(
        UUID.test(note[key]) && !ids.has(note[key]),
        `Every note and shift needs a unique UUID (${key}).`,
      );
      ids.add(note[key]);
    }
    invariant(
      note.participantId === undefined || note.participantId === id,
      "All notes must belong to the same participant.",
    );
    invariant(
      note.providerId === undefined || note.providerId === dataset.providerId,
      "All notes must belong to TestProvider.",
    );
    const fields = applyFieldPatch(emptyFields(), note.fields);
    assert.deepEqual(
      fields,
      note.fields,
      "Keep complete, normalized author-entered fields.",
    );
    invariant(
      fields.participant === dataset.participant.name,
      "Every note must use the fictional participant name.",
    );
    const form = checkForm(fields);
    invariant(
      form.ready,
      `Incomplete note ${note.id}: ${JSON.stringify(form.issues)}`,
    );
    invariant(
      fields.incidents !== "unanswered" && fields.followUp !== "unanswered",
      "Each fixture must explicitly select its incident and follow-up state.",
    );
    // A completed follow-up can legitimately retain handover detail while its
    // current status is "none". Preserve that authored history as the app does.
    invariant(
      (fields.incidents !== "yes" || Boolean(fields.incidentDetails)) &&
        (fields.followUp !== "needed" || Boolean(fields.followUpDetails)),
      "A recorded concern or follow-up needs its supporting detail.",
    );
    invariant(
      validLocalTime(note.expectedStart) &&
        validLocalTime(note.expectedEnd) &&
        note.expectedStart < note.expectedEnd &&
        note.expectedEnd < HISTORICAL_CUTOFF &&
        fields.shiftEnd < HISTORICAL_CUTOFF,
      "All planned and actual shifts must end before 13 September 2026.",
    );
    invariant(
      note.expectedStart >= previousExpectedEnd &&
        fields.shiftStart >= previousActualEnd,
      "Notes must be chronological, with no overlapping shifts.",
    );
    invariant(
      validInstant(note.recordedAt) &&
        validInstant(note.simulatedConfirmedAt) &&
        Date.parse(note.recordedAt) <= Date.parse(note.simulatedConfirmedAt) &&
        (!previousConfirmedAt ||
          Date.parse(note.recordedAt) >= Date.parse(previousConfirmedAt)) &&
        melbourneTime(note.recordedAt) >= fields.shiftEnd &&
        melbourneTime(note.simulatedConfirmedAt) < HISTORICAL_CUTOFF,
      "Recording and simulated confirmation times must follow the actual shift chronologically.",
    );
    for (const key of ["topics", "continuity"]) {
      invariant(
        Array.isArray(note[key]) &&
          note[key].length > 0 &&
          note[key].every(
            (value) =>
              typeof value === "string" &&
              value.trim() === value &&
              value.length > 0,
          ),
        `Provide authored ${key} metadata for each note.`,
      );
    }
    previousExpectedEnd = note.expectedEnd;
    previousActualEnd = fields.shiftEnd;
    previousConfirmedAt = note.simulatedConfirmedAt;
  }
  return dataset;
}

export async function readHistory() {
  return validateHistory(JSON.parse(await readFile(FIXTURE_URL, "utf8")));
}

export function buildHistoryRows(
  dataset,
  importedAt = new Date().toISOString(),
) {
  validateHistory(dataset);
  invariant(validInstant(importedAt), "Provide a valid import timestamp.");
  const snapshot = JSON.stringify(dataset.participant);
  // Historical timestamps describe the simulated fixture, not real care events.
  const participant = {
    id: dataset.participant.id,
    provider_id: dataset.providerId,
    profile_json: snapshot,
    active: 1,
    created_at: dataset.notes[0].recordedAt,
    updated_at: dataset.notes[0].recordedAt,
  };
  const shifts = [];
  const notes = [];
  for (const note of dataset.notes) {
    shifts.push({
      id: note.shiftId,
      provider_id: dataset.providerId,
      participant_id: dataset.participant.id,
      worker_id: dataset.workerId,
      worker_name: dataset.workerName,
      expected_start: note.expectedStart,
      expected_end: note.expectedEnd,
      timezone: dataset.timezone,
      created_by: `synthetic_fixture:${dataset.datasetId}`,
      created_at: note.recordedAt,
    });
    const safety = emptySafety();
    for (const { key } of definitions) {
      const value = note.fields[key];
      safety.fieldStates[key] =
        !value || value === "unknown"
          ? "not_reviewed"
          : (key === "incidents" && value === "no") ||
              (key === "followUp" && value === "none")
            ? "stated_negative"
            : "stated_positive";
      if (safety.fieldStates[key] === "stated_negative") {
        safety.evidence[key] =
          `Synthetic fixture selection: ${key}=${value}; not a worker attestation.`;
      }
    }
    safety.syntheticFixture = {
      datasetId: dataset.datasetId,
      synthetic: true,
      topics: note.topics,
      continuity: note.continuity,
    };
    notes.push({
      id: note.id,
      owner_id: dataset.workerId,
      provider_id: dataset.providerId,
      shift_id: note.shiftId,
      participant_id: dataset.participant.id,
      participant_snapshot_json: snapshot,
      expected_start: note.expectedStart,
      expected_end: note.expectedEnd,
      worker_name: dataset.workerName,
      fields_json: JSON.stringify(note.fields),
      revision: 1,
      status: "complete",
      form_version: FORM_VERSION,
      timezone: dataset.timezone,
      created_at: note.recordedAt,
      updated_at: note.simulatedConfirmedAt,
      confirmed_at: note.simulatedConfirmedAt,
      confirmation_id: null,
      review_version: 1,
      confirmation_evidence: JSON.stringify({
        method: "synthetic_fixture",
        synthetic: true,
        datasetId: dataset.datasetId,
        importedAt,
        simulatedConfirmedAt: note.simulatedConfirmedAt,
        source: "fixtures/sarah-doyle-history.json",
        notice:
          "Authored demo history; no real worker confirmation, transcript, or manager review occurred.",
      }),
      safety_json: JSON.stringify(safety),
      mutation_id: null,
      retention_until: retentionUntil(
        note.simulatedConfirmedAt,
        dataset.participant.dateOfBirth,
      ),
    });
  }
  return { participant, shifts, notes };
}

// Read-only identity checks; this script never creates/updates auth or grants.
const activeTestScope = `EXISTS (
  SELECT 1 FROM providers AS p
  JOIN app_profiles AS profile ON profile.provider_id=p.id
  JOIN provider_memberships AS membership ON membership.provider_id=p.id
    AND membership.user_id=profile.user_id AND membership.active=1
  JOIN auth_user AS worker ON worker.id=profile.user_id
  JOIN provider_manager_grants AS grant_row ON grant_row.provider_id=p.id AND grant_row.active=1
  JOIN auth_user AS manager ON manager.id=grant_row.claimed_user_id
  WHERE p.id=? AND p.name=? AND p.active=1
    AND profile.user_id=? AND profile.full_name=? AND worker.email=? AND worker.email_verified=1
    AND grant_row.claimed_user_id=? AND grant_row.email=? AND manager.email=? AND manager.email_verified=1
)`;
const scopeParams = [
  TEST_PROVIDER_ID,
  TEST_PROVIDER_NAME,
  WORKER.id,
  WORKER.name,
  WORKER.email,
  MANAGER.id,
  MANAGER.email,
  MANAGER.email,
];

async function savedRows(db, rows) {
  const marks = rows.notes.map(() => "?").join(",");
  const [participant, shifts, notes] = await Promise.all([
    db
      .prepare("SELECT * FROM provider_participants WHERE id=?")
      .bind(rows.participant.id)
      .first(),
    db
      .prepare(`SELECT * FROM scheduled_shifts WHERE id IN (${marks})`)
      .bind(...rows.shifts.map((row) => row.id))
      .all(),
    db
      .prepare(
        `SELECT * FROM shift_notes WHERE id IN (${marks}) OR shift_id IN (${marks})`,
      )
      .bind(
        ...rows.notes.map((row) => row.id),
        ...rows.shifts.map((row) => row.id),
      )
      .all(),
  ]);
  return { participant, shifts: shifts.results, notes: notes.results };
}

function comparable(row) {
  const result = { ...row };
  for (const key of [
    "profile_json",
    "fields_json",
    "participant_snapshot_json",
    "safety_json",
    "confirmation_evidence",
  ]) {
    if (result[key] !== undefined) result[key] = JSON.parse(result[key]);
  }
  if (result.confirmation_evidence) {
    invariant(
      validInstant(result.confirmation_evidence.importedAt),
      "Stored import timestamp is invalid.",
    );
    delete result.confirmation_evidence.importedAt;
  }
  return result;
}

function verifyRows(saved, expected) {
  invariant(
    saved.participant &&
      saved.shifts.length === 10 &&
      saved.notes.length === 10,
    "Partial history or fixture ID collision found; no existing records will be changed.",
  );
  const compare = (actual, wanted) => {
    try {
      assert.deepEqual(comparable(actual), comparable(wanted));
    } catch {
      throw new Error(
        `Fixture conflict in record ${wanted.id}; no existing records will be changed.`,
      );
    }
  };
  compare(saved.participant, expected.participant);
  for (const key of ["shifts", "notes"]) {
    const byId = new Map(saved[key].map((row) => [row.id, row]));
    for (const wanted of expected[key]) {
      invariant(
        byId.has(wanted.id),
        `Fixture ID collision: missing ${wanted.id}.`,
      );
      compare(byId.get(wanted.id), wanted);
    }
  }
}

function insertStatement(db, table, row, guardScope = false) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?");
  const params = Object.values(row);
  if (guardScope) {
    // Force a NOT NULL failure and roll back the entire D1 batch if access is
    // revoked after the preflight check. A SELECT ... WHERE could silently skip.
    placeholders[0] = `(CASE WHEN ${activeTestScope} THEN ? ELSE NULL END)`;
    params.unshift(...scopeParams);
  }
  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders.join(",")})`,
    )
    .bind(...params);
}

function summary(dataset, inserted) {
  return {
    datasetId: dataset.datasetId,
    synthetic: true,
    providerId: dataset.providerId,
    participantId: dataset.participant.id,
    participant: dataset.participant.name,
    worker: dataset.workerName,
    timezone: dataset.timezone,
    firstShift: dataset.notes[0].fields.shiftStart,
    lastShift: dataset.notes.at(-1).fields.shiftEnd,
    participants: 1,
    shifts: 10,
    notes: 10,
    inserted,
  };
}

export async function importHistory(
  db,
  dataset,
  importedAt = new Date().toISOString(),
) {
  const rows = buildHistoryRows(dataset, importedAt);
  const scope = await db
    .prepare(`SELECT ${activeTestScope} AS allowed`)
    .bind(...scopeParams)
    .first();
  invariant(
    scope?.allowed === 1,
    "Existing active TestProvider, Test Support Worker, and Test Manager grant are required; nothing was provisioned.",
  );
  const saved = await savedRows(db, rows);
  if (saved.participant || saved.shifts.length || saved.notes.length) {
    verifyRows(saved, rows);
    return summary(dataset, 0);
  }
  const statements = [
    insertStatement(db, "provider_participants", rows.participant, true),
    ...rows.shifts.map((row) => insertStatement(db, "scheduled_shifts", row)),
    ...rows.notes.map((row) => insertStatement(db, "shift_notes", row)),
  ];
  // D1 batch is a single transaction: a conflict/constraint error rolls back all
  // 21 inserts. No upserts, deletes, evidence fabrication, or schema changes.
  await db.batch(statements);
  verifyRows(await savedRows(db, rows), rows);
  return summary(dataset, 21);
}

async function runLocal(dataset) {
  // Read the build's binding identity only. Never load vars, secrets, auth, or a
  // remote binding. This mirrors Wrangler --local's persisted D1 identity.
  const config = JSON.parse(
    await readFile(resolve(WEB_ROOT, "dist/server/wrangler.json"), "utf8"),
  );
  const bindings = config.d1_databases?.filter(
    (binding) => binding.binding === "DB",
  );
  invariant(
    bindings?.length === 1,
    "Build config must define exactly one DB binding.",
  );
  const databaseId = bindings[0].preview_database_id ?? bindings[0].database_id;
  invariant(
    typeof databaseId === "string" && databaseId.length > 0,
    "Local DB identity is missing.",
  );
  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({
    modules: true,
    script:
      "export default { fetch() { return new Response('Local synthetic history importer'); } };",
    compatibilityDate: "2026-05-15",
    host: "127.0.0.1",
    port: 0,
    cf: false,
    outboundService: () =>
      new Response("Network access disabled", { status: 403 }),
    d1Databases: { DB: databaseId },
    d1Persist: resolve(WEB_ROOT, ".wrangler/state/v3/d1"),
  });
  try {
    return await importHistory(await mf.getD1Database("DB"), dataset);
  } finally {
    await mf.dispose();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const args = process.argv.slice(2);
  invariant(
    args.length <= 1 &&
      (!args[0] || ["--check", "--local", "--help"].includes(args[0])),
    "Use --check (default), --local, or --help. Remote targets and custom paths are not supported.",
  );
  if (args[0] === "--help") {
    console.log(
      "Usage: node --experimental-strip-types scripts/seed-patient-history.mjs [--check|--local]\n--check validates the fixed synthetic fixture without opening a database.\n--local imports into this project's existing local TestProvider only; reruns verify and insert nothing.",
    );
  } else {
    const dataset = await readHistory();
    const result =
      args[0] === "--local"
        ? await runLocal(dataset)
        : {
            mode: "check",
            ...summary(dataset, 0),
          };
    console.log(JSON.stringify(result, null, 2));
  }
}
