import { database, getRow, toNote, type Row } from "./notes-server";
import { participantForNote } from "./participants";
import { reportingGuidance } from "./safety";
import { type VoiceSessionRow } from "./voice-server";
import { noCurrentAssessmentSql } from "./assessment-server";
import {
  type VoiceEvent,
  type VoiceState,
  hasConfirmationPrompt,
} from "./voice-state";
import {
  listInterviewQuestions,
  questionCaptureStatements,
  remainingClarifications,
} from "./interview-server";

export async function workerTranscript(noteId: string, ownerId: string) {
  const result = await database()
    .prepare(
      "SELECT content FROM transcript_events WHERE note_id=? AND owner_id=? AND role='user' ORDER BY received_at,sequence",
    )
    .bind(noteId, ownerId)
    .all<{ content: string }>();
  return result.results.map((row) => row.content).join("\n");
}
export async function captureEvent(
  row: VoiceSessionRow,
  state: VoiceState,
  event: VoiceEvent,
) {
  const serialised = JSON.stringify(state);
  const now = new Date().toISOString();
  const guard = {
    sql: "EXISTS (SELECT 1 FROM voice_sessions WHERE id=? AND owner_id=? AND revision=? AND state_json=?)",
    bindings: [row.id, row.owner_id, row.revision + 1, serialised],
  };
  // Stage one records source evidence. New concern detection belongs to AI2;
  // existing risk_events remain readable as historical audit material.
  const questionCount =
    event.kind === "agent" && !hasConfirmationPrompt(event.text)
      ? (event.text.match(/\?/g)?.length ?? 0)
      : 0;
  const result = await database().batch([
    database()
      .prepare(
        "UPDATE voice_sessions SET state_json=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=? AND expires_at>? AND COALESCE(json_extract(state_json,'$.closed'),0)=0 AND EXISTS (SELECT 1 FROM shift_notes WHERE id=voice_sessions.note_id AND owner_id=voice_sessions.owner_id AND status='draft' AND " +
          noCurrentAssessmentSql +
          ")",
      )
      .bind(serialised, row.id, row.owner_id, row.revision, now),
    database()
      .prepare(
        "INSERT OR IGNORE INTO transcript_events (id,session_id,note_id,owner_id,sequence,role,content,received_at,question_count) SELECT ?,?,?,?,?,?,?,?,? WHERE " +
          guard.sql,
      )
      .bind(
        `${row.id}:${event.sequence}`,
        row.id,
        row.note_id,
        row.owner_id,
        event.sequence,
        event.kind,
        event.text,
        now,
        questionCount,
        ...guard.bindings,
      ),
    ...questionCaptureStatements(row, event, guard),
  ]);
  return Boolean(result[0].meta.changes);
}
export async function safetyContext(noteId: string, ownerId: string) {
  const note = toNote(await getRow(noteId, ownerId));
  const profile = participantForNote(note);
  return {
    note,
    profile,
    scheduledShift: note.shiftId
      ? {
          id: note.shiftId,
          expectedStart: note.expectedStart,
          expectedEnd: note.expectedEnd,
          timezone: note.timezone,
          instruction:
            "Expected times are the manager's plan. Ask the worker for actual start and end times; do not treat the schedule as evidence of attendance.",
        }
      : null,
    remainingClarifications: await remainingClarifications(noteId, ownerId),
    questions: await listInterviewQuestions(noteId, ownerId),
    riskFlags: note.riskFlags,
    reportingGuidance,
    escalation: note.riskFlags?.some((f) => f.severity === "urgent")
      ? {
          status: "in_app_inbox",
          message:
            "This may need to be reported to the Commission. An alert is in the demo supervisor inbox. No external team leader has been notified; supervisor assessment is still required.",
        }
      : null,
  };
}
export function auditStatements(
  row: Row,
  next: Record<string, unknown>,
  source: string,
  mutationId: string,
) {
  const flatten = (data: Record<string, unknown>) => {
    const { safety, ...fields } = data;
    const meta = safety as
      | {
          fieldStates?: Record<string, unknown>;
          restrictivePractice?: Record<string, unknown>;
          evidence?: Record<string, unknown>;
        }
      | undefined;
    return {
      ...fields,
      ...Object.fromEntries(
        Object.entries(meta?.fieldStates ?? {}).map(([key, value]) => [
          `state:${key}`,
          value,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(meta?.restrictivePractice ?? {}).map(([key, value]) => [
          `restrictive_practice:${key}`,
          value,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(meta?.evidence ?? {}).map(([key, value]) => [
          `evidence:${key}`,
          value,
        ]),
      ),
    };
  };
  const before = flatten({
    ...JSON.parse(row.fields_json),
    safety: JSON.parse(row.safety_json),
  });
  return Object.entries(flatten(next))
    .filter(
      ([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value),
    )
    .map(([key, value]) =>
      database()
        .prepare(
          "INSERT INTO note_changes (id,note_id,owner_id,revision,field,before_value,after_value,actor,source,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM shift_notes WHERE id=? AND mutation_id=?)",
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          row.owner_id,
          row.revision + 1,
          key,
          JSON.stringify(before[key] ?? null),
          JSON.stringify(value),
          row.owner_id,
          source,
          new Date().toISOString(),
          row.id,
          mutationId,
        ),
    );
}
