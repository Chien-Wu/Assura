import type { Participant } from "./participants";
import { database, RequestError } from "./notes-server";
import {
  cleanParticipantInput,
  createProviderParticipantQuery,
  providerParticipantQuery,
  providerParticipantsQuery,
  providerWorkersQuery,
  updateProviderParticipantQuery,
  type ProviderWorker,
  type RosterManager,
} from "./roster";

type ParticipantRow = { id: string; profile_json: string };

function participantFromRow(row: ParticipantRow): Participant {
  return { ...JSON.parse(row.profile_json), id: row.id };
}

// Callers must obtain the provider ID from requireManager or requireWorker.
export async function listProviderParticipants(
  providerId: string,
): Promise<Participant[]> {
  const result = await database()
    .prepare(providerParticipantsQuery)
    .bind(providerId)
    .all<ParticipantRow>();
  return result.results.map(participantFromRow);
}

export async function getProviderParticipant(
  providerId: string,
  id: string,
): Promise<Participant | null> {
  const row = await database()
    .prepare(providerParticipantQuery)
    .bind(providerId, id)
    .first<ParticipantRow>();
  return row ? participantFromRow(row) : null;
}

export async function listProviderWorkers(
  providerId: string,
): Promise<ProviderWorker[]> {
  const result = await database()
    .prepare(providerWorkersQuery)
    .bind(providerId)
    .all<ProviderWorker>();
  return result.results;
}

function participantProfile(id: string, input: unknown): Participant {
  try {
    return { ...cleanParticipantInput(input), id };
  } catch (error) {
    throw new RequestError(
      error instanceof Error ? error.message : "Check the participant details.",
    );
  }
}

export async function createProviderParticipant(
  manager: RosterManager,
  input: unknown,
): Promise<Participant> {
  const profile = participantProfile(crypto.randomUUID(), input);
  const now = new Date().toISOString();
  const saved = await database()
    .prepare(createProviderParticipantQuery)
    .bind(
      profile.id,
      manager.providerId,
      JSON.stringify(profile),
      now,
      now,
      manager.providerId,
      manager.userId,
    )
    .run();
  if (saved.meta.changes !== 1)
    throw new RequestError(
      "Your management access has changed. Reload before saving participant details.",
      403,
    );
  return profile;
}

export async function updateProviderParticipant(
  manager: RosterManager,
  id: string,
  input: unknown,
): Promise<Participant> {
  const profile = participantProfile(id, input);
  if (!(await getProviderParticipant(manager.providerId, id)))
    throw new RequestError("Participant not found.", 404);
  const saved = await database()
    .prepare(updateProviderParticipantQuery)
    .bind(
      JSON.stringify(profile),
      new Date().toISOString(),
      id,
      manager.providerId,
      manager.providerId,
      manager.userId,
    )
    .run();
  if (saved.meta.changes !== 1)
    throw new RequestError(
      "Your management access has changed. Reload before saving participant details.",
      403,
    );
  return profile;
}
