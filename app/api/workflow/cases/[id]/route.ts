import {
  readWorkflowCase,
  changeWorkflowCase,
  workflowFailure,
} from "@/lib/workflow/server";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return await readWorkflowCase(request, (await context.params).id);
  } catch (error) {
    return workflowFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    return await changeWorkflowCase(request, (await context.params).id);
  } catch (error) {
    return workflowFailure(error);
  }
}
