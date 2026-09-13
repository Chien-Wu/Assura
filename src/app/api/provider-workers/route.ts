import { failure, identity, json } from "@/lib/shared/server";
import { requireManager } from "@/lib/roster/organisations-server";
import { listProviderWorkers } from "@/lib/roster/participants-server";

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
