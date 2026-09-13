import { checkForm, recorderFields, type ShiftNote } from "../notes/form.ts";
import { participantForNote } from "../roster/participant-profiles.ts";

type ToolRecord = Record<string, unknown>;

export function recorderDynamicVariables(note: ShiftNote) {
  const profile = participantForNote(note);
  if (!profile)
    throw new Error("Choose a participant profile before starting.");
  return {
    participant_name: note.fields.participant,
    participant_context: JSON.stringify({
      name: note.fields.participant,
      communication: profile.communication,
      goals: profile.goals,
      setting: profile.setting,
    }),
  };
}

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

function parseAgentUpdate(fieldsJson: unknown) {
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

export function recorderToolFailure(error: unknown, status = "unavailable") {
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
