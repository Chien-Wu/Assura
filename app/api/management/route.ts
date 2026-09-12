import { database,failure,identity,json,listNotes,RequestError } from "@/lib/notes-server";
import { participants } from "@/lib/participants";
import { reportingGuidance } from "@/lib/safety";
export async function GET(request:Request){
  try{
    const user=await identity(request);const month=new URL(request.url).searchParams.get("month")??new Date().toISOString().slice(0,7);
    if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))throw new RequestError("Choose a valid reporting month.");
    const [notes,risks,actions,uses]=await Promise.all([
      listNotes(user.userId),
      database().prepare("SELECT * FROM risk_events WHERE owner_id=? ORDER BY captured_at DESC").bind(user.userId).all<{id:string;note_id:string;data_json:string;captured_at:string;inbox_at:string|null}>(),
      database().prepare("SELECT * FROM risk_actions WHERE owner_id=? ORDER BY created_at ASC").bind(user.userId).all<{id:string;risk_id:string;action:string;details_json:string;actor:string;created_at:string}>(),
      database().prepare("SELECT json_extract(fields_json,'$.participant') AS participant,json_extract(safety_json,'$.restrictivePractice.schedule_item') AS item,COUNT(*) AS count FROM shift_notes WHERE owner_id=? AND substr(json_extract(fields_json,'$.shiftStart'),1,7)=? AND json_extract(safety_json,'$.restrictivePractice.used')='yes' GROUP BY participant,item").bind(user.userId,month).all<{participant:string;item:string;count:number}>(),
    ]);
    const incidents=risks.results.map(risk=>{
      const history=actions.results.filter(action=>action.risk_id===risk.id).map(a=>({...a,details:JSON.parse(a.details_json)}));
      const aware=history.map(a=>a.details.providerBecameAwareAt).filter(Boolean).sort()[0]??null;
      const eventAt=history.filter(a=>a.details.eventAt).at(-1)?.details.eventAt??null;
      const notified=history.map(a=>a.details.commissionNotifiedAt).filter(Boolean).sort()[0]??null;
      return {id:risk.id,noteId:risk.note_id,...JSON.parse(risk.data_json),inboxAt:risk.inbox_at,notificationStatus:"in_app_only",providerBecameAwareAt:aware,eventAt,commissionNotifiedAt:notified,eventToAwarenessMinutes:eventAt&&aware?(Date.parse(aware)-Date.parse(eventAt))/60000:null,awarenessToCommissionMinutes:aware&&notified?(Date.parse(notified)-Date.parse(aware))/60000:null,assessment:history.filter(a=>a.details.assessment).at(-1)?.details.assessment??"Needs review",history};
    });
    const monthly=participants.flatMap(p=>p.plan.map(item=>({participantId:p.id,participant:p.name,item:item.id,description:item.description,month,recordedUses:uses.results.filter(u=>u.participant===p.name&&u.item===item.id).reduce((n,u)=>n+u.count,0)})));
    return json({notes,incidents,monthly,month,reportingGuidance,audience:"Private demo supervisor view — this signed-in workspace's records",delivery:"In-app inbox only. No external message or Commission submission is sent."});
  }catch(error){return failure(error);}
}
