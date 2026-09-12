import { applyFieldPatch, checkForm } from "@/lib/shift-form";
import { database, failure, getRow, identity, json, RequestError, toNote, readBody } from "@/lib/notes-server";
type Context = { params: Promise<{id:string}> };
export async function GET(request:Request,context:Context) {
  try { const user=await identity(request); const {id}=await context.params; return json({note:toNote(await getRow(id,user.userId))}); } catch(error) { return failure(error); }
}
export async function PATCH(request:Request,context:Context) {
  try {
    const user=await identity(request); const {id}=await context.params; const body=await readBody(request);
    const row=await getRow(id,user.userId);
    if (row.status === "complete") throw new RequestError("This note has already been confirmed.",409);
    if (body.revision !== row.revision) throw new RequestError("The saved note has changed. Reload it before making further changes.",409);
    let fields;
    try { fields=applyFieldPatch(JSON.parse(row.fields_json),body.fields); } catch(error) { throw new RequestError(error instanceof Error ? error.message : "Invalid fields."); }
    const result=await database().prepare("UPDATE shift_notes SET fields_json=?, revision=revision+1, updated_at=?, confirmation_id=NULL, review_version=NULL WHERE id=? AND owner_id=? AND revision=? AND status='draft'").bind(JSON.stringify(fields),new Date().toISOString(),id,user.userId,row.revision).run();
    if (!result.meta.changes) throw new RequestError("Another update arrived first. Reload the saved note.",409);
    return json({note:toNote(await getRow(id,user.userId)),validation:checkForm(fields)});
  } catch(error) { return failure(error); }
}
