import { env } from "cloudflare:workers";
import { getAppUser } from "@/lib/auth";
import {
  FORM_VERSION,
  emptyFields,
  type ShiftNote,
  type ShiftFields,
} from "./shift-form";
import { readSafety, retentionUntil } from "./safety";
import { isAllowedRequestOrigin } from "./request-origin";
import {
  createWorkerNoteQuery,
  readableNoteAccess,
} from "./organisation-access";
import { claimManagerGrants, type OrganisationUser } from "./organisations";
import { TEST_ACCOUNTS, TEST_PROVIDER_ID } from "./test-accounts";

export class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function database() {
  if (!env.DB)
    throw new RequestError(
      "Your notes are temporarily unavailable. Please try again.",
      503,
    );
  return env.DB;
}
export async function identity(request: Request) {
  const user = await getAppUser(new Headers(request.headers));
  if (!user)
    throw new RequestError("Sign in to create and save your notes.", 401);
  if (request.method !== "GET") {
    let allowedOrigin: boolean;
    try {
      allowedOrigin = isAllowedRequestOrigin(
        request.url,
        request.headers.get("origin"),
        env.LEGALMATE_PUBLIC_ORIGIN ?? process.env.LEGALMATE_PUBLIC_ORIGIN,
      );
    } catch {
      throw new RequestError(
        "Application origin is not configured correctly.",
        503,
      );
    }
    if (!allowedOrigin)
      throw new RequestError("This request could not be verified.", 403);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new RequestError("Expected a JSON request.", 415);
  }
  return user;
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function readBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 80000)
    throw new RequestError("This note is too large.", 413);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError("Expected a JSON object.");
  return value as Record<string, unknown>;
}
export function failure(error: unknown) {
  if (error instanceof RequestError)
    return json({ error: error.message }, error.status);
  if (error instanceof SyntaxError)
    return json({ error: "The request is not valid JSON." }, 400);
  console.error("Note request failed", error);
  return json(
    {
      error:
        "We couldn’t save or load your note. Your unsaved answers are still on this page. Please try again.",
    },
    503,
  );
}
export type Row = {
  id: string;
  owner_id: string;
  provider_id: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    safety,
    riskFlags: JSON.parse(row.risk_flags_json ?? "[]"),
    clarificationCount: row.question_count ?? 0,
    retentionUntil: row.retention_until ?? retentionUntil(row.created_at),
  };
}
const noteSelect =
  "SELECT shift_notes.*, (SELECT COALESCE(json_group_array(json(data_json)),'[]') FROM risk_events WHERE note_id=shift_notes.id) AS risk_flags_json, (SELECT COALESCE(SUM(question_count),0) FROM transcript_events WHERE note_id=shift_notes.id) AS question_count, (SELECT name FROM providers WHERE providers.id=shift_notes.provider_id) AS provider_name FROM shift_notes";
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
  workerName: string,
  providerId: string,
) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    throw new RequestError("Invalid note identifier.");
  const testAccount = TEST_ACCOUNTS.find((account) => account.id === ownerId);
  if (
    testAccount &&
    (testAccount.role !== "worker" || providerId !== TEST_PROVIDER_ID)
  )
    throw new RequestError("Test accounts belong to TestProvider.", 403);
  const now = new Date().toISOString();
  await database()
    .prepare(createWorkerNoteQuery)
    .bind(
      id,
      ownerId,
      workerName,
      JSON.stringify(emptyFields()),
      FORM_VERSION,
      "Australia/Melbourne",
      now,
      now,
      retentionUntil(now),
      providerId,
      ownerId,
      providerId,
    )
    .run();
  return toNote(await getRow(id, ownerId));
}
