import { failure, getRow, identity, json, readBody, RequestError } from "@/lib/notes-server";
import { getVoiceSession, saveVoiceState } from "@/lib/voice-server";
import { appendVoiceEvent, markReadback, VoiceStateError, type VoiceEvent, type VoiceState } from "@/lib/voice-state";
import { captureEvent, safetyContext } from "@/lib/audit-server";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const user=await identity(request);const {id}=await context.params;const body=await readBody(request);
    const row=await getVoiceSession(id,user.userId);let state=JSON.parse(row.state_json) as VoiceState;
    if(state.closed&&body.action!=="close")throw new RequestError("This voice session has ended.",409);
    if(body.action==="event"){
      const next=appendVoiceEvent(state,body.event as VoiceEvent);
      if(next!==state&&!await captureEvent(row,next,body.event as VoiceEvent))throw new RequestError("The session changed. Please retry the same message.",409);
      return json({ok:true,...await safetyContext(row.note_id,user.userId)});
    }
    else if(body.action==="invalidate")state={...state,review:null};
    else if(body.action==="close")state={...state,closed:true,review:null};
    else if(body.action==="prepare"){
      const note=await getRow(row.note_id,user.userId);
      if(typeof body.confirmationId!=="string"||note.status!=="draft"||note.confirmation_id!==body.confirmationId||note.review_version!==note.revision||body.revision!==note.revision)throw new RequestError("Prepare the current saved note for review first.",409);
      state={...state,review:{confirmationId:body.confirmationId,revision:note.revision,afterSequence:state.events.length,readbackSequence:null}};
    }else if(body.action==="readback")state=markReadback(state,String(body.confirmationId),Number(body.sequence));
    else throw new RequestError("Invalid voice session action.");
    await saveVoiceState(row,state);return json({ok:true});
  }catch(error){return failure(error instanceof VoiceStateError?new RequestError(error.message,409):error);}
}
