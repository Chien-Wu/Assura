import { failure, json } from "@/lib/notes-server";
import { listProviders } from "@/lib/organisations";

export async function GET() {
  try {
    // Public signup choices contain only active organisations' IDs and names.
    return json({ providers: await listProviders() });
  } catch (error) {
    return failure(error);
  }
}
