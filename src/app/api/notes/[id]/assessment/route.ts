import {
  assessmentPayload,
  startAssessment,
  advanceAssessment,
} from "@/lib/assessment/server";
import {
  failure,
  identity,
  json,
  readBody,
  RequestError,
} from "@/lib/shared/server";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    return json(await assessmentPayload(id, user.userId));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    if (body.action === "start")
      await startAssessment(id, user.userId, body.revision);
    else if (body.action === "answer" || body.action === "retry")
      await advanceAssessment(id, user.userId, body);
    else throw new RequestError("Choose start or retry.");
    return json(await assessmentPayload(id, user.userId));
  } catch (error) {
    return failure(error);
  }
}
