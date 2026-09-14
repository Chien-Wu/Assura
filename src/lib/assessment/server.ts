import { database, RequestError } from "@/lib/shared/server";
import { env } from "cloudflare:workers";
import { readAssuraSetting } from "../shared/environment";
import { checkForm, recorderFields } from "../notes/form";
import { getRow, toNote, type Row } from "../notes/server";
import { createRiskParticipantBackground } from "./participant-background";
import {
  defaultRiskAssessmentModel,
  RiskAssessmentModelError,
  runRiskAssessmentModel,
} from "./model";
import {
  normalizeRiskResult,
  type RiskAssessment,
  type RiskModelInput,
  type RiskResult,
} from "./result";

const ASSESSMENT_SCHEMA_VERSION = 2;
const LEASE_MS = 120_000;
const MODEL_TIMEOUT_MS = 90_000;
export const noCurrentAssessmentSql =
  "NOT EXISTS (SELECT 1 FROM shift_assessments a WHERE a.note_id=shift_notes.id AND a.source_revision=shift_notes.revision AND a.schema_version=2)";
type AssessmentRow = {
  id: string;
  note_id: string;
  owner_id: string;
  source_revision: number;
  schema_version: number;
  revision: number;
  status: string;
  source_json: string;
  result_json: string | null;
  error: string | null;
  lease_token: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
};
function assessmentConfig() {
  return {
    apiKey: env.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    model:
      readAssuraSetting("AI2_MODEL", env, process.env) ||
      defaultRiskAssessmentModel,
  };
}
function configured() {
  const config = assessmentConfig();
  if (!config.apiKey?.trim())
    throw new RequestError(
      "The risk check needs setup. Your saved draft is safe.",
      503,
    );
  return { ...config, apiKey: config.apiKey };
}
export function validateRecorder(row: Row) {
  const issues = checkForm(toNote(row).fields).issues.filter((issue) =>
    (recorderFields as readonly string[]).includes(issue.field),
  );
  if (issues.length)
    throw new RequestError(issues.map((issue) => issue.message).join(" "), 422);
}
async function assessmentRow(
  noteId: string,
  ownerId: string,
  id?: unknown,
  schemaVersion?: number,
) {
  if (id !== undefined && typeof id !== "string")
    throw new RequestError("Choose the current risk check.", 409);
  return database()
    .prepare(
      "SELECT * FROM shift_assessments WHERE note_id=? AND owner_id=?" +
        (id ? " AND id=?" : "") +
        (schemaVersion ? " AND schema_version=?" : "") +
        " ORDER BY source_revision DESC,schema_version DESC LIMIT 1",
    )
    .bind(
      noteId,
      ownerId,
      ...(id ? [id] : []),
      ...(schemaVersion ? [schemaVersion] : []),
    )
    .first<AssessmentRow>();
}
function parsedResult(row: AssessmentRow) {
  try {
    return row.result_json
      ? normalizeRiskResult(JSON.parse(row.result_json))
      : null;
  } catch {
    return null;
  }
}
function dto(row: AssessmentRow, note: Row): RiskAssessment {
  const result = parsedResult(row);
  const stale =
    row.source_revision !== note.revision ||
    (row.schema_version !== ASSESSMENT_SCHEMA_VERSION &&
      note.status !== "complete");
  const expired =
    row.status === "running" &&
    (!row.lease_until || row.lease_until <= new Date().toISOString());
  const invalid = row.status === "ready" && !result;
  return {
    id: row.id,
    noteId: row.note_id,
    sourceRevision: row.source_revision,
    revision: row.revision,
    schemaVersion: row.schema_version,
    status:
      stale || row.status === "needs_answer"
        ? "stale"
        : expired || invalid
          ? "failed"
          : (row.status as RiskAssessment["status"]),
    result,
    error: invalid
      ? "The saved risk result could not be verified."
      : expired
        ? "The risk check stopped before finishing. Retry the saved draft."
        : row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
// Other-worker readers must obtain getReadableRow before passing its owner ID.
export async function readAssessment(noteId: string, ownerId: string) {
  const note = await getRow(noteId, ownerId);
  const row = await assessmentRow(noteId, ownerId);
  return row ? dto(row, note) : null;
}
export async function readAssessmentAudit(noteId: string, ownerId: string) {
  await getRow(noteId, ownerId);
  const rows = await database()
    .prepare(
      "SELECT id,source_revision,schema_version,source_json,result_json,created_at FROM shift_assessments WHERE note_id=? AND owner_id=? ORDER BY source_revision,schema_version",
    )
    .bind(noteId, ownerId)
    .all<{
      id: string;
      source_revision: number;
      schema_version: number;
      source_json: string;
      result_json: string | null;
      created_at: string;
    }>();
  return Promise.all(
    rows.results.map(async (row) => ({
      id: row.id,
      sourceRevision: row.source_revision,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
      source: JSON.parse(row.source_json),
      result: row.result_json ? JSON.parse(row.result_json) : null,
      messages: (
        await database()
          .prepare(
            "SELECT id,role,text,question_id AS questionId,created_at AS createdAt FROM assessment_messages WHERE assessment_id=? ORDER BY rowid",
          )
          .bind(row.id)
          .all()
      ).results,
      runs: (
        await database()
          .prepare(
            "SELECT * FROM assessment_runs WHERE assessment_id=? ORDER BY rowid",
          )
          .bind(row.id)
          .all()
      ).results,
    })),
  );
}
export async function assessmentPayload(noteId: string, ownerId: string) {
  const note = await getRow(noteId, ownerId);
  const row = await assessmentRow(noteId, ownerId);
  return {
    note: toNote(note),
    assessment: row ? dto(row, note) : null,
    enabled: Boolean(assessmentConfig().apiKey?.trim()),
  };
}
export async function rejectRecorderDuringAssessment(
  noteId: string,
  ownerId: string,
) {
  const note = await getRow(noteId, ownerId);
  const found = await database()
    .prepare(
      "SELECT id FROM shift_assessments WHERE note_id=? AND owner_id=? AND source_revision=? AND schema_version=2",
    )
    .bind(noteId, ownerId, note.revision)
    .first();
  if (found)
    throw new RequestError(
      "This saved version has reached review. Edit and save the note before recording changes.",
      409,
    );
}
async function sourceSnapshot(row: Row) {
  const note = toNote(row);
  const transcript = await database()
    .prepare(
      "SELECT rowid AS cursor,id,role,content FROM transcript_events WHERE note_id=? AND owner_id=? ORDER BY rowid",
    )
    .bind(row.id, row.owner_id)
    .all<{ cursor: number; id: string; role: string; content: string }>();
  const legacy = await database()
    .prepare(
      "SELECT m.rowid AS cursor,m.id,m.role,m.text,m.question_id FROM assessment_messages m JOIN shift_assessments a ON a.id=m.assessment_id WHERE a.note_id=? AND a.owner_id=? AND a.schema_version=1 AND a.source_revision<=? ORDER BY m.rowid",
    )
    .bind(row.id, row.owner_id, row.revision)
    .all<{
      cursor: number;
      id: string;
      role: string;
      text: string;
      question_id: string | null;
    }>();
  const input: RiskModelInput = {
    participantBackground: createRiskParticipantBackground({
      snapshot: note.participantSnapshot,
      noteId: row.id,
      participantId: row.participant_id ?? null,
      capturedAt: row.created_at,
    }),
    note: {
      revision: row.revision,
      timezone: note.timezone,
      fields: note.fields,
      recorderTranscript: transcript.results.map(({ id, role, content }) => ({
        id,
        role,
        text: content,
      })),
      legacyInterviewTranscript: legacy.results.map(
        ({ id, role, text, question_id }) => ({
          id,
          role,
          text,
          questionId: question_id,
        }),
      ),
    },
    sources: [
      ...Object.entries(note.fields)
        .filter(([, text]) => text && text !== "unanswered")
        .map(([field, text]) => ({
          id: `note:${row.id}:${row.revision}:${field}`,
          text,
        })),
      ...transcript.results
        .filter((event) => event.role === "user")
        .map((event) => ({
          id: `transcript:${event.id}`,
          text: event.content,
        })),
      ...legacy.results
        .filter((message) => message.role === "user")
        .map((message) => ({
          id: `legacy-answer:${message.id}`,
          text: message.text,
        })),
    ],
  };
  return {
    input,
    cursor: transcript.results.at(-1)?.cursor ?? 0,
    legacyCursor: legacy.results.at(-1)?.cursor ?? 0,
  };
}
function currentSourceSql() {
  return "schema_version=2 AND EXISTS (SELECT 1 FROM shift_notes n WHERE n.id=shift_assessments.note_id AND n.owner_id=shift_assessments.owner_id AND n.revision=shift_assessments.source_revision AND n.status='draft')";
}
function lease() {
  return {
    token: crypto.randomUUID(),
    until: new Date(Date.now() + LEASE_MS).toISOString(),
    now: new Date().toISOString(),
  };
}
async function execute(
  row: AssessmentRow,
  config: ReturnType<typeof configured>,
) {
  const input = JSON.parse(row.source_json) as RiskModelInput;
  const token = row.lease_token!;
  const admitted = await database()
    .prepare(
      "INSERT INTO assessment_runs (id,assessment_id,assessment_revision,model,input_json,status,created_at) SELECT ?,?,?,?,?, 'running',? WHERE EXISTS (SELECT 1 FROM shift_assessments WHERE id=? AND lease_token=? AND revision=? AND status='running' AND " +
        currentSourceSql() +
        ")",
    )
    .bind(
      token,
      row.id,
      row.revision,
      config.model,
      JSON.stringify(input),
      row.updated_at,
      row.id,
      token,
      row.revision,
    )
    .run();
  if (!admitted.meta.changes) return;
  let output: RiskResult;
  try {
    output = await runRiskAssessmentModel(input, {
      apiKey: config.apiKey,
      model: config.model,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  } catch (cause) {
    const error =
      cause instanceof RiskAssessmentModelError
        ? cause.message
        : "The risk check could not finish. Your draft is safe. Please retry.";
    const now = new Date().toISOString();
    await database().batch([
      database()
        .prepare(
          "UPDATE shift_assessments SET status='failed',error=?,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND lease_token=? AND status='running' AND " +
            currentSourceSql(),
        )
        .bind(error, now, row.id, row.revision, token),
      database()
        .prepare(
          "UPDATE assessment_runs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'",
        )
        .bind(error, now, token),
    ]);
    return;
  }
  const now = new Date().toISOString();
  const resultJson = JSON.stringify(output);
  await database().batch([
    database()
      .prepare(
        "UPDATE shift_assessments SET status='ready',result_json=?,error=NULL,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND lease_token=? AND lease_until>? AND status='running' AND " +
          currentSourceSql(),
      )
      .bind(resultJson, now, row.id, row.revision, token, now),
    database()
      .prepare(
        "UPDATE assessment_runs SET result_json=?,status=CASE WHEN EXISTS (SELECT 1 FROM shift_assessments WHERE id=? AND revision=? AND result_json=? AND status='ready') THEN 'published' ELSE 'superseded' END,finished_at=? WHERE id=? AND status='running'",
      )
      .bind(resultJson, row.id, row.revision + 1, resultJson, now, token),
    ...output.risks.map((risk) =>
      database()
        .prepare(
          "INSERT INTO assessment_findings (id,assessment_id,type,ai_level,evidence_json,summary,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM assessment_runs WHERE id=? AND assessment_id=? AND status='published')",
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          risk.type,
          risk.level,
          JSON.stringify(risk.evidence),
          output.summary,
          now,
          token,
          row.id,
        ),
    ),
  ]);
}
export async function startAssessment(
  noteId: string,
  ownerId: string,
  revision: unknown,
) {
  const row = await getRow(noteId, ownerId);
  if (row.status !== "draft" || revision !== row.revision)
    throw new RequestError("Review the current saved draft.", 409);
  const existing = await assessmentRow(
    noteId,
    ownerId,
    undefined,
    ASSESSMENT_SCHEMA_VERSION,
  );
  if (existing?.source_revision === row.revision) return;
  validateRecorder(row);
  const config = configured();
  const { input, cursor, legacyCursor } = await sourceSnapshot(row);
  const id = crypto.randomUUID();
  const claim = lease();
  const result = await database().batch([
    database()
      .prepare(
        "INSERT OR IGNORE INTO shift_assessments (id,note_id,owner_id,source_revision,schema_version,revision,status,source_json,lease_token,lease_until,created_at,updated_at) SELECT ?,id,owner_id,revision,2,0,'running',?,?,?,?,? FROM shift_notes WHERE id=? AND owner_id=? AND revision=? AND status='draft' AND COALESCE((SELECT MAX(rowid) FROM transcript_events WHERE note_id=shift_notes.id AND owner_id=shift_notes.owner_id),0)=? AND COALESCE((SELECT MAX(m.rowid) FROM assessment_messages m JOIN shift_assessments a ON a.id=m.assessment_id WHERE a.note_id=shift_notes.id AND a.owner_id=shift_notes.owner_id AND a.schema_version=1 AND a.source_revision<=shift_notes.revision),0)=?",
      )
      .bind(
        id,
        JSON.stringify(input),
        claim.token,
        claim.until,
        claim.now,
        claim.now,
        noteId,
        ownerId,
        row.revision,
        cursor,
        legacyCursor,
      ),
    database()
      .prepare(
        "UPDATE voice_sessions SET expires_at=?,state_json=json_set(state_json,'$.closed',json('true'),'$.review',NULL),revision=revision+1 WHERE note_id=? AND owner_id=? AND EXISTS (SELECT 1 FROM shift_assessments WHERE id=?)",
      )
      .bind(claim.now, noteId, ownerId, id),
    database()
      .prepare(
        "UPDATE shift_notes SET confirmation_id=NULL,review_version=NULL WHERE id=? AND owner_id=? AND EXISTS (SELECT 1 FROM shift_assessments WHERE id=?)",
      )
      .bind(noteId, ownerId, id),
  ]);
  if (!result[0].meta.changes) {
    const winner = await assessmentRow(
      noteId,
      ownerId,
      undefined,
      ASSESSMENT_SCHEMA_VERSION,
    );
    if (winner?.source_revision === row.revision) return;
    throw new RequestError(
      "The saved account changed while starting its risk check. Review the saved draft again.",
      409,
    );
  }
  await execute((await assessmentRow(noteId, ownerId, id))!, config);
}
export async function advanceAssessment(
  noteId: string,
  ownerId: string,
  body: Record<string, unknown>,
) {
  const note = await getRow(noteId, ownerId);
  if (body.action !== "retry")
    throw new RequestError("AI2 no longer asks for additional answers.", 410);
  if (typeof body.assessmentId !== "string" || !body.assessmentId)
    throw new RequestError("Choose the current risk check.", 409);
  const row = await assessmentRow(noteId, ownerId, body.assessmentId);
  if (
    !row ||
    row.schema_version !== 2 ||
    row.source_revision !== note.revision ||
    note.status !== "draft"
  )
    throw new RequestError("Run the current saved note's risk check.", 409);
  if (body.revision !== row.revision)
    throw new RequestError("The check changed. Refresh before retrying.", 409);
  if (
    !(
      row.status === "failed" ||
      (row.status === "running" &&
        (!row.lease_until || row.lease_until <= new Date().toISOString()))
    )
  )
    throw new RequestError(
      "This check is already running or does not need a retry.",
      409,
    );
  const config = configured();
  const claim = lease();
  const result = await database().batch([
    database()
      .prepare(
        "UPDATE shift_assessments SET status='running',revision=revision+1,lease_token=?,lease_until=?,error=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND status=? AND " +
          currentSourceSql(),
      )
      .bind(
        claim.token,
        claim.until,
        claim.now,
        row.id,
        ownerId,
        row.revision,
        row.status,
      ),
    database()
      .prepare(
        "UPDATE shift_notes SET confirmation_id=NULL,review_version=NULL WHERE id=? AND owner_id=? AND EXISTS (SELECT 1 FROM shift_assessments WHERE id=? AND lease_token=?)",
      )
      .bind(noteId, ownerId, row.id, claim.token),
  ]);
  if (!result[0].meta.changes)
    throw new RequestError(
      "Another request arrived first. Refresh the saved check.",
      409,
    );
  await execute((await assessmentRow(noteId, ownerId, row.id))!, config);
}
export async function requireReadyAssessment(
  note: Row,
  id: unknown,
  revision: unknown,
) {
  if (typeof id !== "string" || !Number.isInteger(revision))
    throw new RequestError(
      "Wait for the saved note's risk check before confirming.",
      409,
    );
  const row = await assessmentRow(note.id, note.owner_id, id);
  if (
    !row ||
    row.schema_version !== 2 ||
    row.status !== "ready" ||
    row.source_revision !== note.revision ||
    row.revision !== revision ||
    !parsedResult(row)
  )
    throw new RequestError("Review the latest completed risk check.", 409);
  return dto(row, note);
}
