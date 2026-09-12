import { checkForm, noteText } from "@/lib/shift-form";
import { database, failure, getRow, identity, json, RequestError, toNote, readBody } from "@/lib/notes-server";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const user=await identity(request); const {id}=await context.params; const body=await readBody(request); const row=await getRow(id,user.userId); const note=toNote(row);
    if (note.status === "complete") throw new RequestError("This note is already complete.",409);
    if (body.revision !== note.revision) throw new RequestError("Review the latest version of your note.",409);
    const validation=checkForm(note.fields);
    if (!validation.ready) return json({error:"Some details still need an answer.",validation},422);
    const confirmationId=crypto.randomUUID();
    const result=await database().prepare("UPDATE shift_notes SET confirmation_id=?,review_version=revision WHERE id=? AND owner_id=? AND revision=? AND status='draft'").bind(confirmationId,id,user.userId,note.revision).run();
    if (!result.meta.changes) throw new RequestError("The note changed. Review the latest version.",409);
    return json({note,confirmationId,summary:noteText(note),validation});
  } catch(error) { return failure(error); }
}
