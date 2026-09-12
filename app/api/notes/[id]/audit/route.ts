import {
  database,
  failure,
  getRow,
  identity,
  json,
  toNote,
} from "@/lib/notes-server";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const note = toNote(await getRow(id, user.userId));
    const [transcript, changes, snapshot] = await Promise.all([
      database()
        .prepare(
          "SELECT session_id,sequence,role,content,received_at FROM transcript_events WHERE note_id=? AND owner_id=? ORDER BY received_at,sequence",
        )
        .bind(id, user.userId)
        .all(),
      database()
        .prepare(
          "SELECT revision,field,before_value,after_value,actor,source,created_at FROM note_changes WHERE note_id=? AND owner_id=? ORDER BY revision,created_at",
        )
        .bind(id, user.userId)
        .all(),
      database()
        .prepare(
          "SELECT snapshot_json,created_at FROM note_snapshots WHERE note_id=? AND owner_id=?",
        )
        .bind(id, user.userId)
        .first<{ snapshot_json: string; created_at: string }>(),
    ]);
    return json({
      note,
      transcript: transcript.results,
      changes: changes.results,
      draftV0: snapshot ? JSON.parse(snapshot.snapshot_json) : null,
      draftV0CreatedAt: snapshot?.created_at ?? null,
      retention: {
        minimumUntil: note.retentionUntil,
        dateOfBirthKnown: false,
        extendedRetention:
          "Participant date of birth not supplied; longer retention applicability must be reviewed. No deletion endpoint is provided.",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
