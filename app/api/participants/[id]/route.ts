import { failure, identity, json, readBody } from "@/lib/notes-server";
import { requireManager } from "@/lib/organisations";
import { updateProviderParticipant } from "@/lib/roster-server";

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
