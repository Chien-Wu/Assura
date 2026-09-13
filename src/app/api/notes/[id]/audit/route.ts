import { getReadableRow, toNote } from "@/lib/notes/server";
import { database, failure, identity, json } from "@/lib/shared/server";
import { interviewAudit } from "@/lib/knowledge/interview-server";
import { readAssessment, readAssessmentAudit } from "@/lib/assessment/server";
import { readFindingsForNote } from "@/lib/assessment/finding-review-server";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const row = await getReadableRow(id, user);
    const note = toNote(row);
    const [transcript, changes, snapshot] = await Promise.all([
      database()
        .prepare(
          "SELECT session_id,sequence,role,content,received_at FROM transcript_events WHERE note_id=? AND owner_id=? ORDER BY received_at,sequence",
        )
        .bind(id, row.owner_id)
        .all(),
      database()
        .prepare(
          "SELECT revision,field,before_value,after_value,actor,source,created_at FROM note_changes WHERE note_id=? AND owner_id=? ORDER BY revision,created_at",
        )
        .bind(id, row.owner_id)
        .all(),
      database()
        .prepare(
          "SELECT snapshot_json,created_at FROM note_snapshots WHERE note_id=? AND owner_id=?",
        )
        .bind(id, row.owner_id)
        .first<{ snapshot_json: string; created_at: string }>(),
    ]);
    return json({
      note,
      transcript: transcript.results,
      changes: changes.results,
      interviewQuestions: await interviewAudit(id, row.owner_id, user.userId),
      assessment: await readAssessment(id, row.owner_id),
      assessmentAudit: await readAssessmentAudit(id, row.owner_id),
      findings: await readFindingsForNote(id, row.owner_id, user.userId),
      draftV0: snapshot ? JSON.parse(snapshot.snapshot_json) : null,
      draftV0CreatedAt: snapshot?.created_at ?? null,
      retention: {
        minimumUntil: note.retentionUntil,
        dateOfBirthKnown: Boolean(note.participantSnapshot?.dateOfBirth),
        extendedRetention: note.participantSnapshot?.dateOfBirth
          ? "The recorded participant profile includes a date of birth. Longer retention applicability must be reviewed. No deletion endpoint is provided."
          : "Participant date of birth not supplied; longer retention applicability must be reviewed. No deletion endpoint is provided.",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
