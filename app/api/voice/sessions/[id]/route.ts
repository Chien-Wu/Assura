import {
  failure,
  identity,
  json,
  readBody,
  RequestError,
} from "@/lib/notes-server";
import { getVoiceSession, saveVoiceState } from "@/lib/voice-server";
import {
  appendVoiceEvent,
  VoiceStateError,
  type VoiceEvent,
  type VoiceState,
} from "@/lib/voice-state";
import { captureEvent, safetyContext } from "@/lib/audit-server";
import { cancelProposedStatements } from "@/lib/interview-server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    const row = await getVoiceSession(id, user.userId);
    let state = JSON.parse(row.state_json) as VoiceState;
    if (state.closed && body.action !== "close")
      throw new RequestError("This voice session has ended.", 409);
    if (body.action === "event") {
      const next = appendVoiceEvent(state, body.event as VoiceEvent);
      if (
        next !== state &&
        !(await captureEvent(row, next, body.event as VoiceEvent))
      )
        throw new RequestError(
          "The session changed. Please retry the same message.",
          409,
        );
      // The recorder needs durable acknowledgement, not a second full note and
      // interview read on every transcript event. Preserve the default response
      // for existing clients; explicit context/form reads still return it.
      if (body.responseMode === "ack")
        return json({
          ok: true,
          sequence: (body.event as VoiceEvent).sequence,
        });
      return json({
        ok: true,
        ...(await safetyContext(row.note_id, user.userId)),
      });
    } else if (body.action === "invalidate") state = { ...state, review: null };
    else if (body.action === "close")
      state = { ...state, closed: true, review: null };
    else if (body.action === "prepare" || body.action === "readback")
      throw new RequestError(
        "Continue to follow-up before reviewing and confirming the final shift summary.",
        409,
      );
    else throw new RequestError("Invalid voice session action.");
    const cancellations =
      body.action === "close"
        ? cancelProposedStatements(
            row.note_id,
            user.userId,
            "Interview closed before question emission",
            {
              sql: "EXISTS (SELECT 1 FROM voice_sessions WHERE id=? AND owner_id=? AND revision=? AND state_json=?)",
              bindings: [
                row.id,
                user.userId,
                row.revision + 1,
                JSON.stringify(state),
              ],
            },
            row.id,
          )
        : [];
    await saveVoiceState(row, state, cancellations);
    return json({ ok: true });
  } catch (error) {
    return failure(
      error instanceof VoiceStateError
        ? new RequestError(error.message, 409)
        : error,
    );
  }
}
