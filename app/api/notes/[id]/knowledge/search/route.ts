import { failure, identity, json, readBody } from "@/lib/notes-server";
import {
  searchParticipantRecords,
  KnowledgeError,
} from "@/lib/knowledge-server";
import {
  listInterviewQuestions,
  remainingClarifications,
} from "@/lib/interview-server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    const result = await searchParticipantRecords(id, user.userId, {
      query: body.query,
      revision: body.revision,
      voiceSessionId: body.voiceSessionId,
      currentTurnQuote: body.currentTurnQuote,
    });
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
