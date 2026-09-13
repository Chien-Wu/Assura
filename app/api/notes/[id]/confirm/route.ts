import {
  requireReadyAssessment,
  validateRecorder,
} from "@/lib/assessment/server";
import { getRow, toNote } from "@/lib/notes/server";
import {
  database,
  failure,
  identity,
  json,
  RequestError,
  readBody,
} from "@/lib/shared/server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    const row = await getRow(id, user.userId);
    if (body.voiceSessionId !== undefined)
      throw new RequestError(
        "The recorder cannot confirm a note. Review the saved note and risk summary.",
        409,
      );
    if (
      body.confirmed !== true ||
      typeof body.confirmationId !== "string" ||
      !body.confirmationId ||
      body.confirmationId !== row.confirmation_id ||
      body.revision !== row.revision ||
      row.review_version !== row.revision
    )
      throw new RequestError(
        "Please review and explicitly confirm the current note.",
        409,
      );
    if (row.status === "complete") return json({ note: toNote(row) });
    validateRecorder(row);
    const assessment = await requireReadyAssessment(
      row,
      body.assessmentId,
      body.assessmentRevision,
    );
    const evidence = {
      method: "button",
      assessmentId: assessment.id,
      assessmentRevision: assessment.revision,
      sourceRevision: assessment.sourceRevision,
    };
    const now = new Date().toISOString();
    const result = await database()
      .prepare(
        "UPDATE shift_notes SET status='complete',confirmed_at=?,updated_at=?,confirmation_evidence=? WHERE id=? AND owner_id=? AND revision=? AND review_version=revision AND confirmation_id=? AND status='draft' AND EXISTS (SELECT 1 FROM assessment_reviews r JOIN shift_assessments a ON a.id=r.assessment_id WHERE r.confirmation_id=shift_notes.confirmation_id AND r.note_id=shift_notes.id AND r.owner_id=shift_notes.owner_id AND r.source_revision=shift_notes.revision AND r.assessment_id=? AND r.assessment_revision=? AND a.note_id=shift_notes.id AND a.owner_id=shift_notes.owner_id AND a.source_revision=shift_notes.revision AND a.revision=r.assessment_revision AND a.status='ready' AND a.schema_version=2)",
      )
      .bind(
        now,
        now,
        JSON.stringify(evidence),
        id,
        user.userId,
        row.revision,
        body.confirmationId,
        assessment.id,
        assessment.revision,
      )
      .run();
    if (!result.meta.changes)
      throw new RequestError("The note changed. Please review it again.", 409);
    return json({ note: toNote(await getRow(id, user.userId)) });
  } catch (error) {
    return failure(error);
  }
}
