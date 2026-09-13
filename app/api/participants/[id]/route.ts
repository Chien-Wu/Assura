import { failure, identity, json, readBody } from "@/lib/shared/server";
import { requireManager } from "@/lib/roster/organisations-server";
import { updateProviderParticipant } from "@/lib/roster/participants-server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const manager = await requireManager(
      await identity(request),
      new URL(request.url).searchParams.get("providerId"),
    );
    const { id } = await context.params;
    const body = await readBody(request);
    return json({
      participant: await updateProviderParticipant(manager, id, body.profile),
    });
  } catch (error) {
    return failure(error);
  }
}
