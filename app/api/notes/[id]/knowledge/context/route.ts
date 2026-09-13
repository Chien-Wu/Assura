import { failure, identity, json } from "@/lib/notes-server";
import { getParticipantContext, KnowledgeError } from "@/lib/knowledge-server";
import {
  listInterviewQuestions,
  remainingClarifications,
} from "@/lib/interview-server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const result = await getParticipantContext(id, user.userId);
    return json({
      ...result,
      questions: await listInterviewQuestions(id, user.userId),
      remainingClarifications: await remainingClarifications(id, user.userId),
    });
  } catch (e) {
    if (e instanceof KnowledgeError)
      return json({ error: e.message, code: e.code }, e.status);
    return failure(e);
  }
}
