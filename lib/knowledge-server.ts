import { database, getRow, toNote, type Row } from "./notes-server";
import { getVoiceSession } from "./voice-server";
import {
  activeKnowledgeScopeSql,
  boundedKnowledgeSources,
  eligibleKnowledgeSql,
  KnowledgeError,
  KNOWLEDGE_CANDIDATE_LIMIT,
  KNOWLEDGE_SOURCE_LIMIT,
  knowledgeCutoff,
  knowledgeGuidance,
  literalKnowledgeQuery,
  minimizedProfile,
  sourceIsHistorical,
  type KnowledgeCutoff,
  type KnowledgeSource,
} from "./knowledge";
import type { ShiftFields } from "./shift-form";

export { KnowledgeError } from "./knowledge";
type KnowledgeScope = {
  row: Row;
  ownerId: string;
  noteId: string;
  providerId: string;
  participantId: string;
  cutoff: KnowledgeCutoff | null;
  timeStatus: string;
};
type SourceRow = Row & {
  confirmation_evidence: string | null;
  match_rank?: number;
};
const sourceFieldKeys = [
  "shiftStart",
  "shiftEnd",
  "activities",
  "supportProvided",
  "participantResponse",
  "goalProgress",
  "incidents",
  "incidentDetails",
  "followUp",
  "followUpDetails",
] as const;

export async function ensureKnowledgeScope(
  noteId: string,
  ownerId: string,
  options: { draftOnly?: boolean } = {},
): Promise<KnowledgeScope> {
  const row = await getRow(noteId, ownerId);
  if (options.draftOnly && row.status !== "draft")
    throw new KnowledgeError(
      409,
      "note_complete",
      "History questions are available while this note is a draft.",
    );
  const allowed = await database()
    .prepare(
      `SELECT current_note.id FROM shift_notes AS current_note
     WHERE current_note.id=? AND current_note.owner_id=? AND ${activeKnowledgeScopeSql}`,
    )
    .bind(noteId, ownerId)
    .first();
  if (!allowed || !row.provider_id || !row.participant_id)
    throw new KnowledgeError(
      403,
      "history_scope_unavailable",
      "History is unavailable for this participant assignment.",
    );
  const note = toNote(row);
  return {
    row,
    ownerId,
    noteId,
    providerId: row.provider_id,
    participantId: row.participant_id,
    ...knowledgeCutoff(
      note.fields.shiftStart,
      row.expected_start,
      row.timezone,
      !options.draftOnly,
    ),
  };
}

export async function latestWorkerTurn(noteId: string, ownerId: string) {
  const event = await database()
    .prepare(
      "SELECT rowid AS cursor,content,session_id AS sessionId FROM transcript_events WHERE note_id=? AND owner_id=? AND role='user' ORDER BY rowid DESC LIMIT 1",
    )
    .bind(noteId, ownerId)
    .first<{ cursor: number; content: string; sessionId: string }>();
  return event ?? { cursor: 0, content: "", sessionId: null };
}

function sourceDto(row: SourceRow): KnowledgeSource | null {
  try {
    const note = toNote(row);
    const fields = {} as Omit<ShiftFields, "participant">;
    for (const key of sourceFieldKeys) {
      if (typeof note.fields[key] !== "string") return null;
      // The DTO contains authored fields only: no risk summaries, profile,
      // transcript, fixture topics or synthetic continuity annotations.
      fields[key] = note.fields[key] as never;
    }
    if (!row.confirmed_at || !Number.isInteger(row.revision)) return null;
    let isSynthetic = false;
    if (row.confirmation_evidence) {
      const evidence: unknown = JSON.parse(row.confirmation_evidence);
      isSynthetic = Boolean(
        evidence &&
          typeof evidence === "object" &&
          "synthetic" in evidence &&
          evidence.synthetic === true,
      );
    }
    return {
      sourceId: `${row.id}@${row.revision}`,
      noteId: row.id,
      revision: row.revision,
      shiftStart: fields.shiftStart,
      shiftEnd: fields.shiftEnd,
      confirmedAt: row.confirmed_at,
      workerName: row.worker_name,
      fields,
      isSynthetic,
    };
  } catch {
    return null;
  }
}

function scopeBindings(scope: KnowledgeScope) {
  if (!scope.cutoff)
    throw new KnowledgeError(
      409,
      "history_time_unavailable",
      "Record an unambiguous actual shift start before searching history.",
    );
  return [
    scope.ownerId,
    scope.providerId,
    scope.participantId,
    scope.noteId,
    scope.cutoff.local,
    scope.cutoff.utc,
  ];
}

export async function validateRetrievalSources(
  sources: KnowledgeSource[],
  scope: KnowledgeScope,
) {
  if (
    !scope.cutoff ||
    !Array.isArray(sources) ||
    sources.length > KNOWLEDGE_SOURCE_LIMIT
  )
    return false;
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source || typeof source.noteId !== "string" || seen.has(source.noteId))
      return false;
    seen.add(source.noteId);
    const current = await database()
      .prepare(
        `SELECT source.* FROM shift_notes AS source WHERE ${eligibleKnowledgeSql} AND source.id=? AND source.revision=?`,
      )
      .bind(...scopeBindings(scope), source.noteId, source.revision)
      .first<SourceRow>();
    const original = current && sourceDto(current);
    const dto =
      original && source.followup
        ? (await withConfirmedFollowups([original], scope.ownerId))[0]
        : original;
    if (
      !dto ||
      !sourceIsHistorical(dto, scope.cutoff) ||
      JSON.stringify(dto) !== JSON.stringify(source)
    )
      return false;
  }
  return true;
}

function coverageResult(
  candidates: number,
  limited: ReturnType<typeof boundedKnowledgeSources>,
  method: "recent" | "english_fts5",
  invalid: number,
  candidateLimitReached: boolean,
) {
  return {
    returned: limited.sources.length,
    candidates,
    omitted: limited.omitted + invalid,
    oversized: limited.oversized,
    partial: candidateLimitReached || limited.omitted > 0 || invalid > 0,
    candidateLimitReached,
    scope: "same_worker_same_provider_same_participant",
    method,
    includedContent:
      method === "recent"
        ? "recorder_fields_and_confirmed_followup"
        : "recorder_fields_only",
    ...(method === "english_fts5"
      ? {
          guidance:
            "Keyword search covers recorder fields only. AI2 follow-up details are available in recent context; no match is not an exhaustive absence.",
        }
      : {}),
  };
}

async function persistRetrieval(
  scope: KnowledgeScope,
  cursor: number,
  sources: KnowledgeSource[],
  status: string,
  query: string,
  sessionId: string | null,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await database()
    .prepare(
      `INSERT INTO retrieval_runs
     (id,note_id,owner_id,session_id,query,note_revision,transcript_cursor,sources_json,status,created_at)
     SELECT ?,current_note.id,current_note.owner_id,?,?,current_note.revision,?,?,?,?
     FROM shift_notes AS current_note
     WHERE current_note.id=? AND current_note.owner_id=? AND current_note.revision=?
       AND ${activeKnowledgeScopeSql}
       AND COALESCE((SELECT MAX(rowid) FROM transcript_events WHERE note_id=current_note.id AND owner_id=current_note.owner_id AND role='user'),0)=?
       AND (? IS NULL OR (current_note.status='draft' AND EXISTS (
         SELECT 1 FROM voice_sessions WHERE id=? AND note_id=current_note.id AND owner_id=current_note.owner_id
         AND expires_at>? AND json_extract(state_json,'$.closed')=0)))
       AND NOT EXISTS (
         SELECT 1 FROM json_each(?) AS requested
         LEFT JOIN shift_notes AS source ON source.id=json_extract(requested.value,'$.noteId')
         WHERE source.id IS NULL OR source.revision<>json_extract(requested.value,'$.revision')
           OR source.status<>'complete' OR source.confirmed_at IS NULL
           OR source.confirmed_at<>json_extract(requested.value,'$.confirmedAt')
           OR source.owner_id<>current_note.owner_id OR source.provider_id IS NOT current_note.provider_id
           OR source.participant_id IS NOT current_note.participant_id
       )`,
    )
    .bind(
      id,
      sessionId,
      query,
      cursor,
      JSON.stringify(sources),
      status,
      now,
      scope.noteId,
      scope.ownerId,
      scope.row.revision,
      cursor,
      sessionId,
      sessionId,
      now,
      JSON.stringify(sources),
    )
    .run();
  if (!result.meta.changes)
    throw new KnowledgeError(
      409,
      "stale_context",
      "The note, conversation or record access changed. Refresh the context before asking a history question.",
    );
  // Recheck before returning record text. A later tool also revalidates each
  // stored citation, so correcting a source invalidates old retrieval runs.
  const refreshed = await ensureKnowledgeScope(scope.noteId, scope.ownerId, {
    draftOnly: Boolean(sessionId),
  });
  const turn = await latestWorkerTurn(scope.noteId, scope.ownerId);
  if (
    refreshed.row.revision !== scope.row.revision ||
    turn.cursor !== cursor ||
    !(await validateRetrievalSources(sources, refreshed))
  )
    throw new KnowledgeError(
      409,
      "stale_context",
      "The note, conversation or source changed. Search again before asking a history question.",
    );
  return id;
}

function emptyResult(
  scope: KnowledgeScope,
  cursor: number,
  method: "recent" | "english_fts5",
) {
  return {
    status: scope.timeStatus,
    retrievalId: null as string | null,
    noteRevision: scope.row.revision,
    transcriptCursor: cursor,
    sources: [] as KnowledgeSource[],
    coverage: coverageResult(
      0,
      boundedKnowledgeSources([], 0),
      method,
      0,
      false,
    ),
    cutoff: scope.cutoff,
    timeStatus: scope.timeStatus,
    guidance: knowledgeGuidance,
  };
}

export async function getParticipantContext(noteId: string, ownerId: string) {
  const scope = await ensureKnowledgeScope(noteId, ownerId);
  const turn = await latestWorkerTurn(noteId, ownerId);
  const note = toNote(scope.row);
  const base = {
    ...emptyResult(scope, turn.cursor, "recent"),
    profile: minimizedProfile(note.participantSnapshot ?? null),
    profileCapturedAt: scope.row.created_at,
    availability: { history: Boolean(scope.cutoff), plannedDocuments: false },
  };
  if (!scope.cutoff) return base;
  const candidates = await database()
    .prepare(
      `SELECT source.* FROM shift_notes AS source WHERE ${eligibleKnowledgeSql}
     ORDER BY json_extract(source.fields_json,'$.shiftStart') DESC,source.id LIMIT ?`,
    )
    .bind(...scopeBindings(scope), KNOWLEDGE_CANDIDATE_LIMIT + 1)
    .all<SourceRow>();
  const valid = candidates.results
    .map(sourceDto)
    .filter((source): source is KnowledgeSource =>
      Boolean(source && sourceIsHistorical(source, scope.cutoff!)),
    );
  // AI2 can learn facts after the recorder finishes. Carry that confirmed
  // follow-up forward with the same dated, owner/provider/participant scope.
  // Apply whole-source size bounds after enrichment so omissions stay explicit.
  const enriched = await withConfirmedFollowups(valid, ownerId);
  const limited = boundedKnowledgeSources(enriched, 2);
  const coverage = coverageResult(
    candidates.results.length,
    limited,
    "recent",
    candidates.results.length - valid.length,
    candidates.results.length > KNOWLEDGE_CANDIDATE_LIMIT,
  );
  const status = coverage.partial
    ? "partial"
    : limited.sources.length
      ? "ok"
      : "no_match";
  const retrievalId = await persistRetrieval(
    scope,
    turn.cursor,
    limited.sources,
    status,
    "",
    null,
  );
  return { ...base, status, retrievalId, sources: limited.sources, coverage };
}

async function withConfirmedFollowups(
  sources: KnowledgeSource[],
  ownerId: string,
) {
  if (!sources.length) return sources;
  type FollowupRow = {
    id: string;
    note_id: string;
    source_revision: number;
    revision: number;
    result_json: string;
    answers_json: string;
  };
  const followups: FollowupRow[] = [];
  for (let offset = 0; offset < sources.length; offset += 80) {
    const batch = sources.slice(offset, offset + 80);
    const rows = await database()
      .prepare(
        `SELECT a.id,a.note_id,a.source_revision,a.revision,a.result_json,
      (SELECT COALESCE(json_group_array(json_object('id',m.id,'questionId',m.question_id,'text',m.text)),'[]')
       FROM assessment_messages m JOIN shift_assessments prior ON prior.id=m.assessment_id
       WHERE prior.note_id=a.note_id AND prior.owner_id=a.owner_id AND prior.source_revision<=a.source_revision AND m.role='user') AS answers_json
     FROM shift_assessments a
     JOIN shift_notes n ON n.id=a.note_id AND n.owner_id=a.owner_id AND n.revision=a.source_revision AND n.status='complete'
     JOIN assessment_reviews r ON r.confirmation_id=n.confirmation_id AND r.assessment_id=a.id AND r.assessment_revision=a.revision
     WHERE a.owner_id=? AND a.status='ready' AND a.note_id IN (${batch.map(() => "?").join(",")})`,
      )
      .bind(ownerId, ...batch.map((source) => source.noteId))
      .all<FollowupRow>();
    followups.push(...rows.results);
  }
  return sources.map((source) => {
    const row = followups.find(
      (item) =>
        item.note_id === source.noteId &&
        item.source_revision === source.revision,
    );
    return row
      ? {
          ...source,
          followup: {
            assessmentId: row.id,
            assessmentRevision: row.revision,
            provenance: "worker_confirmed_ai_assessment" as const,
            result: JSON.parse(row.result_json),
            answers: JSON.parse(row.answers_json),
          },
        }
      : source;
  });
}

export async function searchParticipantRecords(
  noteId: string,
  ownerId: string,
  input: {
    query: unknown;
    revision: unknown;
    voiceSessionId: unknown;
    currentTurnQuote: unknown;
  },
) {
  const scope = await ensureKnowledgeScope(noteId, ownerId, {
    draftOnly: true,
  });
  if (input.revision !== scope.row.revision)
    throw new KnowledgeError(
      409,
      "stale_revision",
      "Refresh the current note before searching history.",
    );
  const session = await getVoiceSession(input.voiceSessionId, ownerId, noteId);
  let closed = true;
  try {
    closed = JSON.parse(session.state_json).closed !== false;
  } catch {
    /* fail closed */
  }
  if (closed)
    throw new KnowledgeError(
      409,
      "session_closed",
      "Start a current conversation before searching history.",
    );
  const turn = await latestWorkerTurn(noteId, ownerId);
  if (
    turn.sessionId !== session.id ||
    !turn.cursor ||
    typeof input.currentTurnQuote !== "string" ||
    !input.currentTurnQuote.trim() ||
    input.currentTurnQuote.length > 20000 ||
    !turn.content.includes(input.currentTurnQuote)
  )
    throw new KnowledgeError(
      409,
      "worker_turn_not_ready",
      "Use an exact quote from the latest saved worker turn, then retry after it is saved.",
    );
  const query = literalKnowledgeQuery(input.query);
  const base = emptyResult(scope, turn.cursor, "english_fts5");
  if (!scope.cutoff) return base;
  const sql = `SELECT source.*,bm25(knowledge_fts) AS match_rank
    FROM knowledge_fts JOIN shift_notes AS source ON source.id=knowledge_fts.note_id AND source.revision=knowledge_fts.revision
    WHERE knowledge_fts MATCH ? AND ${eligibleKnowledgeSql}`;
  const bindings = [query.match, ...scopeBindings(scope)];
  // Search both relevance and recency in the same eligible set. Recent
  // matching updates stay visible even when an older concern ranks first.
  const [ranked, recent] = await Promise.all([
    database()
      .prepare(sql + " ORDER BY match_rank,source.id LIMIT ?")
      .bind(...bindings, KNOWLEDGE_CANDIDATE_LIMIT + 1)
      .all<SourceRow>(),
    database()
      .prepare(
        sql +
          " ORDER BY json_extract(source.fields_json,'$.shiftStart') DESC,source.id LIMIT ?",
      )
      .bind(...bindings, KNOWLEDGE_CANDIDATE_LIMIT + 1)
      .all<SourceRow>(),
  ]);
  const convert = (rows: SourceRow[]) =>
    rows
      .map(sourceDto)
      .filter((source): source is KnowledgeSource =>
        Boolean(source && sourceIsHistorical(source, scope.cutoff!)),
      );
  const rankedSources = convert(ranked.results);
  const recentSources = convert(recent.results);
  const ordered = [
    ...rankedSources.slice(0, 2),
    ...recentSources.slice(0, 2),
    ...rankedSources,
    ...recentSources,
  ].filter(
    (source, index, all) =>
      all.findIndex((item) => item.sourceId === source.sourceId) === index,
  );
  const limited = boundedKnowledgeSources(ordered, KNOWLEDGE_SOURCE_LIMIT);
  const invalid = Math.max(
    ranked.results.length - rankedSources.length,
    recent.results.length - recentSources.length,
  );
  const coverage = coverageResult(
    Math.max(ranked.results.length, recent.results.length),
    limited,
    "english_fts5",
    invalid,
    ranked.results.length > KNOWLEDGE_CANDIDATE_LIMIT,
  );
  const status = coverage.partial
    ? "partial"
    : limited.sources.length
      ? "ok"
      : "no_match";
  const retrievalId = await persistRetrieval(
    scope,
    turn.cursor,
    limited.sources,
    status,
    query.query,
    session.id,
  );
  return { ...base, status, retrievalId, sources: limited.sources, coverage };
}
