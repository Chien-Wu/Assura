import { failure, identity, json } from "@/lib/notes-server";
import { requireManager } from "@/lib/organisations";
import { listProviderWorkers } from "@/lib/roster-server";

export async function GET(request: Request) {
  try {
    const manager = await requireManager(
      await identity(request),
      new URL(request.url).searchParams.get("providerId"),
    );
    return json({ workers: await listProviderWorkers(manager.providerId) });
  } catch (error) {
    return failure(error);
  }
}
