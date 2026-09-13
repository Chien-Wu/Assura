import type { Participant, PlanItem } from "./participant-profiles";

type ParticipantInput = Omit<Participant, "id">;
export type ProviderWorker = { userId: string; fullName: string };
export type RosterManager = { userId: string; providerId: string };

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Enter valid ${label}.`);
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  maxLength = 6000,
  required = false,
): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new Error(`Enter valid ${label}.`);
  const cleaned = value.trim();
  if (
    (required && !cleaned) ||
    cleaned.length > maxLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)
  )
    throw new Error(
      `Enter ${label} using ${required ? "1" : "0"} to ${maxLength} characters.`,
    );
  return cleaned;
}

function boolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`Choose a valid ${label}.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(`Enter up to 100 ${label}.`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  return array(value, label).map((item) => text(item, label, 2000, true));
}

function planItem(value: unknown): PlanItem {
  const input = record(value, "plan details");
  const item: PlanItem = {
    id: text(input.id, "plan item ID", 80, true),
    category: text(input.category, "plan category", 80, true),
    description: text(input.description, "plan description", 6000, true),
    behaviour: text(input.behaviour, "plan behaviour"),
    authorised: boolean(input.authorised, "plan authorisation"),
  };
  for (const key of ["maxMinutes", "maxDoseMg", "maxUses24h"] as const) {
    const amount = input[key];
    if (amount === undefined) continue;
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      (key === "maxUses24h" && !Number.isSafeInteger(amount))
    )
      throw new Error(
        `Enter a positive ${key === "maxUses24h" ? "whole number" : "number"} for ${key}.`,
      );
    item[key] = amount;
  }
  return item;
}

// Blank fields mean the provider has not supplied information; they must never
// become inferred conditions, medication instructions, or authorised practices.
export function cleanParticipantInput(value: unknown): ParticipantInput {
  const input = record(value, "participant details");
  const dateOfBirth = input.dateOfBirth ?? null;
  if (dateOfBirth !== null && dateOfBirth !== "") {
    if (
      typeof dateOfBirth !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ||
      !Number.isFinite(Date.parse(`${dateOfBirth}T00:00:00Z`)) ||
      new Date(`${dateOfBirth}T00:00:00Z`).toISOString().slice(0, 10) !==
        dateOfBirth ||
      dateOfBirth > new Date().toISOString().slice(0, 10)
    )
      throw new Error("Enter a valid date of birth that is not in the future.");
  }
  const plan = array(input.plan, "plan items").map(planItem);
  if (new Set(plan.map((item) => item.id)).size !== plan.length)
    throw new Error("Use a unique ID for each plan item.");
  const profile: ParticipantInput = {
    name: text(input.name, "participant name", 120, true),
    ndis: text(input.ndis, "NDIS number", 80),
    setting: text(input.setting, "support setting"),
    conditions: strings(input.conditions, "conditions"),
    risks: strings(input.risks, "risks"),
    communication: text(input.communication, "communication needs"),
    mealtimePlan: text(input.mealtimePlan, "mealtime plan"),
    behaviourPlan: boolean(input.behaviourPlan, "behaviour plan status"),
    medications: array(input.medications, "medications").map((value) => {
      const medication = record(value, "medication details");
      return {
        name: text(medication.name, "medication name", 200, true),
        description: text(medication.description, "medication description"),
        routine: boolean(medication.routine, "routine medication status"),
      };
    }),
    goals: strings(input.goals, "goals"),
    plan,
    dateOfBirth: dateOfBirth === "" ? null : dateOfBirth,
  };
  if (input.seizureProtocol !== undefined)
    profile.seizureProtocol = text(input.seizureProtocol, "seizure protocol");
  if (JSON.stringify(profile).length > 65000)
    throw new Error(
      "Participant details are too large. Shorten the recorded information.",
    );
  return profile;
}

export const providerParticipantsQuery = `SELECT participant.id,participant.profile_json
  FROM provider_participants AS participant
  JOIN providers AS provider ON provider.id=participant.provider_id AND provider.active=1
  WHERE participant.provider_id=? AND participant.active=1
  ORDER BY json_extract(participant.profile_json,'$.name') COLLATE NOCASE,participant.id`;

export const providerParticipantQuery = `SELECT participant.id,participant.profile_json
  FROM provider_participants AS participant
  JOIN providers AS provider ON provider.id=participant.provider_id AND provider.active=1
  WHERE participant.provider_id=? AND participant.id=? AND participant.active=1`;

export const providerWorkersQuery = `SELECT profile.user_id AS userId,profile.full_name AS fullName
  FROM app_profiles AS profile
  JOIN provider_memberships AS membership ON membership.user_id=profile.user_id
    AND membership.provider_id=profile.provider_id AND membership.active=1
  JOIN providers AS provider ON provider.id=profile.provider_id AND provider.active=1
  WHERE profile.provider_id=? ORDER BY profile.full_name COLLATE NOCASE,profile.user_id`;

// The permission check belongs in the mutation itself: a grant revoked after
// requireManager must not leave a window in which a write can still succeed.
const activeManagerAccess = `EXISTS (SELECT 1 FROM provider_manager_grants AS manager_grant
  JOIN providers AS provider ON provider.id=manager_grant.provider_id AND provider.active=1
  WHERE manager_grant.provider_id=? AND manager_grant.claimed_user_id=? AND manager_grant.active=1)`;

export const createProviderParticipantQuery = `INSERT INTO provider_participants
  (id,provider_id,profile_json,active,created_at,updated_at)
  SELECT ?,?,?,1,?,? WHERE ${activeManagerAccess}`;

export const updateProviderParticipantQuery = `UPDATE provider_participants
  SET profile_json=?,updated_at=? WHERE id=? AND provider_id=? AND active=1
  AND ${activeManagerAccess}`;

export type ParticipantUse = {
  participantId: string | null;
  legacyParticipantName: string | null;
  item: string;
  count: number;
};

export const providerParticipantUsesQuery = `SELECT participant_id AS participantId,
  CASE WHEN shift_id IS NULL THEN json_extract(fields_json,'$.participant') END AS legacyParticipantName,
  json_extract(safety_json,'$.restrictivePractice.schedule_item') AS item,COUNT(*) AS count
  FROM shift_notes WHERE provider_id=? AND substr(json_extract(fields_json,'$.shiftStart'),1,7)=?
    AND json_extract(safety_json,'$.restrictivePractice.used')='yes'
  GROUP BY participant_id,legacyParticipantName,item`;

export function monthlyParticipantUses(
  participants: Participant[],
  uses: ParticipantUse[],
  month: string,
) {
  const nameCounts = new Map<string, number>();
  for (const participant of participants)
    nameCounts.set(
      participant.name,
      (nameCounts.get(participant.name) ?? 0) + 1,
    );
  return participants.flatMap((participant) =>
    participant.plan.map((item) => ({
      participantId: participant.id,
      participant: participant.name,
      item: item.id,
      description: item.description,
      month,
      recordedUses: uses
        .filter(
          (use) =>
            use.item === item.id &&
            (use.participantId === participant.id ||
              (use.participantId === null &&
                use.legacyParticipantName === participant.name &&
                nameCounts.get(participant.name) === 1)),
        )
        .reduce((count, use) => count + use.count, 0),
    })),
  );
}
