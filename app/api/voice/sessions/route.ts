import {
  database,
  failure,
  getRow,
  identity,
  json,
  readBody,
  RequestError,
  toNote,
} from "@/lib/notes-server";
import { voiceConfig } from "@/lib/voice-server";
import { emptyVoiceState } from "@/lib/voice-state";
import { participantForNote } from "@/lib/participants";
import {
  noCurrentAssessmentSql,
  rejectRecorderDuringAssessment,
} from "@/lib/assessment-server";
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const body = await readBody(request);
    const mode = body.mode ?? "voice";
    if (mode !== "voice" && mode !== "text")
      throw new RequestError("Choose text or voice mode.");
    if (typeof body.noteId !== "string")
      throw new RequestError("Choose a saved draft first.");
    const note = await getRow(body.noteId, user.userId);
    if (note.status !== "draft")
      throw new RequestError("Start a new draft to begin a conversation.", 409);
    await rejectRecorderDuringAssessment(note.id, user.userId);
    if (!participantForNote(toNote(note)))
      throw new RequestError(
        "Select a participant profile before starting the conversation.",
      );
    const { key, agentId } = voiceConfig();
    if (!key || !agentId)
      throw new RequestError("Voice setup is pending.", 503);
    const endpoint = mode === "text" ? "get-signed-url" : "token";
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/${endpoint}?agent_id=${encodeURIComponent(agentId)}${mode === "text" ? "&include_conversation_id=true" : ""}`,
      { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok)
      throw new RequestError(
        response.status === 401 || response.status === 403
          ? "The voice service key needs attention. You can still save your note using the form."
          : "The voice service is unavailable. Please try again shortly.",
        503,
      );
    const data = (await response.json()) as {
      token?: string;
      conversation_id?: string;
      signed_url?: string;
    };
    const conversationId =
      mode === "text" && data.signed_url
        ? new URL(data.signed_url).searchParams.get("conversation_id")
        : data.conversation_id;
    if (!(mode === "text" ? data.signed_url : data.token) || !conversationId)
      throw new RequestError(
        "The conversation service did not return a connection. Please try again.",
        503,
      );
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const savedSession = await database().batch([
      database()
        .prepare(
          "UPDATE voice_sessions SET expires_at=?,revision=revision+1 WHERE note_id=? AND owner_id=? AND EXISTS (SELECT 1 FROM shift_notes WHERE id=voice_sessions.note_id AND status='draft' AND " +
            noCurrentAssessmentSql +
            ")",
        )
        .bind(now, note.id, user.userId),
      database()
        .prepare(
          "UPDATE shift_notes SET confirmation_id=NULL,review_version=NULL WHERE id=? AND owner_id=? AND status='draft' AND " +
            noCurrentAssessmentSql,
        )
        .bind(note.id, user.userId),
      database()
        .prepare(
          "INSERT INTO voice_sessions (id,owner_id,note_id,conversation_id,created_at,expires_at,state_json,revision) SELECT ?,owner_id,id,?,?,?,?,0 FROM shift_notes WHERE id=? AND owner_id=? AND revision=? AND status='draft' AND " +
            noCurrentAssessmentSql,
        )
        .bind(
          id,
          conversationId,
          now,
          expires,
          JSON.stringify(emptyVoiceState(mode)),
          note.id,
          user.userId,
          note.revision,
        ),
    ]);
    if (!savedSession[2].meta.changes)
      throw new RequestError(
        "The draft moved to follow-up or changed while the recorder connected. Reload the saved shift.",
        409,
      );
    return json({
      sessionId: id,
      conversationId,
      mode,
      ...(mode === "text"
        ? { signedUrl: data.signed_url }
        : { conversationToken: data.token }),
    });
  } catch (error) {
    return failure(error);
  }
}
