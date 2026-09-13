import {
  requireReadyAssessment,
  validateRecorder,
} from "@/lib/assessment-server";
import {
  database,
  failure,
  getRow,
  identity,
  json,
  RequestError,
  toNote,
  readBody,
} from "@/lib/notes-server";
import {
  cancelProposedStatements,
  listInterviewQuestions,
} from "@/lib/interview-server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    const row = await getRow(id, user.userId);
    const note = toNote(row);
    if (note.status === "complete")
      throw new RequestError("This note is already complete.", 409);
    if (body.revision !== note.revision)
      throw new RequestError("Review the latest version of your note.", 409);
    if (body.voiceSessionId !== undefined)
      throw new RequestError(
        "Review the saved note and risk summary to confirm this note.",
        409,
      );
    validateRecorder(row);
    const assessment = await requireReadyAssessment(
      row,
      body.assessmentId,
      body.assessmentRevision,
    );
    const confirmationId = crypto.randomUUID();
    const result = await database().batch([
      database()
        .prepare(
          "UPDATE shift_notes SET confirmation_id=?,review_version=revision WHERE id=? AND owner_id=? AND revision=? AND status='draft' AND EXISTS (SELECT 1 FROM shift_assessments a WHERE a.id=? AND a.note_id=shift_notes.id AND a.owner_id=shift_notes.owner_id AND a.source_revision=shift_notes.revision AND a.revision=? AND a.status='ready' AND a.schema_version=2)",
        )
        .bind(
          confirmationId,
          id,
          user.userId,
          note.revision,
          assessment.id,
          assessment.revision,
        ),
      database()
        .prepare(
          "INSERT INTO assessment_reviews (confirmation_id,note_id,owner_id,source_revision,assessment_id,assessment_revision,created_at) SELECT ?,id,owner_id,revision,?,?,? FROM shift_notes WHERE id=? AND owner_id=? AND confirmation_id=?",
        )
        .bind(
          confirmationId,
          assessment.id,
          assessment.revision,
          new Date().toISOString(),
          id,
          user.userId,
          confirmationId,
        ),
      database()
        .prepare(
          "INSERT OR IGNORE INTO note_snapshots (note_id,owner_id,snapshot_json,created_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM shift_notes WHERE id=? AND confirmation_id=?)",
        )
        .bind(
          id,
          user.userId,
          JSON.stringify(note),
          new Date().toISOString(),
          id,
          confirmationId,
        ),
      ...cancelProposedStatements(
        id,
        user.userId,
        "Review started before question emission",
        {
          sql: "EXISTS (SELECT 1 FROM shift_notes WHERE id=? AND owner_id=? AND confirmation_id=?)",
          bindings: [id, user.userId, confirmationId],
        },
      ),
    ]);
    if (!result[0].meta.changes)
      throw new RequestError(
        "The note changed. Review the latest version.",
        409,
      );
    return json({
      note,
      confirmationId,
      summary: assessment.result!.summary,
      assessment,
      interviewQuestions: await listInterviewQuestions(id, user.userId),
    });
  } catch (error) {
    return failure(error);
  }
}
