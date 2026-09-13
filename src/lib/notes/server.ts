import { normalizeRiskResult } from "../assessment/result";
import { TEST_ACCOUNTS, TEST_PROVIDER_ID } from "../auth/test-accounts";
import { readableNoteAccess } from "../roster/access";
import {
  claimManagerGrants,
  type OrganisationUser,
} from "../roster/organisations-server";
import { createScheduledNoteQuery } from "../roster/shifts";
import { database, RequestError } from "../shared/server";
import {
  emptyFields,
  FORM_VERSION,
  type ShiftFields,
  type ShiftNote,
} from "./form";
import { readSafety, retentionUntil } from "./safety";
export type Row = {
  id: string;
  owner_id: string;
  provider_id: string | null;
  shift_id?: string | null;
  participant_id?: string | null;
  participant_snapshot_json?: string | null;
  expected_start?: string | null;
  expected_end?: string | null;
  provider_name?: string | null;
  worker_name: string;
  fields_json: string;
  revision: number;
  status: "draft" | "complete";
  form_version: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  confirmation_id: string | null;
  review_version: number | null;
  safety_json: string;
  retention_until: string | null;
  risk_flags_json?: string;
  question_count?: number;
  assessment_json?: string | null;
};
export function toNote(row: Row): ShiftNote {
  const fields = JSON.parse(row.fields_json) as ShiftFields;
  const safety = readSafety(row.safety_json);
  for (const key of ["incidents", "followUp"] as const) {
    if (
      (fields[key] === "no" || fields[key] === "none") &&
      safety.fieldStates[key] !== "stated_negative"
    )
      fields[key] = "unknown";
  }
  return {
    id: row.id,
    fields,
    revision: row.revision,
    status: row.status,
    formVersion: row.form_version,
    timezone: row.timezone,
    workerName: row.worker_name,
    providerId: row.provider_id ?? null,
    providerName: row.provider_name ?? null,
    shiftId: row.shift_id ?? null,
    participantId: row.participant_id ?? null,
    participantSnapshot: row.participant_snapshot_json
      ? JSON.parse(row.participant_snapshot_json)
      : null,
    expectedStart: row.expected_start ?? null,
    expectedEnd: row.expected_end ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    safety,
    riskFlags: JSON.parse(row.risk_flags_json ?? "[]"),
    clarificationCount: row.question_count ?? 0,
    retentionUntil: row.retention_until ?? retentionUntil(row.created_at),
    assessment: row.assessment_json
      ? normalizeRiskResult(JSON.parse(row.assessment_json))
      : null,
  };
}
const noteSelect =
  "SELECT shift_notes.*, (SELECT COALESCE(json_group_array(json(data_json)),'[]') FROM risk_events WHERE note_id=shift_notes.id) AS risk_flags_json, (SELECT COALESCE(SUM(question_count),0) FROM transcript_events WHERE note_id=shift_notes.id) AS question_count, (SELECT name FROM providers WHERE providers.id=shift_notes.provider_id) AS provider_name, (SELECT CASE WHEN a.status='ready' THEN a.result_json ELSE NULL END FROM shift_assessments a WHERE a.note_id=shift_notes.id AND a.owner_id=shift_notes.owner_id AND a.source_revision=shift_notes.revision AND (shift_notes.status<>'complete' OR EXISTS (SELECT 1 FROM assessment_reviews ar WHERE ar.confirmation_id=shift_notes.confirmation_id AND ar.assessment_id=a.id AND ar.assessment_revision=a.revision AND ar.source_revision=shift_notes.revision)) ORDER BY a.schema_version DESC,a.updated_at DESC LIMIT 1) AS assessment_json FROM shift_notes";
export async function getRow(id: string, ownerId: string) {
  const row = await database()
    .prepare(noteSelect + " WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<Row>();
  const testAccount = TEST_ACCOUNTS.find((account) => account.id === ownerId);
  if (
    !row ||
    (testAccount &&
      (testAccount.role !== "worker" || row.provider_id !== TEST_PROVIDER_ID))
  )
    throw new RequestError("This note could not be found.", 404);
  return row;
}
export async function getReadableRow(id: string, user: OrganisationUser) {
  await claimManagerGrants(user);
  const row = await database()
    .prepare(noteSelect + " WHERE shift_notes.id=? AND " + readableNoteAccess)
    .bind(id, user.userId, user.userId)
    .first<Row>();
  const testAccount = TEST_ACCOUNTS.find(
    (account) => account.id === user.userId,
  );
  if (
    !row ||
    (testAccount &&
      (row.provider_id !== TEST_PROVIDER_ID ||
        (testAccount.role === "worker" && row.owner_id !== user.userId)))
  )
    throw new RequestError("This note could not be found.", 404);
  return row;
}
export async function listNotes(ownerId: string) {
  const testAccount = TEST_ACCOUNTS.find((account) => account.id === ownerId);
  if (testAccount?.role === "manager") return [];
  const result = await database()
    .prepare(
      noteSelect +
        " WHERE owner_id = ?" +
        (testAccount ? " AND provider_id = ?" : "") +
        " ORDER BY updated_at DESC LIMIT 100",
    )
    .bind(...(testAccount ? [ownerId, TEST_PROVIDER_ID] : [ownerId]))
    .all<Row>();
  return result.results.map(toNote);
}
export async function listProviderNotes(providerId: string) {
  const result = await database()
    .prepare(
      noteSelect + " WHERE provider_id=? ORDER BY updated_at DESC LIMIT 100",
    )
    .bind(providerId)
    .all<Row>();
  return result.results.map(toNote);
}
export async function createNote(
  id: unknown,
  ownerId: string,
  providerId: string,
  shiftId: unknown,
) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    throw new RequestError("Invalid note identifier.");
  if (typeof shiftId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(shiftId))
    throw new RequestError("Choose an assigned shift before starting a note.");
  const testAccount = TEST_ACCOUNTS.find((account) => account.id === ownerId);
  if (
    testAccount &&
    (testAccount.role !== "worker" || providerId !== TEST_PROVIDER_ID)
  )
    throw new RequestError("Test accounts belong to TestProvider.", 403);
  const now = new Date().toISOString();
  const assigned = await database()
    .prepare(
      "SELECT id FROM scheduled_shifts WHERE id=? AND worker_id=? AND provider_id=?",
    )
    .bind(shiftId, ownerId, providerId)
    .first();
  if (!assigned) throw new RequestError("Assigned shift not found.", 404);
  await database()
    .prepare(createScheduledNoteQuery)
    .bind(
      id,
      JSON.stringify(emptyFields()),
      FORM_VERSION,
      now,
      now,
      retentionUntil(now),
      shiftId,
      ownerId,
      providerId,
    )
    .run();
  const saved = await database()
    .prepare(
      "SELECT id FROM shift_notes WHERE shift_id=? AND owner_id=? AND provider_id=?",
    )
    .bind(shiftId, ownerId, providerId)
    .first<{ id: string }>();
  if (!saved)
    throw new RequestError(
      "This shift is no longer available for a new note. Refresh your shifts.",
      409,
    );
  return toNote(await getRow(saved.id, ownerId));
}
