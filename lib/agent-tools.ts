import type { Participant } from "./participants";
import { checkForm, type ShiftNote } from "./shift-form.ts";

type ToolRecord = Record<string, unknown>;

export const recorderFields = [
  "participant",
  "shiftStart",
  "shiftEnd",
  "activities",
  "supportProvided",
  "participantResponse",
  "goalProgress",
] as const;

export function recorderFormResult(result: ToolRecord & { note: ShiftNote }) {
  const issues = checkForm(result.note.fields).issues.filter((issue) =>
    (recorderFields as readonly string[]).includes(issue.field),
  );
  return {
    stage: "record",
    instruction:
      "Record this shift only. Preserve observations, quotes and uncertainty in the worker's account. Ask only for missing basic shift details. A silent risk check and final confirmation happen after the worker ends this conversation and selects Review & confirm.",
    note: {
      ...pick(result.note, [
        "revision",
        "status",
        "timezone",
        "expectedStart",
        "expectedEnd",
      ]),
      fields: pick(result.note.fields, recorderFields),
    },
    validation: { complete: issues.length === 0, issues },
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

export function parseRecorderUpdate(fieldsJson: unknown) {
  const update = parseAgentUpdate(fieldsJson);
  if (
    !update.fields ||
    typeof update.fields !== "object" ||
    Array.isArray(update.fields)
  )
    throw new Error("Provide supported changed fields as a JSON object.");
  const allowed = recorderFields.filter((field) => field !== "participant");
  if (
    Object.keys(update.fields).some(
      (key) => !(allowed as readonly string[]).includes(key),
    ) ||
    update.fieldStates !== undefined ||
    update.restrictivePractice !== undefined ||
    update.questionUpdates !== undefined
  )
    throw new Error(
      "This stage records basic shift details only. Preserve any concern in the narrative fields; AI2 checks the saved account silently during review and never asks questions.",
    );
  return { fields: update.fields };
}

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
            "followup",
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
