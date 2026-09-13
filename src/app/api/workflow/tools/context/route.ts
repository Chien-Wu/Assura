import { workflowTool, workflowFailure } from "@/lib/workflow/server";
export async function GET(request: Request) {
  try {
    return await workflowTool(request, "context");
  } catch (error) {
    return workflowFailure(error);
  }
}
