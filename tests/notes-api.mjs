import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const origin="http://localhost:5173";
let cookie="";
let assertions=0;
async function request(path,method="GET",body,expected=200,extraHeaders={}) {
  const response=await fetch(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{"Content-Type":"application/json",Origin:origin}:{}),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await response.text();
  let result;try{result=JSON.parse(raw);}catch{result={error:raw};}
  assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(result)}`);assertions++;
  return result;
}
await request("/api/notes","GET",undefined,401);
const signIn=await fetch(origin+"/signin-with-chatgpt?return_to=/",{redirect:"manual"});
cookie=signIn.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
assert.ok(cookie,"Local sign-in must issue a development cookie");
const id=randomUUID();
const first=await request("/api/notes","POST",{id},201);
assert.equal(first.note.revision,0);assert.equal(first.note.fields.incidents,"unanswered");
const retry=await request("/api/notes","POST",{id},201);assert.equal(retry.note.id,id);
await request(`/api/notes/${id}/review`,"POST",{revision:0},422);
await request(`/api/notes/${id}`,"PATCH",{revision:0,fields:{ownerId:"someone-else"}},400);
const fields={participant:"API test — fictional",shiftStart:"2026-09-12T14:00",shiftEnd:"2026-09-12T18:00",activities:"Shopping",supportProvided:"Verbal prompts",participantResponse:"Selected items independently",goalProgress:"Practised shopping",incidents:"no",incidentDetails:"",followUp:"none",followUpDetails:""};
const saved=await request(`/api/notes/${id}`,"PATCH",{revision:0,fields});assert.equal(saved.note.revision,1);
await request(`/api/notes/${id}`,"PATCH",{revision:0,fields:{activities:"Stale answer"}},409);
const review=await request(`/api/notes/${id}/review`,"POST",{revision:1});
await request(`/api/notes/${id}`,"PATCH",{revision:1,fields:{shiftEnd:"2026-09-12T17:00"}});
await request(`/api/notes/${id}/confirm`,"POST",{revision:1,confirmationId:review.confirmationId,confirmed:true},409);
const updated=await request(`/api/notes/${id}`);assert.equal(updated.note.fields.shiftEnd,"2026-09-12T17:00");
const fresh=await request(`/api/notes/${id}/review`,"POST",{revision:2});
const confirmation={revision:2,confirmationId:fresh.confirmationId,confirmed:true};
await request(`/api/notes/${id}/confirm`,"POST",{...confirmation,confirmed:"yes"},409);
const completed=await request(`/api/notes/${id}/confirm`,"POST",confirmation);assert.equal(completed.note.status,"complete");
const duplicate=await request(`/api/notes/${id}/confirm`,"POST",confirmation);assert.equal(duplicate.note.confirmedAt,completed.note.confirmedAt);
await request(`/api/notes/${id}`,"PATCH",{revision:2,fields:{activities:"Changed after confirmation"}},409);
await request(`/api/notes/${randomUUID()}`,"GET",undefined,404);
await request("/api/notes","POST",{id:randomUUID()},403,{Origin:"https://untrusted.example"});
const list=await request("/api/notes");assert.equal(list.notes.filter(item=>item.id===id).length,1);
console.log(JSON.stringify({passed:true,httpChecks:assertions,testNoteId:id}));
