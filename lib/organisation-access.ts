// Keep authorization predicates shared by read paths and the database tests.
// A worker affiliation never supplies manager access.
export const managerNoteAccess = `EXISTS (
  SELECT 1 FROM provider_manager_grants AS manager_grant
  JOIN providers AS managed_provider ON managed_provider.id=manager_grant.provider_id
  WHERE manager_grant.provider_id=shift_notes.provider_id
    AND manager_grant.claimed_user_id=? AND manager_grant.active=1
    AND managed_provider.active=1
)`;

export const readableNoteAccess = `(shift_notes.owner_id=? OR ${managerNoteAccess})`;

export const activeWorkerQuery = `SELECT profile.user_id,profile.full_name,profile.provider_id
  FROM app_profiles AS profile
  JOIN providers AS provider ON provider.id=profile.provider_id AND provider.active=1
  JOIN provider_memberships AS membership ON membership.provider_id=profile.provider_id
    AND membership.user_id=profile.user_id AND membership.active=1
  WHERE profile.user_id=?`;

export const managedProvidersQuery = `SELECT DISTINCT provider.id,provider.name
  FROM providers AS provider
  JOIN provider_manager_grants AS manager_grant ON manager_grant.provider_id=provider.id
  WHERE provider.active=1 AND manager_grant.active=1 AND manager_grant.claimed_user_id=?
  ORDER BY provider.name,provider.id`;

export const claimManagerGrantsQuery = `UPDATE provider_manager_grants
  SET claimed_user_id=?,claimed_at=COALESCE(claimed_at,?)
  WHERE email=? AND active=1 AND (claimed_user_id IS NULL OR claimed_user_id=?)
    AND EXISTS (SELECT 1 FROM providers WHERE id=provider_manager_grants.provider_id AND active=1)`;

export const createWorkerNoteQuery = `INSERT OR IGNORE INTO shift_notes
  (id,owner_id,worker_name,fields_json,revision,status,form_version,timezone,created_at,updated_at,retention_until,provider_id)
  SELECT ?,?,?,?,0,'draft',?,?,?,?,?,?
  WHERE EXISTS (SELECT 1 FROM app_profiles AS profile
    JOIN provider_memberships AS membership ON membership.user_id=profile.user_id
      AND membership.provider_id=profile.provider_id AND membership.active=1
    JOIN providers AS provider ON provider.id=profile.provider_id AND provider.active=1
    WHERE profile.user_id=? AND profile.provider_id=?)`;

export const providerRisksQuery = `SELECT risk_events.* FROM risk_events
  JOIN shift_notes ON shift_notes.id=risk_events.note_id
  WHERE shift_notes.provider_id=? ORDER BY risk_events.captured_at DESC`;
export const providerActionsQuery = `SELECT risk_actions.* FROM risk_actions
  JOIN risk_events ON risk_events.id=risk_actions.risk_id
  JOIN shift_notes ON shift_notes.id=risk_events.note_id
  WHERE shift_notes.provider_id=? ORDER BY risk_actions.created_at ASC`;
export const providerUsesQuery = `SELECT json_extract(fields_json,'$.participant') AS participant,
  json_extract(safety_json,'$.restrictivePractice.schedule_item') AS item,COUNT(*) AS count
  FROM shift_notes WHERE provider_id=? AND substr(json_extract(fields_json,'$.shiftStart'),1,7)=?
    AND json_extract(safety_json,'$.restrictivePractice.used')='yes'
  GROUP BY participant,item`;

export const appendManagerActionQuery = `INSERT INTO risk_actions
  (id,risk_id,owner_id,action,details_json,actor,created_at)
  SELECT ?,risk_events.id,risk_events.owner_id,'supervisor_review',?,?,?
  FROM risk_events JOIN shift_notes ON shift_notes.id=risk_events.note_id
  WHERE risk_events.id=? AND shift_notes.provider_id=? AND ${managerNoteAccess}`;

export function cleanWorkerProfile(fullName: unknown, providerId: unknown) {
  if (typeof fullName !== "string" || typeof providerId !== "string")
    throw new Error("Enter your name and choose your service provider.");
  const name = fullName.trim().replace(/\s+/g, " ");
  const provider = providerId.trim();
  if (
    name.length < 2 ||
    name.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(name)
  )
    throw new Error("Enter your full name using 2 to 120 characters.");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(provider))
    throw new Error("Choose an available service provider.");
  return { fullName: name, providerId: provider };
}
