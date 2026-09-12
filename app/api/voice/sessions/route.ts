import {
  database,
  failure,
  getRow,
  identity,
  json,
  readBody,
  RequestError,
} from "@/lib/notes-server";
import { voiceConfig } from "@/lib/voice-server";
import { emptyVoiceState } from "@/lib/voice-state";
import { participantFor } from "@/lib/participants";
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
    if (!participantFor(JSON.parse(note.fields_json).participant))
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
    await database().batch([
      database()
        .prepare(
          "UPDATE voice_sessions SET expires_at=? WHERE note_id=? AND owner_id=?",
        )
        .bind(now, note.id, user.userId),
      database()
        .prepare(
          "UPDATE shift_notes SET confirmation_id=NULL,review_version=NULL WHERE id=? AND owner_id=? AND status='draft'",
        )
        .bind(note.id, user.userId),
      database()
        .prepare(
          "INSERT INTO voice_sessions (id,owner_id,note_id,conversation_id,created_at,expires_at,state_json,revision) VALUES (?,?,?,?,?,?,?,0)",
        )
        .bind(
          id,
          user.userId,
          note.id,
          conversationId,
          now,
          expires,
          JSON.stringify(emptyVoiceState(mode)),
        ),
    ]);
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
