import { startWorkflowSession, workflowFailure } from "@/lib/workflow/server";
export async function POST(request: Request) {
  try {
    return await startWorkflowSession(request);
  } catch (error) {
    return workflowFailure(error);
  }
}
