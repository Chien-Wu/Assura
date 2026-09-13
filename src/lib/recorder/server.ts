import { database, RequestError } from "@/lib/shared/server";
import { env } from "cloudflare:workers";
import { noCurrentAssessmentSql } from "../assessment/server";
import { type VoiceState } from "./state";
export function voiceConfig() {
  return {
    key: env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY,
    agentId: env.ELEVENLABS_AGENT_ID || process.env.ELEVENLABS_AGENT_ID,
  };
}
export type VoiceSessionRow = {
  id: string;
  owner_id: string;
  note_id: string;
  conversation_id: string;
  created_at: string;
  expires_at: string;
  state_json: string;
  revision: number;
};
export async function getVoiceSession(
  id: unknown,
  ownerId: string,
  noteId?: string,
) {
  if (typeof id !== "string") throw new RequestError("Invalid voice session.");
  const row = await database()
    .prepare("SELECT * FROM voice_sessions WHERE id=? AND owner_id=?")
    .bind(id, ownerId)
    .first<VoiceSessionRow>();
  if (!row || (noteId && row.note_id !== noteId))
    throw new RequestError("This voice session could not be found.", 404);
  if (row.expires_at <= new Date().toISOString())
    throw new RequestError(
      "This voice session has expired. Start again to resume your draft.",
      409,
    );
  return row;
}
export async function saveVoiceState(
  row: VoiceSessionRow,
  state: VoiceState,
  extraStatements: D1PreparedStatement[] = [],
) {
  const statement = database()
    .prepare(
      "UPDATE voice_sessions SET state_json=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=?" +
        (state.closed
          ? ""
          : " AND EXISTS (SELECT 1 FROM shift_notes WHERE id=voice_sessions.note_id AND owner_id=voice_sessions.owner_id AND status='draft' AND " +
            noCurrentAssessmentSql +
            ")"),
    )
    .bind(JSON.stringify(state), row.id, row.owner_id, row.revision);
  const result = await database().batch([statement, ...extraStatements]);
  if (!result[0].meta.changes)
    throw new RequestError(
      "The voice session changed. Please end the call and resume the saved draft.",
      409,
    );
}
