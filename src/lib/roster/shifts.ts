export type ScheduledShift = {
  id: string;
  providerId: string;
  participantId: string;
  participantName: string;
  workerId: string;
  workerName: string;
  expectedStart: string;
  expectedEnd: string;
  timezone: string;
  createdAt: string;
  noteId: string | null;
  noteStatus: "draft" | "complete" | null;
};

export function validLocalTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  )
    return false;
  const date = new Date(value + ":00Z");
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 16) === value
  );
}

export function cleanShiftInput(value: Record<string, unknown>) {
  const { participantId, workerId, expectedStart, expectedEnd } = value;
  if (
    typeof participantId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(participantId)
  )
    throw new Error("Choose a participant.");
  if (typeof workerId !== "string" || !workerId.trim() || workerId.length > 200)
    throw new Error("Choose a support worker.");
  if (!validLocalTime(expectedStart) || !validLocalTime(expectedEnd))
    throw new Error("Enter valid expected start and end times.");
  if (expectedEnd <= expectedStart)
    throw new Error(
      "The expected end must be after the start. Use the next date for an overnight shift.",
    );
  if (value.timezone !== undefined && value.timezone !== "Australia/Melbourne")
    throw new Error("Shift times use Australia/Melbourne.");
  return {
    participantId,
    workerId,
    expectedStart,
    expectedEnd,
    timezone: "Australia/Melbourne",
  };
}

export const createScheduledShiftQuery = `INSERT INTO scheduled_shifts
  (id,provider_id,participant_id,worker_id,worker_name,expected_start,expected_end,timezone,created_by,created_at)
  SELECT ?,?,participant.id,profile.user_id,profile.full_name,?,?,?, ?,?
  FROM provider_participants AS participant
  JOIN app_profiles AS profile ON profile.provider_id=participant.provider_id
  JOIN provider_memberships AS membership ON membership.provider_id=profile.provider_id
    AND membership.user_id=profile.user_id AND membership.active=1
  JOIN providers AS provider ON provider.id=participant.provider_id AND provider.active=1
  WHERE participant.id=? AND participant.provider_id=? AND participant.active=1 AND profile.user_id=?
    AND EXISTS (SELECT 1 FROM provider_manager_grants AS grant_row
      WHERE grant_row.provider_id=participant.provider_id AND grant_row.claimed_user_id=? AND grant_row.active=1)`;

export const shiftSelect = `SELECT shift.id,shift.provider_id AS providerId,
  shift.participant_id AS participantId,json_extract(participant.profile_json,'$.name') AS participantName,
  shift.worker_id AS workerId,shift.worker_name AS workerName,
  shift.expected_start AS expectedStart,shift.expected_end AS expectedEnd,shift.timezone,
  shift.created_at AS createdAt,note.id AS noteId,note.status AS noteStatus
  FROM scheduled_shifts AS shift
  JOIN provider_participants AS participant ON participant.id=shift.participant_id AND participant.provider_id=shift.provider_id
  LEFT JOIN shift_notes AS note ON note.shift_id=shift.id AND note.owner_id=shift.worker_id`;

export const createScheduledNoteQuery = `INSERT OR IGNORE INTO shift_notes
  (id,owner_id,worker_name,fields_json,revision,status,form_version,timezone,created_at,updated_at,
   retention_until,provider_id,shift_id,participant_id,participant_snapshot_json,expected_start,expected_end)
  SELECT ?,profile.user_id,profile.full_name,json_set(?,'$.participant',json_extract(participant.profile_json,'$.name')),
    0,'draft',?,shift.timezone,?,?,?,shift.provider_id,shift.id,participant.id,participant.profile_json,shift.expected_start,shift.expected_end
  FROM scheduled_shifts AS shift
  JOIN provider_participants AS participant ON participant.id=shift.participant_id AND participant.provider_id=shift.provider_id AND participant.active=1
  JOIN providers AS provider ON provider.id=shift.provider_id AND provider.active=1
  JOIN app_profiles AS profile ON profile.user_id=shift.worker_id AND profile.provider_id=shift.provider_id
  JOIN provider_memberships AS membership ON membership.provider_id=profile.provider_id AND membership.user_id=profile.user_id AND membership.active=1
  WHERE shift.id=? AND shift.worker_id=? AND shift.provider_id=?`;

export function displayShiftTime(value: string) {
  if (!validLocalTime(value)) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value + ":00Z"));
}
