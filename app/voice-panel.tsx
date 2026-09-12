"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, LoaderCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkForm, definitions, incidentOptions, followUpOptions, type ShiftNote } from "@/lib/shift-form";
import { hasConfirmationPrompt, isVoiceConfirmation, type VoiceEvent } from "@/lib/voice-state";

type Props={signedIn:boolean;disabled:boolean;note:ShiftNote|null;prepareDraft:()=>Promise<ShiftNote>;onSaved:(note:ShiftNote)=>void;onActive:(active:boolean)=>void};
type Session={id:string;conversationId:string;note:ShiftNote;sequence:number;generation:number};
type Pending={confirmationId:string;revision:number;promptSequence:number|null;sawSpeaking:boolean;ready:boolean;confirmedSequence:number|null};
type ApiReview={note:ShiftNote;confirmationId:string;summary:string};
async function request<T>(path:string,body?:unknown,method=body===undefined?"GET":"POST"):Promise<T>{
  const response=await fetch(path,{method,headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
  const text=await response.text();let result:T&{error?:string};
  try{result=JSON.parse(text);}catch{throw new Error("The service could not respond. End the call and try again.");}
  if(!response.ok)throw new Error(result.error||"The request failed. Your saved draft is still available.");
  return result;
}

export default function VoicePanel(props:Props){
  const [attempt,setAttempt]=useState({key:0,error:""});
  return <ConversationProvider key={attempt.key}><VoiceControls {...props} initialError={attempt.error} onReset={error=>setAttempt(old=>old.key===attempt.key?{key:old.key+1,error}:old)}/></ConversationProvider>;
}
function VoiceControls({signedIn,disabled,note,prepareDraft,onSaved,onActive,initialError,onReset}:Props&{initialError:string;onReset:(error:string)=>void}){
  const [available,setAvailable]=useState<boolean|null>(null);
  const [phase,setPhase]=useState<"idle"|"starting"|"active"|"stopping">("idle");
  const [error,setError]=useState(initialError);
  const [messages,setMessages]=useState<VoiceEvent[]>([]);
  const [confirmReady,setConfirmReady]=useState(false);
  const active=useRef<Session|null>(null);
  const pending=useRef<Pending|null>(null);
  const generation=useRef(0);
  const queue=useRef<Promise<unknown>>(Promise.resolve());
  const latest=useRef({onSaved,onActive,prepareDraft});
  const locked=useRef(false);
  const closing=useRef(false);
  const startup=useRef<Promise<void>>(Promise.resolve());
  const mode=useRef("listening");
  const readinessTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const startupTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{latest.current={onSaved,onActive,prepareDraft};},[onSaved,onActive,prepareDraft]);
  useEffect(()=>{let live=true;request<{enabled:boolean}>("/api/voice/status").then(data=>{if(live)setAvailable(data.enabled);}).catch(()=>{if(live)setAvailable(false);});return()=>{live=false;};},[]);

  function sessionRequest<T>(session:Session,body:unknown){return request<T>(`/api/voice/sessions/${session.id}`,body);}
  function enqueue<T>(session:Session,job:()=>Promise<T>):Promise<T>{
    const work=queue.current.then(()=>{if(active.current!==session)throw new Error("This call has ended. Start again to resume your draft.");return job();});
    queue.current=work.catch(()=>{});return work;
  }
  function saved(session:Session,value:ShiftNote){session.note=value;if(active.current===session)latest.current.onSaved(value);}
  function clearPending(){pending.current=null;setConfirmReady(false);if(readinessTimer.current){clearTimeout(readinessTimer.current);readinessTimer.current=null;}}
  function clearTimer(){if(startupTimer.current){clearTimeout(startupTimer.current);startupTimer.current=null;}}
  function finish(message=""){
    if(closing.current||!locked.current)return;
    closing.current=true;generation.current++;clearTimer();clearPending();setPhase("stopping");
    conversation.endSession();
    // Drain admitted saves and startup before remounting the SDK provider. Its old
    // pending connections/callbacks must never be shared with the next attempt.
    void (async()=>{
      await startup.current.catch(()=>{});
      await queue.current.catch(()=>{});
      const session=active.current;
      if(session){
        await sessionRequest(session,{action:"close"}).catch(()=>{});
        try{const result=await request<{note:ShiftNote}>(`/api/notes/${session.note.id}`);saved(session,result.note);}catch{}
      }
      active.current=null;latest.current.onActive(false);onReset(message);
    })();
  }
  function stop(){finish();}
  function fatal(message:string){setError(message);finish(message);}
  function invalidate(){
    const session=active.current;if(!session||closing.current)return;clearPending();
    const event:VoiceEvent={sequence:++session.sequence,kind:"interrupt",text:"Readback interrupted or corrected"};
    void enqueue(session,()=>sessionRequest(session,{action:"event",event})).catch(e=>{if(active.current===session)fatal(e.message);});
  }
  function markReady(){
    const session=active.current;const review=pending.current;
    if(closing.current||!session||!review||review.ready||!review.sawSpeaking||!review.promptSequence)return;
    review.ready=true;
    void enqueue(session,()=>sessionRequest(session,{action:"readback",confirmationId:review.confirmationId,sequence:review.promptSequence}))
      .then(()=>{if(active.current===session&&pending.current===review)setConfirmReady(true);})
      .catch(()=>{if(active.current===session){clearPending();setError("The review was interrupted. Ask the assistant to read it again, or end the call and confirm on screen.");}});
  }
  function scheduleReady(){
    if(readinessTimer.current)clearTimeout(readinessTimer.current);
    readinessTimer.current=setTimeout(()=>{if(mode.current==="listening")markReady();},650);
  }
  async function tool(name:string,params:Record<string,unknown>):Promise<string>{
    const session=active.current;if(!session||closing.current)throw new Error("No active LegalMate session. This conversation cannot save a form.");
    return enqueue(session,async()=>{
      try{
        if(name==="get_form_context"){
          const result=await request<{note:ShiftNote}>(`/api/notes/${session.note.id}`);saved(session,result.note);
          return JSON.stringify({ok:true,note:result.note,definitions,incidentOptions,followUpOptions,validation:checkForm(result.note.fields),currentLocalTime:new Date().toLocaleString("en-AU",{timeZone:"Australia/Melbourne"})});
        }
        if(name==="update_and_check_form"){
          clearPending();await sessionRequest(session,{action:"invalidate"});
          if(typeof params.fields_json!=="string")throw new Error("fields_json must be a JSON object encoded as a string.");
          let fields:unknown;try{fields=JSON.parse(params.fields_json);}catch{throw new Error("fields_json is not valid JSON. Correct it and retry.");}
          const result=await request<{note:ShiftNote}>(`/api/notes/${session.note.id}`,{revision:session.note.revision,fields},"PATCH");saved(session,result.note);
          return JSON.stringify({ok:true,note:result.note,validation:checkForm(result.note.fields)});
        }
        if(name==="prepare_confirmation"){
          clearPending();const result=await request<ApiReview>(`/api/notes/${session.note.id}/review`,{revision:session.note.revision});
          await sessionRequest(session,{action:"prepare",confirmationId:result.confirmationId,revision:result.note.revision});
          saved(session,result.note);pending.current={confirmationId:result.confirmationId,revision:result.note.revision,promptSequence:null,sawSpeaking:false,ready:false,confirmedSequence:null};
          return JSON.stringify({ok:true,...result,instruction:"Read back every saved field, uncertainty and follow-up in the summary. Finish by saying: To save this note, say I confirm this shift note, or tell me what to change. Wait for a new answer before calling finalize_form."});
        }
        if(name==="finalize_form"){
          const review=pending.current;
          if(!review||!review.ready||!review.confirmedSequence||params.confirmationId!==review.confirmationId||review.revision!==session.note.revision)throw new Error("No new explicit confirmation after the current review. Read the saved note again and ask the worker to say: I confirm this shift note.");
          const result=await request<{note:ShiftNote}>(`/api/notes/${session.note.id}/confirm`,{revision:review.revision,confirmationId:review.confirmationId,confirmed:true,voiceSessionId:session.id});
          saved(session,result.note);clearPending();return JSON.stringify({ok:true,note:result.note,message:"The confirmed note is saved. Tell the worker it is complete; they can end this call."});
        }
        throw new Error("Unknown LegalMate tool.");
      }catch(e){
        const message=e instanceof Error?e.message:"Could not save the note.";
        // A lost PATCH response may still have saved. Refresh before another tool can write.
        try{const latestNote=await request<{note:ShiftNote}>(`/api/notes/${session.note.id}`);saved(session,latestNote.note);}catch{}
        clearPending();await sessionRequest(session,{action:"invalidate"}).catch(()=>{});
        setError(message);return JSON.stringify({ok:false,error:message,action:"Do not claim success. Address the problem, then prepare a fresh review before confirmation."});
      }
    });
  }
  const conversation=useConversation({
    clientTools:{get_form_context:params=>tool("get_form_context",params),update_and_check_form:params=>tool("update_and_check_form",params),prepare_confirmation:params=>tool("prepare_confirmation",params),finalize_form:params=>tool("finalize_form",params)},
    onConnect:({conversationId})=>{if(closing.current)return;const session=active.current;if(!session){conversation.endSession();return;}if(conversationId!==session.conversationId){fatal("The voice session could not be verified. Start again.");return;}clearTimer();setPhase("active");},
    onMessage:({role,message,event_id})=>{
      const session=active.current;if(!session||closing.current)return;
      const event:VoiceEvent={sequence:++session.sequence,kind:role,text:message,eventId:event_id};
      setMessages(items=>[...items,event].slice(-12));
      const review=pending.current;
      if(role==="agent"&&review&&hasConfirmationPrompt(message))review.promptSequence=event.sequence;
      if(role==="user"&&review){
        if(review.ready&&isVoiceConfirmation(message))review.confirmedSequence=event.sequence;
        else clearPending();
      }
      void enqueue(session,()=>sessionRequest(session,{action:"event",event})).catch(e=>{if(active.current===session)fatal(e.message);});
      if(role==="agent"&&mode.current==="listening")scheduleReady();
    },
    onModeChange:({mode:value})=>{if(closing.current)return;mode.current=value;const review=pending.current;if(value==="speaking"){if(readinessTimer.current)clearTimeout(readinessTimer.current);if(review)review.sawSpeaking=true;}else scheduleReady();},
    onInterruption:()=>invalidate(),onAgentResponseCorrection:()=>invalidate(),
    onError:()=>{if(!closing.current)fatal("The voice connection stopped. Your saved draft is safe; end or restart the call to continue.");},
    onDisconnect:()=>finish(),
  });
  useEffect(()=>()=>{closing.current=true;clearTimer();if(readinessTimer.current)clearTimeout(readinessTimer.current);const session=active.current;active.current=null;generation.current++;if(session)void queue.current.then(()=>sessionRequest(session,{action:"close"})).catch(()=>{});},[]);
  function start(){
    if(locked.current||disabled||!signedIn)return;locked.current=true;closing.current=false;const run=++generation.current;setPhase("starting");setError("");setMessages([]);clearPending();latest.current.onActive(true);
    startup.current=Promise.resolve().then(async()=>{
    try{
      // Permission is requested only after the worker presses Start voice note.
      const permission=await navigator.mediaDevices.getUserMedia({audio:true});permission.getTracks().forEach(track=>track.stop());
      if(run!==generation.current)return;
      const draft=await latest.current.prepareDraft();
      if(run!==generation.current)return;
      const data=await request<{sessionId:string;conversationId:string;conversationToken:string}>("/api/voice/sessions",{noteId:draft.id});
      if(run!==generation.current){await request(`/api/voice/sessions/${data.sessionId}`,{action:"close"}).catch(()=>{});return;}
      active.current={id:data.sessionId,conversationId:data.conversationId,note:draft,sequence:0,generation:run};queue.current=Promise.resolve();
      startupTimer.current=setTimeout(()=>{if(generation.current===run)fatal("The voice connection took too long. Please try again.");},25000);
      conversation.startSession({conversationToken:data.conversationToken,connectionType:"webrtc"});
    }catch(e){if(run===generation.current)fatal(e instanceof DOMException&&e.name==="NotAllowedError"?"Microphone access was denied. Allow microphone access for this site, then try again.":e instanceof Error?e.message:"Could not start voice. Please try again.");}
    });
  }
  return <div className="voice-intro voice-live">
    <div className={`mic-symbol ${note?.status==="complete"?"done":""}`}>{note?.status==="complete"?<Check size={35}/>:<Mic size={35}/>}</div>
    <h2>{phase==="starting"?"Connecting…":phase==="active"?(conversation.isSpeaking?"Your assistant is speaking":"Tell me about your shift"):note?.status==="complete"?"Your note is saved.":"Let’s talk through your shift."}</h2>
    <p>{phase==="active"?"Your answers are saved into the form as you speak.":note?.status==="complete"?"Your confirmed note is ready in Review notes.":"Use fictional participant details for this demo. Your audio is sent to ElevenLabs and a transcript is kept with this session."}</p>
    {phase==="idle"?<Button className="voice-button" disabled={!available||!signedIn||disabled||note?.status==="complete"} onClick={start}><Mic size={18}/>Start voice note</Button>:<div className="call-buttons"><Button className="voice-button" disabled={phase==="stopping"} onClick={stop}><PhoneOff size={17}/>{phase==="stopping"?"Ending call…":"End call"}</Button>{phase==="active"&&<Button variant="outline" className="voice-button" onClick={()=>conversation.setMuted(!conversation.isMuted)} aria-label={conversation.isMuted?"Unmute microphone":"Mute microphone"}>{conversation.isMuted?<MicOff size={17}/>:<Mic size={17}/>}</Button>}</div>}
    <p className="voice-caption" aria-live="polite">{phase==="starting"?<><LoaderCircle className="spin inline" size={14}/> Connecting securely</>:phase==="active"?conversation.isMuted?"Microphone muted":confirmReady?"After the review, say: I confirm this shift note.":"Call connected":available===null?"Checking voice connection…":!available?"Voice setup pending":!signedIn?"Sign in to start":"English · Up to 10 minutes per call"}</p>
    {error&&<p className="voice-error" role="alert">{error}</p>}
    {messages.length>0&&<div className="voice-transcript" aria-label="Conversation transcript">{messages.slice(-5).map(message=><p key={message.sequence}><strong>{message.kind==="user"?"You":"Assistant"}</strong>{message.text}</p>)}</div>}
  </div>;
}
