import type { Participant } from "./participants";
import type { ShiftNote } from "./shift-form";

type ToolRecord = Record<string, unknown>;

function pick(value: unknown, keys: readonly string[]): ToolRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as ToolRecord;
  return Object.fromEntries(
    keys
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]]),
  );
}

// Keep the app's full record in UI state; only this explicit projection goes to
// the conversation provider. New database columns must not widen that payload.
export function agentProfile(profile: Participant | unknown) {
  const projected = pick(profile, [
    "name",
    "setting",
    "conditions",
    "risks",
    "communication",
    "mealtimePlan",
    "behaviourPlan",
    "medications",
    "goals",
    "plan",
    "seizureProtocol",
  ]);
  if (!Object.keys(projected).length) return projected;
  return {
    ...projected,
    provenance: "saved_note_profile_snapshot_unverified_effective_date",
    guidance: [
      "This is background captured with the note, without verified effective dates. It does not establish which care details applied during an earlier shift.",
      "Default false, empty or missing profile values do not establish absence. In particular, behaviourPlan=false is not verified evidence that no behaviour plan exists. Establish applicability from worker statements or dated source documents.",
    ],
  };
}

export function agentNote(note: ShiftNote) {
  return pick(note, [
    "fields",
    "revision",
    "status",
    "formVersion",
    "timezone",
    "safety",
    "riskFlags",
    "clarificationCount",
    "expectedStart",
    "expectedEnd",
  ]);
}

export function agentFormResult(result: ToolRecord & { note: ShiftNote }) {
  return {
    ...pick(result, [
      "remainingClarifications",
      "riskFlags",
      "reportingGuidance",
      "escalation",
      "warnings",
      "evidenceWarnings",
      "requiredFacts",
      "questionUpdates",
      "interviewQuestions",
      "questions",
      "coverage",
      "confirmationId",
      "summary",
    ]),
    note: agentNote(result.note),
    profile: agentProfile(result.profile),
    scheduledShift:
      result.scheduledShift == null
        ? null
        : pick(result.scheduledShift, [
            "expectedStart",
            "expectedEnd",
            "timezone",
            "instruction",
          ]),
  };
}

export function agentKnowledgeResult(result: ToolRecord) {
  return {
    ...pick(result, [
      "ok",
      "status",
      "error",
      "action",
      "retrievalId",
      "noteRevision",
      "transcriptCursor",
      "coverage",
      "guidance",
      "cutoff",
      "timeStatus",
      "profileCapturedAt",
      "availability",
      "interviewQuestions",
      "questions",
      "remainingClarifications",
      "question",
      "questionId",
      "canAsk",
      "duplicate",
    ]),
    ...(result.profile
      ? {
          profile: {
            ...agentProfile(result.profile),
            ...pick(result.profile, ["provenance"]),
          },
        }
      : {}),
    sources: Array.isArray(result.sources)
      ? result.sources.map((source) =>
          pick(source, [
            "sourceId",
            "noteId",
            "revision",
            "shiftStart",
            "shiftEnd",
            "confirmedAt",
            "workerName",
            "fields",
            "isSynthetic",
          ]),
        )
      : [],
  };
}

export function parseAgentUpdate(fieldsJson: unknown) {
  if (typeof fieldsJson !== "string")
    throw new Error("fields_json must be a JSON object encoded as a string.");
  let payload: ToolRecord;
  try {
    payload = JSON.parse(fieldsJson);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error();
  } catch {
    throw new Error("fields_json is not a JSON object. Correct it and retry.");
  }
  const {
    field_states,
    restrictive_practice,
    question_updates,
    fields,
    ...plainFields
  } = payload;
  return {
    fields: fields ?? plainFields,
    fieldStates: field_states,
    restrictivePractice: restrictive_practice,
    questionUpdates: question_updates,
  };
}

export function knowledgeFailure(error: unknown, status = "unavailable") {
  return {
    ok: false,
    status,
    error:
      error instanceof Error
        ? error.message
        : "Participant history is unavailable.",
    sources: [],
    action:
      "Continue recording this shift from the worker's account. Do not infer history, ask an unregistered history-based question, or claim that no historical concern exists. Refresh context before retrying a stale request.",
  };
}

export type ToolSnapshot = {
  revision: number;
  workerSequence: number;
  interruptionGeneration: number;
};

export function toolSnapshotMatches(
  snapshot: ToolSnapshot,
  current: ToolSnapshot,
) {
  return (
    snapshot.revision === current.revision &&
    snapshot.workerSequence === current.workerSequence &&
    snapshot.interruptionGeneration === current.interruptionGeneration
  );
}
