import { createNote, listNotes } from "@/lib/notes/server";
import { failure, identity, json, readBody } from "@/lib/shared/server";
import { requireWorker } from "@/lib/roster/organisations-server";
export async function GET(request: Request) {
  try {
    const user = await identity(request);
    return json({ notes: await listNotes(user.userId) });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const body = await readBody(request);
    const worker = await requireWorker(user);
    return json(
      {
        note: await createNote(
          body.id,
          user.userId,
          worker.providerId,
          body.shiftId,
        ),
      },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
