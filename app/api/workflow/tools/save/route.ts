import { workflowTool, workflowFailure } from "@/lib/workflow-server";
export async function POST(request: Request) {
  try {
    return await workflowTool(request, "save");
  } catch (error) {
    return workflowFailure(error);
  }
}
