import { database, RequestError, type Row } from "./notes-server";
import { getVoiceSession, type VoiceSessionRow } from "./voice-server";
import {
  ensureKnowledgeScope,
  KnowledgeError,
  latestWorkerTurn,
  validateRetrievalSources,
} from "./knowledge-server";
import {
  cleanQuestionInput,
  cleanQuestionUpdates,
  normalizeQuestion,
  type QuestionStatus,
} from "./interview";
import type { VoiceEvent } from "./voice-state";
import type { KnowledgeSource } from "./knowledge";

type QuestionRow = {
  id: string;
  note_id: string;
  owner_id: string;
  session_id: string;
  retrieval_id: string;
  purpose_key: string;
  question_text: string;
  question_key: string;
  source_ids_json: string;
  status: QuestionStatus;
  note_revision: number;
  transcript_cursor: number;
  emitted_event_id: string | null;
  answer_event_id: string | null;
  answer_quote: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};
type RetrievalRow = {
  id: string;
  note_id: string;
  owner_id: string;
  session_id: string | null;
  note_revision: number;
  transcript_cursor: number;
  sources_json: string;
  status: string;
};
type WriteGuard = { sql: string; bindings: (string | number)[] };

const cursorSql =
  "COALESCE((SELECT MAX(rowid) FROM transcript_events WHERE note_id=? AND owner_id=? AND role='user'),0)";
const budgetSql = `(COALESCE((SELECT SUM(question_count) FROM transcript_events WHERE note_id=? AND owner_id=?),0)
  +(SELECT COUNT(*) FROM interview_questions WHERE note_id=? AND owner_id=? AND status='proposed'))`;

export function questionDto(row: QuestionRow) {
  return {
    id: row.id,
    purposeKey: row.purpose_key,
    question: row.question_text,
    status: row.status,
    sourceIds: JSON.parse(row.source_ids_json) as string[],
    retrievalId: row.retrieval_id,
    answerQuote: row.answer_quote,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function remainingClarifications(noteId: string, ownerId: string) {
  const result = await database()
    .prepare(`SELECT ${budgetSql} AS used`)
    .bind(noteId, ownerId, noteId, ownerId)
    .first<{ used: number }>();
  return Math.max(0, 3 - (result?.used ?? 0));
}

export async function listInterviewQuestions(noteId: string, ownerId: string) {
  const result = await database()
    .prepare(
      "SELECT * FROM interview_questions WHERE note_id=? AND owner_id=? ORDER BY created_at,id",
    )
    .bind(noteId, ownerId)
    .all<QuestionRow>();
  return result.results.map(questionDto);
}

function error(code: string, message: string, status = 409): never {
  throw new KnowledgeError(status, code, message);
}

export async function registerFollowup(
  noteId: string,
  ownerId: string,
  input: Record<string, unknown>,
) {
  let clean;
  try {
    clean = cleanQuestionInput(input);
  } catch (e) {
    error(
      "invalid_question",
      e instanceof Error ? e.message : "Invalid question.",
      400,
    );
  }
  const scope = await ensureKnowledgeScope(noteId, ownerId, {
    draftOnly: true,
  });
  if (input.revision !== scope.row.revision)
    error(
      "stale_context",
      "Get the current saved note before registering a question.",
    );
  const session = await getVoiceSession(input.voiceSessionId, ownerId, noteId);
  if (JSON.parse(session.state_json).closed)
    error("session_closed", "Resume the interview before using its tools.");
  const previous = await database()
    .prepare(
      "SELECT * FROM interview_questions WHERE note_id=? AND owner_id=? AND status!='cancelled' AND (purpose_key=? OR question_key=?)",
    )
    .bind(noteId, ownerId, clean.purposeKey, clean.questionKey)
    .first<QuestionRow>();
  if (previous) {
    if (
      previous.retrieval_id === clean.retrievalId &&
      previous.question_key === clean.questionKey &&
      previous.purpose_key === clean.purposeKey &&
      previous.source_ids_json === JSON.stringify(clean.sourceIds)
    ) {
      return {
        question: questionDto(previous),
        remainingClarifications: await remainingClarifications(noteId, ownerId),
        duplicate: true,
        canAsk: false,
        guidance:
          "This question was already registered. Respect its saved status; do not ask an emitted, answered or unknown question again.",
      };
    }
    error(
      "already_covered",
      "This purpose or question is already recorded. Read its status and avoid repeating it.",
    );
  }
  const run = await database()
    .prepare(
      "SELECT * FROM retrieval_runs WHERE id=? AND note_id=? AND owner_id=?",
    )
    .bind(clean.retrievalId, noteId, ownerId)
    .first<RetrievalRow>();
  if (!run || (run.session_id !== null && run.session_id !== session.id))
    error(
      "invalid_retrieval",
      "Use a retrieval returned for this note and session.",
      400,
    );
  const turn = await latestWorkerTurn(noteId, ownerId);
  if (
    !turn ||
    !turn.cursor ||
    turn.sessionId !== session.id ||
    run.note_revision !== scope.row.revision ||
    run.transcript_cursor !== turn.cursor
  )
    error(
      "stale_context",
      "The worker's statement or saved note has changed. Search again before proposing a question.",
    );
  const returned = JSON.parse(run.sources_json) as KnowledgeSource[];
  const sources = clean.sourceIds.map((sourceId) =>
    returned.find((source) => source.sourceId === sourceId),
  );
  if (sources.some((source) => !source))
    error(
      "invalid_source",
      "Cite only source IDs returned by this retrieval.",
      400,
    );
  if (
    !scope.cutoff ||
    !(await validateRetrievalSources(sources as KnowledgeSource[], scope))
  )
    error("stale_sources", "A source or its access changed. Search again.");
  const remaining = await remainingClarifications(noteId, ownerId);
  if (!remaining)
    error(
      "question_limit",
      "The clarification budget is exhausted. Preserve unresolved details and proceed to review.",
    );
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Scope, source versions, transcript and budget are checked again inside the
  // insert. A concurrent worker event or another tool cannot reserve a fourth
  // question or make a stale citation become current.
  const sourceGuards = (sources as KnowledgeSource[]).map(
    () =>
      `EXISTS (SELECT 1 FROM shift_notes source WHERE source.id=? AND source.revision=? AND source.status='complete' AND source.owner_id=? AND source.provider_id=? AND source.participant_id=? AND source.confirmed_at=? AND source.timezone='Australia/Melbourne')`,
  );
  const guard = `EXISTS (SELECT 1 FROM shift_notes n
    JOIN scheduled_shifts assigned ON assigned.id=n.shift_id AND assigned.worker_id=n.owner_id AND assigned.provider_id=n.provider_id AND assigned.participant_id=n.participant_id
    JOIN providers p ON p.id=n.provider_id AND p.active=1
    JOIN provider_memberships m ON m.provider_id=p.id AND m.user_id=n.owner_id AND m.active=1
    JOIN app_profiles profile ON profile.user_id=n.owner_id AND profile.provider_id=p.id
    JOIN provider_participants participant ON participant.id=n.participant_id AND participant.provider_id=p.id AND participant.active=1
    JOIN voice_sessions v ON v.id=? AND v.note_id=n.id AND v.owner_id=n.owner_id AND v.revision=? AND v.expires_at>?
    WHERE n.id=? AND n.owner_id=? AND n.revision=? AND n.status='draft' AND COALESCE(json_extract(v.state_json,'$.closed'),0)=0)
    AND ${cursorSql}=? AND ${budgetSql}<3 AND ${sourceGuards.join(" AND ")}`;
  const guardBindings = [
    session.id,
    session.revision,
    now,
    noteId,
    ownerId,
    scope.row.revision,
    noteId,
    ownerId,
    turn.cursor,
    noteId,
    ownerId,
    noteId,
    ownerId,
    ...(sources as KnowledgeSource[]).flatMap((s) => [
      s.noteId,
      s.revision,
      ownerId,
      scope.providerId,
      scope.participantId,
      s.confirmedAt,
    ]),
  ];
  const result = await database().batch([
    database()
      .prepare(
        `INSERT INTO interview_questions
      (id,note_id,owner_id,session_id,retrieval_id,purpose_key,question_text,question_key,source_ids_json,note_revision,transcript_cursor,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}
      ON CONFLICT DO NOTHING`,
      )
      .bind(
        id,
        noteId,
        ownerId,
        session.id,
        run.id,
        clean.purposeKey,
        clean.question,
        clean.questionKey,
        JSON.stringify(clean.sourceIds),
        scope.row.revision,
        turn.cursor,
        now,
        now,
        ...guardBindings,
      ),
    database()
      .prepare(
        "INSERT INTO interview_question_events (id,question_id,event_type,details_json,created_at) SELECT ?,?,'proposed',?,? WHERE EXISTS (SELECT 1 FROM interview_questions WHERE id=?)",
      )
      .bind(
        crypto.randomUUID(),
        id,
        JSON.stringify({ retrievalId: run.id, sourceIds: clean.sourceIds }),
        now,
        id,
      ),
    database()
      .prepare(
        "UPDATE shift_notes SET confirmation_id=NULL,review_version=NULL WHERE id=? AND owner_id=? AND EXISTS (SELECT 1 FROM interview_questions WHERE id=?)",
      )
      .bind(noteId, ownerId, id),
  ]);
  if (!result[0].meta.changes)
    error(
      "stale_context",
      "The interview or available question budget changed. Refresh the context before asking.",
    );
  const saved = await database()
    .prepare("SELECT * FROM interview_questions WHERE id=?")
    .bind(id)
    .first<QuestionRow>();
  return {
    question: questionDto(saved!),
    remainingClarifications: await remainingClarifications(noteId, ownerId),
    duplicate: false,
    canAsk: true,
    guidance:
      "Registration is a proposal, not evidence that the question was spoken. Ask this question once, preserving its wording; only the worker's answer can establish this shift's facts.",
  };
}

// Added to captureEvent's existing atomic batch. No extra model call, and no
// suggestion is marked emitted until an actual Agent transcript contains it.
export function questionCaptureStatements(
  session: VoiceSessionRow,
  event: VoiceEvent,
  guard: WriteGuard,
) {
  const eventId = `${session.id}:${event.sequence}`;
  const now = new Date().toISOString();
  const where = "note_id=? AND owner_id=? AND status='proposed'";
  if (event.kind === "agent") {
    const text = normalizeQuestion(event.text);
    const matched = `${where} AND session_id=? AND instr(?,question_key)>0 AND ${guard.sql}`;
    const params = [
      session.note_id,
      session.owner_id,
      session.id,
      text,
      ...guard.bindings,
    ];
    return [
      database()
        .prepare(
          `INSERT INTO interview_question_events (id,question_id,event_type,transcript_event_id,details_json,created_at)
        SELECT id||':emitted:'||?,id,'emitted',?,'{}',? FROM interview_questions WHERE ${matched}`,
        )
        .bind(eventId, eventId, now, ...params),
      database()
        .prepare(
          `UPDATE interview_questions SET status='emitted',emitted_event_id=?,revision=revision+1,updated_at=? WHERE ${matched}`,
        )
        .bind(eventId, now, ...params),
    ];
  }
  if (event.kind === "user" || event.kind === "interrupt") {
    const reason =
      event.kind === "interrupt"
        ? "Interview interrupted before emission"
        : "Worker spoke before question emission";
    return [
      database()
        .prepare(
          `INSERT INTO interview_question_events (id,question_id,event_type,transcript_event_id,details_json,created_at)
        SELECT id||':cancelled:'||?,id,'cancelled',?,?,? FROM interview_questions WHERE ${where} AND ${guard.sql}`,
        )
        .bind(
          eventId,
          eventId,
          JSON.stringify({ reason }),
          now,
          session.note_id,
          session.owner_id,
          ...guard.bindings,
        ),
      database()
        .prepare(
          `UPDATE interview_questions SET status='cancelled',revision=revision+1,updated_at=? WHERE ${where} AND ${guard.sql}`,
        )
        .bind(now, session.note_id, session.owner_id, ...guard.bindings),
    ];
  }
  return [];
}

export async function questionAnswerStatements(
  row: Row,
  sessionId: unknown,
  input: unknown,
  mutationId: string,
) {
  let updates;
  try {
    updates = cleanQuestionUpdates(input);
  } catch (e) {
    throw new RequestError(
      e instanceof Error ? e.message : "Invalid question update.",
      400,
    );
  }
  if (!updates.length) return [];
  const session = await getVoiceSession(sessionId, row.owner_id, row.id);
  if (JSON.parse(session.state_json).closed)
    throw new RequestError("This interview has ended.", 409);
  const turn = await database()
    .prepare(
      "SELECT rowid AS cursor,id,content,session_id FROM transcript_events WHERE note_id=? AND owner_id=? AND role='user' ORDER BY rowid DESC LIMIT 1",
    )
    .bind(row.id, row.owner_id)
    .first<{
      cursor: number;
      id: string;
      content: string;
      session_id: string;
    }>();
  if (!turn || turn.session_id !== session.id)
    throw new RequestError(
      "Save the current worker answer before updating question status.",
      409,
    );
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  for (const update of updates) {
    const question = await database()
      .prepare(
        "SELECT * FROM interview_questions WHERE id=? AND note_id=? AND owner_id=?",
      )
      .bind(update.questionId, row.id, row.owner_id)
      .first<QuestionRow>();
    if (
      !question ||
      !["emitted", "answered", "unknown"].includes(question.status) ||
      !question.emitted_event_id
    )
      throw new RequestError(
        "The answer must refer to an emitted question in this interview.",
        409,
      );
    const emitted = await database()
      .prepare(
        "SELECT rowid AS cursor FROM transcript_events WHERE id=? AND note_id=? AND owner_id=? AND role='agent'",
      )
      .bind(question.emitted_event_id, row.id, row.owner_id)
      .first<{ cursor: number }>();
    if (
      !emitted ||
      turn.cursor <= emitted.cursor ||
      !turn.content.includes(update.quote)
    )
      throw new RequestError(
        "Use an exact quote from the saved worker answer after this question.",
        409,
      );
    const guard = `EXISTS (SELECT 1 FROM shift_notes WHERE id=? AND owner_id=? AND mutation_id=?) AND ${cursorSql}=? AND EXISTS (SELECT 1 FROM voice_sessions WHERE id=? AND revision=? AND expires_at>? AND COALESCE(json_extract(state_json,'$.closed'),0)=0)`;
    const params = [
      row.id,
      row.owner_id,
      mutationId,
      row.id,
      row.owner_id,
      turn.cursor,
      session.id,
      session.revision,
      now,
    ];
    // A missing guard must roll back the note update too; NOT NULL enforces an
    // assertion inside the same transaction, rather than silently skipping it.
    statements.push(
      database()
        .prepare(
          `INSERT INTO interview_question_events (id,question_id,event_type,transcript_event_id,details_json,created_at)
      VALUES (?,(CASE WHEN ${guard} AND EXISTS (SELECT 1 FROM interview_questions WHERE id=? AND revision=?) THEN ? ELSE NULL END),?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          ...params,
          question.id,
          question.revision,
          question.id,
          update.state,
          turn.id,
          JSON.stringify({
            quote: update.quote,
            noteRevision: row.revision + 1,
          }),
          now,
        ),
    );
    statements.push(
      database()
        .prepare(
          "UPDATE interview_questions SET status=?,answer_event_id=?,answer_quote=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        )
        .bind(
          update.state,
          turn.id,
          update.quote,
          now,
          question.id,
          question.revision,
        ),
    );
  }
  return statements;
}

export function cancelProposedStatements(
  noteId: string,
  ownerId: string,
  reason: string,
  guard: WriteGuard,
  sessionId?: string,
) {
  const now = new Date().toISOString();
  const marker = crypto.randomUUID();
  const where = `note_id=? AND owner_id=? AND status='proposed'${sessionId ? " AND session_id=?" : ""} AND ${guard.sql}`;
  const params = [
    noteId,
    ownerId,
    ...(sessionId ? [sessionId] : []),
    ...guard.bindings,
  ];
  return [
    database()
      .prepare(
        `INSERT INTO interview_question_events (id,question_id,event_type,details_json,created_at) SELECT id||?,id,'cancelled',?,? FROM interview_questions WHERE ${where}`,
      )
      .bind(marker, JSON.stringify({ reason }), now, ...params),
    database()
      .prepare(
        `UPDATE interview_questions SET status='cancelled',revision=revision+1,updated_at=? WHERE ${where}`,
      )
      .bind(now, ...params),
  ];
}

export async function interviewAudit(
  noteId: string,
  ownerId: string,
  viewerId: string,
) {
  // Caller must authorize the note. Reauthorize each citation independently;
  // access to the interview does not grant access to its historical sources.
  const questions = await listInterviewQuestions(noteId, ownerId);
  const items = [];
  for (const question of questions) {
    const run = await database()
      .prepare(
        "SELECT sources_json FROM retrieval_runs WHERE id=? AND note_id=? AND owner_id=?",
      )
      .bind(question.retrievalId, noteId, ownerId)
      .first<{ sources_json: string }>();
    const sources = (
      run ? JSON.parse(run.sources_json) : []
    ) as KnowledgeSource[];
    const citations = [];
    for (const source of sources.filter((s) =>
      question.sourceIds.includes(s.sourceId),
    )) {
      const readable = await database()
        .prepare(
          `SELECT id,revision FROM shift_notes WHERE id=? AND provider_id=(SELECT provider_id FROM shift_notes WHERE id=?) AND participant_id=(SELECT participant_id FROM shift_notes WHERE id=?)
        AND (owner_id=? OR EXISTS (SELECT 1 FROM provider_manager_grants g JOIN providers p ON p.id=g.provider_id AND p.active=1 WHERE g.provider_id=shift_notes.provider_id AND g.claimed_user_id=? AND g.active=1))`,
        )
        .bind(source.noteId, noteId, noteId, viewerId, viewerId)
        .first<{ id: string; revision: number }>();
      citations.push(
        readable
          ? {
              ...source,
              currentRevision: readable.revision,
              historicalCitation: true,
              accessible: true,
            }
          : { sourceId: source.sourceId, accessible: false },
      );
    }
    const events = await database()
      .prepare(
        "SELECT event_type,transcript_event_id,details_json,created_at FROM interview_question_events WHERE question_id=? ORDER BY rowid",
      )
      .bind(question.id)
      .all();
    items.push({ ...question, citations, events: events.results });
  }
  return items;
}
