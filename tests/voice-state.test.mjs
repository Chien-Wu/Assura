import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyVoiceState, appendVoiceEvent, markReadback, voiceEvidence, isVoiceConfirmation } from "../lib/voice-state.ts";
const prepared=()=>({...emptyVoiceState(),review:{confirmationId:"current",revision:2,afterSequence:0,readbackSequence:null}});
const add=(state,kind,text)=>appendVoiceEvent(state,{sequence:state.events.length+1,kind,text});
const read=()=>markReadback(add(prepared(),"agent","To save this note, say I confirm this shift note, or tell me what to change."),"current",1);
test("only a fresh full confirmation after the current review completes a note",()=>{
  assert.throws(()=>voiceEvidence(read(),"current",2));
  const confirmed=add(read(),"user","I confirm this shift note.");
  assert.equal(voiceEvidence(confirmed,"current",2).userTurn.sequence,2);
  assert.throws(()=>voiceEvidence(confirmed,"old",2));
  assert.throws(()=>voiceEvidence(confirmed,"current",1));
  assert.throws(()=>voiceEvidence({...confirmed,closed:true},"current",2));
  assert.equal(isVoiceConfirmation("I confirm this shift note, but change the time"),false);
});
test("yes, silence, and an old confirmation cannot complete the draft",()=>{
  assert.throws(()=>voiceEvidence(add(read(),"user","yes"),"current",2));
  let state=add(emptyVoiceState(),"user","I confirm this shift note.");
  state={...state,review:{confirmationId:"current",revision:2,afterSequence:1,readbackSequence:null}};
  state=markReadback(add(state,"agent","Say I confirm this shift note."),"current",2);
  assert.throws(()=>voiceEvidence(state,"current",2));
});
test("an early correction or early confirmation invalidates pending readback",()=>{
  for(const text of ["Actually I finished at five","I confirm this shift note."]){
    const state=add(add(prepared(),"user",text),"agent","Say I confirm this shift note.");
    assert.equal(state.review,null);
    assert.throws(()=>markReadback(state,"current",2));
  }
});
test("corrections and interruptions invalidate already prepared evidence",()=>{
  const state=add(read(),"user","I confirm this shift note.");
  for(const [kind,text] of [["interrupt","Interrupted"],["user","Actually the shift ended later"]]){
    assert.throws(()=>voiceEvidence(add(state,kind,text),"current",2));
  }
});
test("transcript retries are idempotent while conflicting or missing events are rejected",()=>{
  const event={sequence:1,kind:"user",text:"Hello"};
  const state=appendVoiceEvent(emptyVoiceState(),event);
  assert.equal(appendVoiceEvent(state,event),state);
  assert.throws(()=>appendVoiceEvent(state,{...event,text:"Different"}));
  assert.throws(()=>appendVoiceEvent(state,{...event,sequence:3}));
  assert.throws(()=>appendVoiceEvent(state,undefined));
});
