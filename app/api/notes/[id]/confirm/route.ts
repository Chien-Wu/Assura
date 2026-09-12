import { checkForm } from "@/lib/shift-form";
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
import { getVoiceSession } from "@/lib/voice-server";
import { voiceEvidence } from "@/lib/voice-state";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    const row = await getRow(id, user.userId);
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
    if (!checkForm(JSON.parse(row.fields_json)).ready)
      throw new RequestError("Some details still need an answer.", 422);
    let evidence: unknown = { method: "button" };
    let sessionGuard = "";
    const sessionBindings: (string | number)[] = [];
    if (body.voiceSessionId !== undefined) {
      const session = await getVoiceSession(
        body.voiceSessionId,
        user.userId,
        id,
      );
      try {
        evidence = {
          ...voiceEvidence(
            JSON.parse(session.state_json),
            body.confirmationId,
            row.revision,
          ),
          sessionId: session.id,
          conversationId: session.conversation_id,
        };
      } catch (error) {
        throw new RequestError(
          error instanceof Error
            ? error.message
            : "Voice confirmation is missing.",
          409,
        );
      }
      sessionGuard =
        " AND EXISTS (SELECT 1 FROM voice_sessions WHERE id=? AND owner_id=? AND note_id=shift_notes.id AND revision=? AND expires_at>?)";
      sessionBindings.push(
        session.id,
        user.userId,
        session.revision,
        new Date().toISOString(),
      );
    }
    const now = new Date().toISOString();
    const result = await database()
      .prepare(
        "UPDATE shift_notes SET status='complete',confirmed_at=?,updated_at=?,confirmation_evidence=? WHERE id=? AND owner_id=? AND revision=? AND review_version=revision AND confirmation_id=? AND status='draft'" +
          sessionGuard,
      )
      .bind(
        now,
        now,
        JSON.stringify(evidence),
        id,
        user.userId,
        row.revision,
        body.confirmationId,
        ...sessionBindings,
      )
      .run();
    if (!result.meta.changes)
      throw new RequestError("The note changed. Please review it again.", 409);
    return json({ note: toNote(await getRow(id, user.userId)) });
  } catch (error) {
    return failure(error);
  }
}
