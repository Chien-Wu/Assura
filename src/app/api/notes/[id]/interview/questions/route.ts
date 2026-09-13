import { getReadableRow } from "@/lib/notes/server";
import { failure, identity, json, readBody } from "@/lib/shared/server";
import { KnowledgeError } from "@/lib/knowledge/server";
import {
  interviewAudit,
  registerFollowup,
} from "@/lib/knowledge/interview-server";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const row = await getReadableRow(id, user);
    return json({
      questions: await interviewAudit(id, row.owner_id, user.userId),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    return json(
      await registerFollowup(id, user.userId, await readBody(request)),
    );
  } catch (e) {
    if (e instanceof KnowledgeError)
      return json({ error: e.message, code: e.code }, e.status);
    return failure(e);
  }
}
