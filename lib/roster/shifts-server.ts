import { database, RequestError } from "@/lib/shared/server";
import {
  cleanShiftInput,
  createScheduledShiftQuery,
  shiftSelect,
  type ScheduledShift,
} from "./shifts";

export async function listProviderShifts(providerId: string) {
  return (
    await database()
      .prepare(
        shiftSelect +
          " WHERE shift.provider_id=? ORDER BY shift.expected_start DESC,shift.id",
      )
      .bind(providerId)
      .all<ScheduledShift>()
  ).results;
}

export async function listWorkerShifts(worker: {
  userId: string;
  providerId: string;
}) {
  return (
    await database()
      .prepare(
        shiftSelect +
          ` WHERE shift.worker_id=? AND shift.provider_id=? AND participant.active=1
    ORDER BY CASE WHEN note.status='complete' THEN 1 ELSE 0 END,shift.expected_start DESC,shift.id`,
      )
      .bind(worker.userId, worker.providerId)
      .all<ScheduledShift>()
  ).results;
}

export async function createScheduledShift(
  manager: { userId: string; providerId: string },
  body: Record<string, unknown>,
) {
  let input;
  try {
    input = cleanShiftInput(body);
  } catch (error) {
    throw new RequestError(
      error instanceof Error ? error.message : "Check the shift details.",
    );
  }
  const id = crypto.randomUUID();
  const result = await database()
    .prepare(createScheduledShiftQuery)
    .bind(
      id,
      manager.providerId,
      input.expectedStart,
      input.expectedEnd,
      input.timezone,
      manager.userId,
      new Date().toISOString(),
      input.participantId,
      manager.providerId,
      input.workerId,
      manager.userId,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new RequestError(
      "Choose an active participant and worker from this provider. Your management access must still be active.",
      400,
    );
  return (await database()
    .prepare(shiftSelect + " WHERE shift.id=? AND shift.provider_id=?")
    .bind(id, manager.providerId)
    .first<ScheduledShift>())!;
}
