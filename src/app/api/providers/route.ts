import { failure, json } from "@/lib/shared/server";
import { listProviders } from "@/lib/roster/organisations-server";

export async function GET() {
  try {
    // Public signup choices contain only active organisations' IDs and names.
    return json({ providers: await listProviders() });
  } catch (error) {
    return failure(error);
  }
}
