// Optional live test: runs one real text conversation using fictional details.
// Requires the local preview and a configured ElevenLabs key; uses Agent credits.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Conversation } from "@elevenlabs/client";
import { checkForm, definitions, incidentOptions, followUpOptions } from "../lib/shift-form.ts";
import { hasConfirmationPrompt } from "../lib/voice-state.ts";
const origin="http://localhost:5173";
const signIn=await fetch(origin+"/signin-with-chatgpt?return_to=/",{redirect:"manual"});
const cookie=signIn.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
async function api(path,body,method=body===undefined?"GET":"POST"){
  const response=await fetch(origin+path,{method,headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;
}
let note=(await api("/api/notes",{id:randomUUID()})).note;
console.log(JSON.stringify({testNoteId:note.id}));
const session=await api("/api/voice/sessions",{noteId:note.id,mode:"text"});
assert.equal(session.mode,"text");assert.ok(session.signedUrl);assert.equal(session.conversationToken,undefined);
const path=`/api/voice/sessions/${session.sessionId}`;
let queue=Promise.resolve(),sequence=0,review=null,stage=0,toolCalls=0,conversation,failed,lastActivity=Date.now();
const promptedStages=new Set();
let complete,fail;
const done=new Promise((resolve,reject)=>{complete=resolve;fail=reject;});
const deadline=setTimeout(()=>fail(new Error("Text conversation timed out")),120000);
const followUp=setInterval(()=>{
  if(conversation&&stage<2&&!review&&checkForm(note.fields).ready&&Date.now()-lastActivity>12000&&!promptedStages.has(stage)){
    promptedStages.add(stage);lastActivity=Date.now();
    console.log(JSON.stringify({followUp:"Requesting the review after the Agent stopped at announcing it"}));
    void enqueue(()=>send("Please prepare the current saved note for confirmation and show the full review now.")).catch(()=>{});
  }
},1000);
const enqueue=job=>{const work=queue.then(job);queue=work.catch(error=>{failed=error;fail(error);});return work;};
const record=(kind,text)=>api(path,{action:"event",event:{sequence:++sequence,kind,text}});
const send=async text=>{await record("user",text);conversation.sendUserMessage(text);};
function tool(name,run){return params=>enqueue(async()=>{
  if(++toolCalls>25)throw new Error("Tool budget exceeded");
  lastActivity=Date.now();
  console.log(JSON.stringify({tool:name}));
  return JSON.stringify(await run(params));
});}
try{
  conversation=await Conversation.startSession({signedUrl:session.signedUrl,connectionType:"websocket",textOnly:true,
    clientTools:{
      get_form_context:tool("get_form_context",async()=>({ok:true,note,definitions,incidentOptions,followUpOptions,validation:checkForm(note.fields),currentLocalTime:"12 September 2026, 5:00 pm Australia/Melbourne"})),
      update_and_check_form:tool("update_and_check_form",async params=>{
        review=null;await api(path,{action:"invalidate"});
        note=(await api(`/api/notes/${note.id}`,{revision:note.revision,fields:JSON.parse(params.fields_json)},"PATCH")).note;
        return {ok:true,note,validation:checkForm(note.fields)};
      }),
      prepare_confirmation:tool("prepare_confirmation",async()=>{
        review=await api(`/api/notes/${note.id}/review`,{revision:note.revision});
        await api(path,{action:"prepare",revision:note.revision,confirmationId:review.confirmationId});
        return {ok:true,...review,instruction:"Read back every saved field, uncertainty and follow-up in the summary. Finish by saying: To save this note, say I confirm this shift note, or tell me what to change. Wait for a new answer before calling finalize_form."};
      }),
      finalize_form:tool("finalize_form",async params=>{
        assert.equal(stage,2,"Must apply correction and receive new confirmation");
        assert.equal(params.confirmationId,review.confirmationId);
        note=(await api(`/api/notes/${note.id}/confirm`,{revision:note.revision,confirmationId:params.confirmationId,confirmed:true,voiceSessionId:session.sessionId})).note;
        complete();return {ok:true,note,message:"The confirmed note is saved."};
      }),
    },
    onConnect:({conversationId})=>assert.equal(conversationId,session.conversationId),
    onMessage:({role,message})=>{
      if(role!=="agent")return;
      lastActivity=Date.now();
      console.log(JSON.stringify({assistant:message}));
      void enqueue(async()=>{
        await record("agent",message);
        if(review&&hasConfirmationPrompt(message)){
          await api(path,{action:"readback",confirmationId:review.confirmationId,sequence});
          if(stage===0){stage=1;await send("Actually, the shift ended at 3:30 pm on 12 September 2026. Everything else is unchanged. Please save this correction and review the updated note.");}
          else if(stage===1){assert.equal(note.fields.shiftEnd,"2026-09-12T15:30");stage=2;await send("I confirm this shift note.");}
        }
      }).catch(()=>{});
    },
    onError:()=>fail(new Error("ElevenLabs text connection failed")),
  });
  await enqueue(()=>send("This is a fictional test. On 12 September 2026 I supported Text Test Alex from 9 am to 3 pm Melbourne time. We went grocery shopping. I provided verbal prompts at checkout. Alex chose items independently and practised budgeting toward their independent shopping goal. There were no incidents and no follow-up actions needed. Please save these answers and review the note."));
  await done;await queue;if(failed)throw failed;
  assert.equal(note.status,"complete");assert.equal(note.fields.shiftEnd,"2026-09-12T15:30");
  console.log(JSON.stringify({passed:true,mode:"text",toolCalls,correctedEndTime:note.fields.shiftEnd,status:note.status,testNoteId:note.id}));
}finally{
  clearTimeout(deadline);clearInterval(followUp);await conversation?.endSession();await queue.catch(()=>{});await api(path,{action:"close"});
}
