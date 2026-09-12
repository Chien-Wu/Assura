import { createNote, failure, identity, json, listNotes, readBody } from "@/lib/notes-server";
export async function GET(request: Request) {
  try { const user=await identity(request); return json({notes:await listNotes(user.userId)}); } catch(error) { return failure(error); }
}
export async function POST(request: Request) {
  try { const user=await identity(request); const body=await readBody(request); return json({note:await createNote(body.id,user.userId,user.displayName)},201); } catch(error) { return failure(error); }
}
