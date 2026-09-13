import { env } from "cloudflare:workers";
import {
  database,
  getRow,
  identity,
  json,
  readBody,
  RequestError,
  toNote,
} from "./notes-server";
import {
  rejectRecorderDuringAssessment,
  noCurrentAssessmentSql,
} from "./assessment-server";
import {
  addWorkflowSource,
  applyWorkflowCasePatch,
  createWorkflowCase,
  validateWorkflowCase,
  workflowCaseContext,
  WorkflowCaseError,
  type WorkflowCase,
  type WorkflowCasePatch,
  type WorkflowSource,
} from "./workflow-case";

type CaseRow = {
  id: string;
  note_id: string;
  owner_id: string;
  state_json: string;
  revision: number;
  review_revision: number | null;
  reviewed_note_revision: number | null;
};
type SessionRow = {
  id: string;
  case_id: string;
  owner_id: string;
  expires_at: string;
  closed_at: string | null;
  conversation_id: string;
  version_id: string;
  tool_calls: number;
};
type Receipt = {
  event_id: string | null;
  accepted_revision: number | null;
  error_code: string | null;
  attempts: number;
};
const now = () => new Date().toISOString();
const editableCaseSql = `EXISTS(SELECT 1 FROM shift_notes WHERE id=workflow_cases.note_id AND owner_id=workflow_cases.owner_id AND status='draft' AND ${noCurrentAssessmentSql})`;
function setting(key: string) {
  return (
    (env as unknown as Record<string, string | undefined>)[key] ??
    process.env[key]
  );
}
export function workflowEnabled() {
  return setting("LEGALMATE_WORKFLOW_ENABLED") === "true";
}
function requireWorkflowEnabled() {
  if (!workflowEnabled())
    throw new RequestError("Workflow testing is not enabled.", 404);
}
export async function workflowCaseForNote(noteId: string, ownerId: string) {
  requireWorkflowEnabled();
  const note = await getRow(noteId, ownerId);
  if (note.status !== "draft")
    throw new RequestError("Choose an editable draft.", 409);
  await rejectRecorderDuringAssessment(noteId, ownerId);
  const row = await database()
    .prepare("SELECT * FROM workflow_cases WHERE note_id=? AND owner_id=?")
    .bind(noteId, ownerId)
    .first<CaseRow>();
  return {
    note: toNote(note),
    case: row ? validateWorkflowCase(JSON.parse(row.state_json)) : null,
    reviewed: Boolean(
      row &&
        row.review_revision === row.revision &&
        row.reviewed_note_revision === note.revision,
    ),
  };
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
function compact(state: WorkflowCase) {
  const packet = workflowCaseContext(state);
  // Each node already contains its own field definitions; avoid sending all six
  // dictionaries and hundreds of untouched values with every tool response.
  const context = {
    ...state,
    evidence_instruction: packet.evidence_instruction,
  };
  return {
    ...context,
    events: context.events.map((event) => ({
      ...event,
      shared_fields: Object.fromEntries(
        Object.entries(event.shared_fields).filter(
          ([, field]) => field.state !== "not_discussed",
        ),
      ),
      risk_forms: Object.fromEntries(
        Object.entries(event.risk_forms).map(([type, form]) => [
          type,
          {
            ...form!,
            fields: Object.fromEntries(
              Object.entries(form!.fields).filter(
                ([, field]) => field.state !== "not_discussed",
              ),
            ),
          },
        ]),
      ),
    })),
  };
}
async function caseRow(id: string, ownerId: string) {
  const row = await database()
    .prepare("SELECT * FROM workflow_cases WHERE id=? AND owner_id=?")
    .bind(id, ownerId)
    .first<CaseRow>();
  if (!row) throw new RequestError("Workflow case not found.", 404);
  const note = await getRow(row.note_id, ownerId);
  if (note.status !== "draft")
    throw new RequestError("This note is no longer editable.", 409);
  await rejectRecorderDuringAssessment(note.id, ownerId);
  return { row, note, state: validateWorkflowCase(JSON.parse(row.state_json)) };
}
async function ownedCase(request: Request, id: string) {
  requireWorkflowEnabled();
  const user = await identity(request);
  return { ...(await caseRow(id, user.userId)), user };
}
export async function startWorkflowSession(request: Request) {
  requireWorkflowEnabled();
  const user = await identity(request);
  const input = await readBody(request);
  if (
    typeof input.noteId !== "string" ||
    !["text", "voice"].includes(String(input.mode ?? "text"))
  )
    throw new RequestError("Choose a draft and connection mode.");
  const note = await getRow(input.noteId, user.userId);
  if (note.status !== "draft")
    throw new RequestError("Choose an editable draft.", 409);
  await rejectRecorderDuringAssessment(note.id, user.userId);
  const key = setting("ELEVENLABS_API_KEY"),
    agentId = setting("ELEVENLABS_WORKFLOW_AGENT_ID"),
    versionId = setting("ELEVENLABS_WORKFLOW_VERSION_ID");
  if (!key || !agentId || !versionId)
    throw new RequestError(
      "A tested workflow version must be configured first.",
      503,
    );
  const initial = createWorkflowCase({
    id: crypto.randomUUID(),
    note_id: note.id,
  });
  await database()
    .prepare(
      `INSERT OR IGNORE INTO workflow_cases (id,note_id,owner_id,state_json,revision,last_mutation_id,updated_at) SELECT ?,id,owner_id,?,0,?,? FROM shift_notes WHERE id=? AND owner_id=? AND status='draft' AND ${noCurrentAssessmentSql}`,
    )
    .bind(
      initial.id,
      JSON.stringify(initial),
      crypto.randomUUID(),
      now(),
      note.id,
      user.userId,
    )
    .run();
  const row = await database()
    .prepare("SELECT * FROM workflow_cases WHERE note_id=? AND owner_id=?")
    .bind(note.id, user.userId)
    .first<CaseRow>();
  if (!row) throw new RequestError("Workflow case unavailable.", 503);
  const mode = input.mode ?? "text";
  const url = new URL(
    `https://api.elevenlabs.io/v1/convai/conversation/${mode === "text" ? "get-signed-url" : "token"}`,
  );
  url.searchParams.set("agent_id", agentId);
  url.searchParams.set("version_id", versionId);
  if (mode === "text") url.searchParams.set("include_conversation_id", "true");
  const response = await fetch(url, {
    headers: { "xi-api-key": key },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new RequestError(
      "The workflow voice connection is unavailable.",
      503,
    );
  const connection = (await response.json()) as {
    signed_url?: string;
    token?: string;
    conversation_id?: string;
  };
  const conversationId =
    connection.conversation_id ??
    (connection.signed_url
      ? new URL(connection.signed_url).searchParams.get("conversation_id")
      : null);
  if (
    !conversationId ||
    !(mode === "text" ? connection.signed_url : connection.token)
  )
    throw new RequestError(
      "The workflow connection could not be verified.",
      503,
    );
  const secret = token(),
    id = crypto.randomUUID(),
    timestamp = now();
  const opened = await database().batch([
    database()
      .prepare(
        "UPDATE workflow_sessions SET closed_at=? WHERE case_id=? AND owner_id=? AND closed_at IS NULL",
      )
      .bind(timestamp, row.id, user.userId),
    database()
      .prepare(
        `INSERT INTO workflow_sessions (id,case_id,owner_id,token_hash,expires_at,conversation_id,agent_id,version_id,tool_calls) SELECT ?,id,owner_id,?,?,?,?,?,0 FROM workflow_cases WHERE id=? AND owner_id=? AND ${editableCaseSql}`,
      )
      .bind(
        id,
        await digest(secret),
        new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        conversationId,
        agentId,
        versionId,
        row.id,
        user.userId,
      ),
    database()
      .prepare(
        "UPDATE workflow_cases SET review_revision=NULL,reviewed_note_revision=NULL WHERE id=? AND owner_id=?",
      )
      .bind(row.id, user.userId),
  ]);
  if (!opened[1].meta.changes)
    throw new RequestError("The note moved to review while connecting.", 409);
  const { state } = await caseRow(row.id, user.userId);
  return json({
    sessionId: id,
    caseId: row.id,
    conversationId,
    versionId,
    mode,
    ...(mode === "text"
      ? { signedUrl: connection.signed_url }
      : { conversationToken: connection.token }),
    dynamicVariables: {
      secret__workflow_token: `Bearer ${secret}`,
      case_context: JSON.stringify({
        ...compact(state),
        participant: toNote(note).fields.participant,
        timezone: note.timezone,
      }),
    },
    context: compact(state),
  });
}
export async function readWorkflowCase(request: Request, id: string) {
  const { row, state, note } = await ownedCase(request, id);
  return json({
    case: state,
    context: compact(state),
    noteRevision: note.revision,
    reviewed:
      row.review_revision === row.revision &&
      row.reviewed_note_revision === note.revision,
  });
}
export async function changeWorkflowCase(request: Request, id: string) {
  requireWorkflowEnabled();
  const user = await identity(request);
  const input = await readBody(request);
  if (input.action === "close") {
    if (input.sessionId !== undefined && typeof input.sessionId !== "string")
      throw new RequestError("Supply a valid session ID.");
    await database()
      .prepare(
        "UPDATE workflow_sessions SET closed_at=? WHERE case_id=? AND owner_id=? AND closed_at IS NULL AND (? IS NULL OR id=?)",
      )
      .bind(
        now(),
        id,
        user.userId,
        input.sessionId ?? null,
        input.sessionId ?? null,
      )
      .run();
    return json({ ok: true });
  }
  const { row, state, note } = await caseRow(id, user.userId);
  if (input.expected_revision !== state.revision)
    throw new RequestError("Refresh the current workflow case.", 409);
  if (input.action === "review") {
    const active = await database()
      .prepare(
        "SELECT id FROM workflow_sessions WHERE case_id=? AND closed_at IS NULL AND expires_at>? LIMIT 1",
      )
      .bind(id, now())
      .first();
    if (active)
      throw new RequestError(
        "End the conversation before reviewing the saved risk forms.",
        409,
      );
    const result = await database()
      .prepare(
        `UPDATE workflow_cases SET review_revision=revision,reviewed_note_revision=? WHERE id=? AND owner_id=? AND revision=? AND ${editableCaseSql} AND EXISTS(SELECT 1 FROM shift_notes WHERE id=workflow_cases.note_id AND revision=?) AND NOT EXISTS(SELECT 1 FROM workflow_sessions WHERE case_id=workflow_cases.id AND closed_at IS NULL AND expires_at>?)`,
      )
      .bind(
        note.revision,
        id,
        row.owner_id,
        state.revision,
        note.revision,
        now(),
      )
      .run();
    if (!result.meta.changes)
      throw new RequestError("The case changed. Review again.", 409);
    return json({
      ok: true,
      case: state,
      reviewed: true,
      scope: "risk_form_drafts",
      noteConfirmed: false,
    });
  }
  let next: WorkflowCase;
  if (input.action === "source") {
    const source = input.source as WorkflowSource;
    if (
      !source ||
      !["worker_utterance", "worker_form_edit"].includes(source.kind)
    )
      throw new RequestError("Supply a worker statement or form edit.");
    next = addWorkflowSource(state, source);
  } else if (input.action === "patch") {
    next = applyWorkflowCasePatch(state, input.patch as WorkflowCasePatch, {
      event_id: crypto.randomUUID(),
    });
  } else throw new RequestError("Unknown workflow action.");
  if (next.revision !== state.revision) {
    const result = await database()
      .prepare(
        `UPDATE workflow_cases SET state_json=?,revision=?,last_mutation_id=?,review_revision=NULL,reviewed_note_revision=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND ${editableCaseSql}`,
      )
      .bind(
        JSON.stringify(next),
        next.revision,
        crypto.randomUUID(),
        now(),
        id,
        row.owner_id,
        state.revision,
      )
      .run();
    if (!result.meta.changes)
      throw new RequestError("The case changed. Refresh before saving.", 409);
  }
  return json({
    ok: true,
    case: next,
    context: compact(next),
    revision: next.revision,
  });
}
async function authenticateTool(request: Request) {
  requireWorkflowEnabled();
  const header = request.headers.get("authorization") ?? "";
  if (!/^Bearer [a-f0-9]{64}$/.test(header))
    throw new RequestError("Invalid workflow session.", 401);
  const session = await database()
    .prepare(
      "SELECT * FROM workflow_sessions WHERE token_hash=? AND closed_at IS NULL AND expires_at>?",
    )
    .bind(await digest(header.slice(7)), now())
    .first<SessionRow>();
  if (!session)
    throw new RequestError("Invalid or expired workflow session.", 401);
  const current = await caseRow(session.case_id, session.owner_id);
  const counted = await database()
    .prepare(
      "UPDATE workflow_sessions SET tool_calls=tool_calls+1 WHERE id=? AND closed_at IS NULL AND expires_at>? AND tool_calls<32",
    )
    .bind(session.id, now())
    .run();
  if (!counted.meta.changes)
    throw new RequestError(
      "Workflow tool limit reached. Resume from the saved form.",
      429,
    );
  return { session, ...current };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
export async function workflowTool(request: Request, kind: "context" | "save") {
  const { session, row, state } = await authenticateTool(request);
  if (kind === "context")
    return json({
      ok: true,
      context: compact(state),
      revision: state.revision,
    });
  const body = await readBody(request);
  const normalized = { ...body };
  try {
    normalized.fields_json = JSON.parse(String(body.fields_json));
  } catch {
    /* Validation below returns a structured repair result. */
  }
  const fingerprint = await digest(JSON.stringify(canonical(normalized)));
  const receipt = await database()
    .prepare(
      "SELECT * FROM workflow_receipts WHERE session_id=? AND fingerprint=?",
    )
    .bind(session.id, fingerprint)
    .first<Receipt>();
  const duplicate = async (accepted: Receipt) => {
    const fresh = await caseRow(row.id, row.owner_id);
    return json({
      ok: true,
      duplicate: true,
      event_id: accepted.event_id,
      accepted_revision: accepted.accepted_revision,
      revision: fresh.state.revision,
      context: compact(fresh.state),
    });
  };
  if (receipt?.accepted_revision != null) return duplicate(receipt);
  if (receipt && receipt.attempts >= 2)
    return json({
      ok: false,
      code: "retry_limit",
      action:
        "Stop retrying this write. Keep the saved data and ask the worker to resume in the form.",
      revision: state.revision,
      context: compact(state),
    });
  try {
    const generatedId = crypto.randomUUID();
    const next = applyWorkflowCasePatch(state, body as WorkflowCasePatch, {
      event_id: generatedId,
    });
    const eventId =
      typeof body.event_id === "string" ? body.event_id : generatedId;
    const mutation = crypto.randomUUID(),
      timestamp = now();
    // D1 batch is atomic. The receipt is inserted only if this CAS update won.
    const results = await database().batch([
      database()
        .prepare(
          `UPDATE workflow_cases SET state_json=?,revision=?,last_mutation_id=?,review_revision=NULL,reviewed_note_revision=NULL,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM workflow_sessions WHERE id=? AND closed_at IS NULL AND expires_at>?) AND ${editableCaseSql}`,
        )
        .bind(
          JSON.stringify(next),
          next.revision,
          mutation,
          timestamp,
          row.id,
          row.owner_id,
          state.revision,
          session.id,
          timestamp,
        ),
      database()
        .prepare(
          "INSERT INTO workflow_receipts (id,session_id,fingerprint,event_id,accepted_revision,attempts,created_at) SELECT ?,?,?,?,?,1,? WHERE EXISTS(SELECT 1 FROM workflow_cases WHERE id=? AND last_mutation_id=?) ON CONFLICT(session_id,fingerprint) DO UPDATE SET event_id=excluded.event_id,accepted_revision=excluded.accepted_revision,error_code=NULL,attempts=workflow_receipts.attempts+1",
        )
        .bind(
          crypto.randomUUID(),
          session.id,
          fingerprint,
          eventId,
          next.revision,
          timestamp,
          row.id,
          mutation,
        ),
    ]);
    if (!results[0].meta.changes)
      throw new WorkflowCaseError(
        "stale_revision",
        "The case or session changed while saving.",
      );
    return json({
      ok: true,
      event_id: eventId,
      revision: next.revision,
      context: compact(next),
    });
  } catch (error) {
    if (!(error instanceof WorkflowCaseError)) throw error;
    const accepted = await database()
      .prepare(
        "SELECT * FROM workflow_receipts WHERE session_id=? AND fingerprint=?",
      )
      .bind(session.id, fingerprint)
      .first<Receipt>();
    if (accepted?.accepted_revision != null) return duplicate(accepted);
    await database()
      .prepare(
        "INSERT INTO workflow_receipts (id,session_id,fingerprint,error_code,attempts,created_at) VALUES (?,?,?,?,1,?) ON CONFLICT(session_id,fingerprint) DO UPDATE SET attempts=workflow_receipts.attempts+1",
      )
      .bind(crypto.randomUUID(), session.id, fingerprint, error.code, now())
      .run();
    const fresh = await caseRow(row.id, row.owner_id);
    return json({
      ok: false,
      code: error.code,
      error: error.message,
      action:
        "Use the latest context and correct the rejected arguments once. Never repeat unchanged rejected arguments or claim a save succeeded.",
      revision: fresh.state.revision,
      context: compact(fresh.state),
    });
  }
}
export function workflowFailure(error: unknown) {
  if (error instanceof RequestError || error instanceof WorkflowCaseError)
    return json({ ok: false, error: error.message }, error.status);
  if (error instanceof SyntaxError)
    return json({ ok: false, error: "Invalid JSON." }, 400);
  // Do not log provider URLs, Authorization headers, source text or request bodies.
  return json(
    { ok: false, error: "Workflow storage is temporarily unavailable." },
    503,
  );
}
