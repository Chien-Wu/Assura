import { checkForm, noteText } from "@/lib/shift-form";
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
    const validation = checkForm(note.fields);
    if (!validation.ready)
      return json(
        { error: "Some details still need an answer.", validation },
        422,
      );
    const confirmationId = crypto.randomUUID();
    const result = await database().batch([
      database()
        .prepare(
          "UPDATE shift_notes SET confirmation_id=?,review_version=revision WHERE id=? AND owner_id=? AND revision=? AND status='draft'",
        )
        .bind(confirmationId, id, user.userId, note.revision),
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
      summary: noteText(note),
      validation,
      interviewQuestions: await listInterviewQuestions(id, user.userId),
    });
  } catch (error) {
    return failure(error);
  }
}
