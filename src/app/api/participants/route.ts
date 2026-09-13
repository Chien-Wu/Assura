import { failure, identity, json, readBody } from "@/lib/shared/server";
import { requireManager } from "@/lib/roster/organisations-server";
import {
  createProviderParticipant,
  listProviderParticipants,
} from "@/lib/roster/participants-server";

export async function GET(request: Request) {
  try {
    const manager = await requireManager(
      await identity(request),
      new URL(request.url).searchParams.get("providerId"),
    );
    return json({
      participants: await listProviderParticipants(manager.providerId),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const manager = await requireManager(
      await identity(request),
      new URL(request.url).searchParams.get("providerId"),
    );
    const body = await readBody(request);
    return json(
      { participant: await createProviderParticipant(manager, body.profile) },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
