import { env } from "cloudflare:workers";
import { database, RequestError } from "./notes-server";
import { type VoiceState } from "./voice-state";
export function voiceConfig(){return {key:env.ELEVENLABS_API_KEY||process.env.ELEVENLABS_API_KEY,agentId:env.ELEVENLABS_AGENT_ID||process.env.ELEVENLABS_AGENT_ID};}
export type VoiceSessionRow={id:string;owner_id:string;note_id:string;conversation_id:string;created_at:string;expires_at:string;state_json:string;revision:number};
export async function getVoiceSession(id:unknown,ownerId:string,noteId?:string) {
  if(typeof id!=="string")throw new RequestError("Invalid voice session.");
  const row=await database().prepare("SELECT * FROM voice_sessions WHERE id=? AND owner_id=?").bind(id,ownerId).first<VoiceSessionRow>();
  if(!row||(noteId&&row.note_id!==noteId))throw new RequestError("This voice session could not be found.",404);
  if(row.expires_at<=new Date().toISOString())throw new RequestError("This voice session has expired. Start again to resume your draft.",409);
  return row;
}
export async function saveVoiceState(row:VoiceSessionRow,state:VoiceState){
  const result=await database().prepare("UPDATE voice_sessions SET state_json=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=?").bind(JSON.stringify(state),row.id,row.owner_id,row.revision).run();
  if(!result.meta.changes)throw new RequestError("The voice session changed. Please end the call and resume the saved draft.",409);
}
