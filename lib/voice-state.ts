export type VoiceEvent = { sequence:number; kind:"user"|"agent"|"interrupt"; text:string; eventId?:number; receivedAt?:string };
export type VoiceReview = { confirmationId:string; revision:number; afterSequence:number; readbackSequence:number|null };
export type VoiceState = { events:VoiceEvent[]; review:VoiceReview|null; closed:boolean };
export class VoiceStateError extends Error {}
export const emptyVoiceState = ():VoiceState=>({events:[],review:null,closed:false});
export const normalizeConfirmation=(value:string)=>value.toLowerCase().replace(/[.!?,;:]/g,"").replace(/\s+/g," ").trim();
export const isVoiceConfirmation=(value:string)=>normalizeConfirmation(value)==="i confirm this shift note";
export const hasConfirmationPrompt=(value:string)=>/\bi confirm this shift note\b/i.test(value);

export function appendVoiceEvent(state:VoiceState,event:VoiceEvent):VoiceState {
  if(state.closed)throw new VoiceStateError("This voice session has ended.");
  if(!event||!Number.isInteger(event.sequence)||event.sequence<1||!["user","agent","interrupt"].includes(event.kind)||typeof event.text!=="string"||event.text.length>20000)throw new VoiceStateError("Invalid transcript event.");
  const existing=state.events.find(item=>item.sequence===event.sequence);
  if(existing){if(existing.kind!==event.kind||existing.text!==event.text)throw new VoiceStateError("Conflicting transcript event.");return state;}
  if(event.sequence!==state.events.length+1)throw new VoiceStateError("Transcript events arrived out of order.");
  if(state.events.length>=400)throw new VoiceStateError("This conversation is too long. End it and resume your saved draft.");
  let review=state.review;
  if(event.kind==="interrupt"||(event.kind==="user"&&review&&(!review.readbackSequence||!isVoiceConfirmation(event.text))))review=null;
  return {...state,review,events:[...state.events,{...event,receivedAt:new Date().toISOString()}]};
}
export function markReadback(state:VoiceState,confirmationId:string,sequence:number):VoiceState {
  const review=state.review;
  const event=state.events.find(item=>item.sequence===sequence);
  if(state.closed||!review||review.confirmationId!==confirmationId||sequence<=review.afterSequence||event?.kind!=="agent"||!hasConfirmationPrompt(event.text))throw new VoiceStateError("Read back the current note and ask for explicit confirmation first.");
  if(state.events.some(item=>item.sequence>sequence&&item.kind!=="agent"))throw new VoiceStateError("The worker spoke before readback was ready. Prepare a fresh review.");
  return {...state,review:{...review,readbackSequence:sequence}};
}
export function voiceEvidence(state:VoiceState,confirmationId:string,revision:number) {
  const review=state.review;
  const user=state.events.findLast(event=>event.kind==="user");
  if(state.closed||!review||review.confirmationId!==confirmationId||review.revision!==revision||!review.readbackSequence||!user||user.sequence<=review.readbackSequence||!isVoiceConfirmation(user.text))throw new VoiceStateError("Please listen to the current review, then say: I confirm this shift note.");
  return {source:"browser_sdk_transcript",method:"voice",confirmationId,revision,readbackSequence:review.readbackSequence,userTurn:user};
}
