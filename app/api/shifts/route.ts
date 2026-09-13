import { failure, identity, json, readBody } from "@/lib/shared/server";
import {
  requireManager,
  requireWorker,
} from "@/lib/roster/organisations-server";
import {
  createScheduledShift,
  listProviderShifts,
  listWorkerShifts,
} from "@/lib/roster/shifts-server";

export async function GET(request: Request) {
  try {
    const user = await identity(request);
    const providerId = new URL(request.url).searchParams.get("providerId");
    if (providerId !== null) {
      const manager = await requireManager(user, providerId);
      return json({ shifts: await listProviderShifts(manager.providerId) });
    }
    return json({ shifts: await listWorkerShifts(await requireWorker(user)) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const manager = await requireManager(
      user,
      new URL(request.url).searchParams.get("providerId"),
    );
    return json(
      { shift: await createScheduledShift(manager, await readBody(request)) },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
