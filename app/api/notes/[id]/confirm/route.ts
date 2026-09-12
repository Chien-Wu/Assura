import { checkForm } from "@/lib/shift-form";
import { database, failure, getRow, identity, json, RequestError, toNote, readBody } from "@/lib/notes-server";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const user=await identity(request); const {id}=await context.params; const body=await readBody(request); const row=await getRow(id,user.userId);
    if (body.confirmed !== true || typeof body.confirmationId !== "string" || !body.confirmationId || body.confirmationId!==row.confirmation_id || body.revision!==row.revision || row.review_version!==row.revision) throw new RequestError("Please review and explicitly confirm the current note.",409);
    if (row.status === "complete") return json({note:toNote(row)});
    if (!checkForm(JSON.parse(row.fields_json)).ready) throw new RequestError("Some details still need an answer.",422);
    const now=new Date().toISOString();
    const result=await database().prepare("UPDATE shift_notes SET status='complete',confirmed_at=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND review_version=revision AND confirmation_id=? AND status='draft'").bind(now,now,id,user.userId,row.revision,body.confirmationId).run();
    if (!result.meta.changes) throw new RequestError("The note changed. Please review it again.",409);
    return json({note:toNote(await getRow(id,user.userId))});
  } catch(error) { return failure(error); }
}
