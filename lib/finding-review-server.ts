import { database, getRow, RequestError } from "@/lib/notes-server";
import { managerNoteAccess } from "@/lib/organisation-access";
import {
  riskLevelLabels,
  type RiskLevel,
  type RiskType,
} from "@/lib/risk-assessment";

export type FindingReviewStatus = "open" | "reviewing" | "closed";
type FindingRow = {
  id: string;
  assessment_id: string;
  note_id: string;
  participant: string;
  worker_name: string;
  source_revision: number;
  note_revision: number;
  note_status: string;
  type: RiskType;
  ai_level: RiskLevel;
  evidence_json: string;
  summary: string;
  created_at: string;
  review_status: FindingReviewStatus;
  manager_level: RiskLevel | null;
  review_revision: number;
};
type ActionRow = {
  id: string;
  finding_id: string;
  actor_name: string;
  created_at: string;
  status: FindingReviewStatus;
  manager_level: RiskLevel | null;
  comment: string;
};
const findingSelect = `SELECT f.*,a.note_id,a.source_revision,
  json_extract(shift_notes.fields_json,'$.participant') AS participant,
  shift_notes.worker_name,shift_notes.revision AS note_revision,shift_notes.status AS note_status
  FROM assessment_findings f
  JOIN shift_assessments a ON a.id=f.assessment_id
  JOIN shift_notes ON shift_notes.id=a.note_id AND shift_notes.owner_id=a.owner_id`;
const managerScope = `shift_notes.provider_id=? AND ${managerNoteAccess}`;

async function findings(where: string, bindings: (string | number)[]) {
  const rows = await database()
    .prepare(
      `${findingSelect} WHERE ${where}
    ORDER BY COALESCE(f.manager_level,f.ai_level) DESC,f.created_at DESC,f.id`,
    )
    .bind(...bindings)
    .all<FindingRow>();
  const actions = await database()
    .prepare(
      `SELECT act.* FROM assessment_manager_actions act
    JOIN assessment_findings f ON f.id=act.finding_id
    JOIN shift_assessments a ON a.id=f.assessment_id
    JOIN shift_notes ON shift_notes.id=a.note_id AND shift_notes.owner_id=a.owner_id
    WHERE ${where} ORDER BY act.review_revision,act.id`,
    )
    .bind(...bindings)
    .all<ActionRow>();
  return rows.results.map((row) => ({
    id: row.id,
    assessmentId: row.assessment_id,
    noteId: row.note_id,
    participant: row.participant,
    workerName: row.worker_name,
    sourceRevision: row.source_revision,
    isCurrent: row.source_revision === row.note_revision,
    noteStatus: row.note_status,
    type: row.type,
    aiLevel: row.ai_level,
    evidence: JSON.parse(row.evidence_json) as {
      sourceId: string;
      quote: string;
    }[],
    summary: row.summary,
    createdAt: row.created_at,
    reviewStatus: row.review_status,
    managerLevel: row.manager_level,
    reviewRevision: row.review_revision,
    history: actions.results
      .filter((action) => action.finding_id === row.id)
      .map((action) => ({
        id: action.id,
        actorName: action.actor_name,
        createdAt: action.created_at,
        status: action.status,
        managerLevel: action.manager_level,
        comment: action.comment,
      })),
  }));
}

export async function readManagerFindings(providerId: string, actorId: string) {
  return findings(managerScope, [providerId, actorId]);
}
export async function readFindingsForNote(
  noteId: string,
  ownerId: string,
  actorId: string,
) {
  await getRow(noteId, ownerId);
  return findings(
    `shift_notes.id=? AND shift_notes.owner_id=? AND ${managerNoteAccess}`,
    [noteId, ownerId, actorId],
  );
}
async function readManagerFinding(
  id: string,
  providerId: string,
  actorId: string,
) {
  const result = await findings(`f.id=? AND ${managerScope}`, [
    id,
    providerId,
    actorId,
  ]);
  if (!result[0])
    throw new RequestError(
      "This finding is not available to your provider.",
      403,
    );
  return result[0];
}

export async function reviewFinding(
  id: string,
  providerId: string,
  actorId: string,
  actorName: string,
  body: Record<string, unknown>,
) {
  const requestId =
    typeof body.requestId === "string" ? body.requestId.trim() : "";
  const revision = body.revision;
  const status = body.status;
  const managerLevel = body.managerLevel;
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId))
    throw new RequestError("Use a valid review request ID.");
  if (!Number.isInteger(revision) || (revision as number) < 0)
    throw new RequestError("Use the current review revision.");
  if (status !== "open" && status !== "reviewing" && status !== "closed")
    throw new RequestError("Choose a review status.");
  if (
    managerLevel !== null &&
    (typeof managerLevel !== "string" ||
      !Object.hasOwn(riskLevelLabels, managerLevel))
  )
    throw new RequestError(
      "Choose a valid manager level, or keep the AI level.",
    );
  if (typeof body.comment !== "string" || comment.length > 4000)
    throw new RequestError("Keep the review comment within 4,000 characters.");
  const current = await readManagerFinding(id, providerId, actorId);
  const requestJson = JSON.stringify({
    revision,
    status,
    managerLevel,
    comment,
  });
  const replay = async () => {
    const existing = await database()
      .prepare(
        `SELECT actor_id,request_json FROM assessment_manager_actions WHERE finding_id=? AND request_id=?`,
      )
      .bind(id, requestId)
      .first<{ actor_id: string; request_json: string }>();
    if (!existing) return null;
    if (existing.actor_id !== actorId || existing.request_json !== requestJson)
      throw new RequestError(
        "This request ID was already used for a different review.",
        409,
      );
    return readManagerFinding(id, providerId, actorId);
  };
  const duplicate = await replay();
  if (duplicate) return duplicate;
  if (
    (status === "closed" || managerLevel !== current.managerLevel) &&
    !comment
  )
    throw new RequestError(
      "Add a reason when closing a finding or changing its manager level.",
    );
  if (current.reviewRevision !== revision)
    throw new RequestError(
      "This finding was reviewed elsewhere. Refresh before saving.",
      409,
    );
  const actionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const updatedRevision = (revision as number) + 1;
  const result = await database().batch([
    database()
      .prepare(
        `UPDATE assessment_findings SET review_status=?,manager_level=?,review_revision=review_revision+1,last_action_id=?
      WHERE id=? AND review_revision=?
      AND NOT EXISTS (SELECT 1 FROM assessment_manager_actions WHERE finding_id=? AND request_id=?)
      AND EXISTS (SELECT 1 FROM shift_assessments a JOIN shift_notes ON shift_notes.id=a.note_id AND shift_notes.owner_id=a.owner_id
        WHERE a.id=assessment_findings.assessment_id AND ${managerScope})`,
      )
      .bind(
        status,
        managerLevel as string | null,
        actionId,
        id,
        revision as number,
        id,
        requestId,
        providerId,
        actorId,
      ),
    database()
      .prepare(
        `INSERT INTO assessment_manager_actions
      (id,finding_id,request_id,request_json,actor_id,actor_name,created_at,status,manager_level,comment,review_revision)
      SELECT ?,id,?,?,?,?,?,?,?,?,? FROM assessment_findings WHERE id=? AND last_action_id=? AND review_revision=?`,
      )
      .bind(
        actionId,
        requestId,
        requestJson,
        actorId,
        actorName,
        now,
        status,
        managerLevel as string | null,
        comment,
        updatedRevision,
        id,
        actionId,
        updatedRevision,
      ),
  ]);
  if (!result[0].meta.changes) {
    const repeated = await replay();
    if (repeated) return repeated;
    await readManagerFinding(id, providerId, actorId);
    throw new RequestError(
      "This finding was reviewed elsewhere. Refresh before saving.",
      409,
    );
  }
  return readManagerFinding(id, providerId, actorId);
}
