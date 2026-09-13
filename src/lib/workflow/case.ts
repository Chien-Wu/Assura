import { z } from "zod";

// Factual intake fields adapted from docs/extra-notes-forms.txt. These drafts
// do not decide reportability, authorisation, clinical care or case closure.
export const workflowRiskTypes = [
  "incident_safeguarding",
  "health_wellbeing",
  "medication",
  "behaviour_abc",
  "restrictive_practice",
  "service_exception",
] as const;
export type WorkflowRiskType = (typeof workflowRiskTypes)[number];
export type WorkflowFieldState =
  | "known"
  | "unknown"
  | "not_discussed"
  | "not_applicable";
export type WorkflowField = {
  value: string | null;
  state: WorkflowFieldState;
  source_ids: string[];
};
export type WorkflowSource = {
  id: string;
  kind: "worker_utterance" | "worker_form_edit" | "background";
  text: string;
  /** A structured form edit supports only this field, e.g. medication.scheduled_time. */
  field_path?: string;
};
type WorkflowRiskForm = {
  risk_type: WorkflowRiskType;
  fields: Record<string, WorkflowField>;
  followup_status: "pending" | "handled" | "deferred";
  handled_revision: number | null;
};
type WorkflowEvent = {
  id: string;
  shared_fields: Record<string, WorkflowField>;
  risk_forms: Partial<Record<WorkflowRiskType, WorkflowRiskForm>>;
};
export type WorkflowCase = {
  schema_version: 1;
  id: string;
  note_id: string;
  revision: number;
  events: WorkflowEvent[];
  sources: WorkflowSource[];
};
export type WorkflowCasePatch = {
  risk_type: WorkflowRiskType;
  event_id?: string;
  expected_revision: number;
  fields_json: string;
  followup_status?: "handled" | "deferred";
};

export const workflowSharedFieldDefinitions: Record<string, string> = {
  occurred_at: "When the event happened",
  location: "Where the event happened",
  people_involved: "People affected, involved and witnesses",
  what_happened: "What happened, in the worker's account",
  immediate_actions: "Immediate actions taken",
  current_safety: "Participant's current safety, as reported",
  participant_words: "Participant's own words and communication",
  communication_support: "Communication support or advocacy needed",
  notifications: "Who was contacted, when and how",
  outcome: "Current outcome, as reported",
  follow_up: "Stated follow-up, responsible person and timing",
};

export const workflowFormDefinitions: Record<
  WorkflowRiskType,
  { label: string; fields: Record<string, string> }
> = {
  incident_safeguarding: {
    label: "Incident and safeguarding",
    fields: {
      event_type: "Actual incident, allegation, near miss or hazard",
      event_category: "Reported event category",
      before_event: "What happened before the event",
      during_event: "Observable sequence during the event",
      after_event: "What happened after the event",
      actual_or_potential_impact: "Actual harm, impact or potential harm",
      injury_details: "Injured person, body area, symptoms and condition",
      evidence_preserved: "Evidence or documents preserved",
      death_reported: "Whether a death was reported",
      serious_injury_concern: "Reported facts about possible serious injury",
      abuse_neglect_concern: "Reported abuse or neglect concern",
      contact_assault_concern: "Reported unlawful contact or assault concern",
      sexual_misconduct_concern:
        "Reported sexual misconduct or grooming concern",
      restriction_concern: "Reported concern about restrictive practice",
    },
  },
  health_wellbeing: {
    label: "Health and wellbeing",
    fields: {
      change_area: "Area of health, wellbeing or function that changed",
      usual_baseline: "Usual baseline, as reported",
      observed_change: "What was different this shift",
      first_observed: "When the change was first observed",
      change_pattern: "Sudden, gradual, intermittent or recurring pattern",
      objective_observations: "Observable signs and symptoms",
      authorised_measurements: "Measurements taken under the support plan",
      plan_threshold: "Worker's knowledge of the plan escalation threshold",
      clinical_advice: "Clinician contacted, time and advice received",
      condition_now: "Resolved, improving, unchanged, worsening or unknown",
    },
  },
  medication: {
    label: "Medication variance",
    fields: {
      medication_name: "Medication name reported by the worker",
      scheduled_strength: "Scheduled medication strength, as reported",
      scheduled_dose: "Scheduled dose, as reported",
      scheduled_route: "Scheduled route, as reported",
      scheduled_time: "Scheduled administration time, as reported",
      variance_type: "Type of medication variance",
      expected_action: "What should have happened, as reported",
      actual_action: "What actually happened",
      discovered_at: "When the variance was discovered",
      discovered_by: "Who discovered the variance",
      administration_status: "Administered or not administered, as reported",
      actual_amount: "Amount actually administered",
      actual_route: "Route actually used",
      actual_time: "Actual administration time",
      symptoms: "Current symptoms or signs of harm",
      clinical_advice_contact: "Clinical adviser contacted",
      clinical_advice_time: "When clinical advice was received",
      clinical_advice_instructions: "Instructions received from the adviser",
      actions_following_advice: "Actions taken following that advice",
      mar_update: "Whether and how the medication record was updated",
      affected_medication_storage: "Medication isolated, secured or labelled",
      refusal_reason: "Participant's stated reason for refusal",
      refusal_choices: "Information and choices offered under the plan",
      prn_indication: "Reported authorised indication for PRN use",
      prn_alternatives: "Non-medication strategies attempted first",
      prn_plan_limits: "Worker's knowledge of PRN dose and plan limits",
      effect_checked_at: "When the effect was checked",
      observed_effect: "Observed effect or side effect",
    },
  },
  behaviour_abc: {
    label: "Behaviour ABC",
    fields: {
      active_plan: "Worker's knowledge of the active Behaviour Support Plan",
      antecedent: "A — what happened before the behaviour",
      observed_behaviour: "B — observable actions and words",
      started_at: "Behaviour start time",
      ended_at: "Behaviour end time",
      duration: "Reported duration",
      frequency: "Reported frequency",
      intensity_and_basis: "Reported intensity and observable basis",
      injury_threat_damage: "Injury, threat or property damage",
      strategies_used: "Plan strategies used",
      response_to_strategies: "Participant response to each strategy",
      consequence: "C — what happened after the behaviour",
      recovery_state: "Participant's eventual state",
      restrictive_practice_used: "Reported use of a restrictive practice",
      practitioner_review: "Stated need for practitioner review",
    },
  },
  restrictive_practice: {
    label: "Restrictive practice",
    fields: {
      practice_type:
        "Chemical, environmental, mechanical, physical or seclusion",
      started_at: "Practice start time",
      ended_at: "Practice end time",
      reason_given: "Reported reason for use",
      alternatives_attempted: "Less restrictive strategies attempted first",
      active_plan: "Worker's knowledge of inclusion in the active plan",
      authorisation_knowledge: "Worker's knowledge of current authorisation",
      implementation: "Reported method, conditions and plan compliance",
      implemented_by: "Who implemented the practice",
      witnesses: "Who was present",
      participant_monitoring: "How the participant was monitored",
      injury_or_distress: "Observed injury or distress",
      participant_debrief: "Participant debrief reported",
      worker_debrief: "Worker debrief reported",
    },
  },
  service_exception: {
    label: "Service delivery exception",
    fields: {
      scheduled_service: "Scheduled date and support type, as reported",
      scheduled_start: "Scheduled start, as reported",
      scheduled_finish: "Scheduled finish, as reported",
      exception_type: "Type of service exception",
      change_known_at: "When the service change became known",
      change_initiator: "Who requested or caused the change, as reported",
      actual_start: "Actual service start",
      actual_finish: "Actual service finish",
      support_delivered: "Support actually delivered",
      objective_reason: "Objective reason for the exception",
      critical_support_missed: "Critical support that was not provided",
      health_safety_impact: "Reported health or safety impact",
      participant_informed:
        "When and how the participant or nominee was informed",
      participant_agreement: "Participant agreement to alternatives",
      alternative_arrangement: "Alternative offered and available",
    },
  },
};

const workflowCaseLimits = {
  events: 20,
  sources: 256,
  source_text: 12_000,
  field_value: 6000,
  patch_characters: 64_000,
  case_bytes: 1_000_000,
} as const;

export class WorkflowCaseError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkflowCaseError";
    this.code = code;
    this.status =
      code === "stale_revision" || code === "missing_event" ? 409 : 422;
  }
}

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
const fieldSchema = z
  .object({
    value: z
      .string()
      .trim()
      .min(1)
      .max(workflowCaseLimits.field_value)
      .nullable(),
    state: z.enum(["known", "unknown", "not_discussed", "not_applicable"]),
    source_ids: z.array(identifier).max(12),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (
      (field.state === "known") !== (field.value !== null) ||
      (field.state === "not_discussed") !== (field.source_ids.length === 0) ||
      new Set(field.source_ids).size !== field.source_ids.length
    )
      ctx.addIssue({ code: "custom", message: "Inconsistent evidence state" });
  });
const sourceSchema = z
  .object({
    id: identifier,
    kind: z.enum(["worker_utterance", "worker_form_edit", "background"]),
    text: z
      .string()
      .min(1)
      .max(workflowCaseLimits.source_text)
      .refine((text) => Boolean(text.trim())),
    field_path: z.string().max(180).optional(),
  })
  .strict()
  .superRefine((source, ctx) => {
    if (!source.field_path) return;
    const [scope, key, extra] = source.field_path.split(".");
    const definitions =
      scope === "shared_fields"
        ? workflowSharedFieldDefinitions
        : workflowFormDefinitions[scope as WorkflowRiskType]?.fields;
    if (
      source.kind !== "worker_form_edit" ||
      extra ||
      !key ||
      !definitions ||
      !Object.hasOwn(definitions, key)
    )
      ctx.addIssue({ code: "custom", message: "Invalid source field binding" });
  });
const formSchema = z
  .object({
    risk_type: z.enum(workflowRiskTypes),
    fields: z.record(z.string(), fieldSchema),
    followup_status: z.enum(["pending", "handled", "deferred"]),
    handled_revision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();
const caseSchema = z
  .object({
    schema_version: z.literal(1),
    id: identifier,
    note_id: identifier,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    events: z
      .array(
        z
          .object({
            id: identifier,
            shared_fields: z.record(z.string(), fieldSchema),
            risk_forms: z.partialRecord(z.enum(workflowRiskTypes), formSchema),
          })
          .strict(),
      )
      .max(workflowCaseLimits.events),
    sources: z.array(sourceSchema).max(workflowCaseLimits.sources),
  })
  .strict();
const patchSchema = z
  .object({
    risk_type: z.enum(workflowRiskTypes),
    event_id: identifier.optional(),
    expected_revision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    fields_json: z.string().max(workflowCaseLimits.patch_characters),
    followup_status: z.enum(["handled", "deferred"]).optional(),
  })
  .strict();
const patchFieldsSchema = z
  .object({
    shared_fields: z.record(z.string(), fieldSchema).optional(),
    fields: z.record(z.string(), fieldSchema).optional(),
  })
  .strict();

function invalid(code = "invalid_case"): never {
  throw new WorkflowCaseError(
    code,
    "The workflow case or field evidence is invalid.",
  );
}
// Some object parsers discard __proto__ rather than reporting an unknown key.
// Reject it before schema parsing so a partly valid patch never hides bad keys.
function rejectReservedKeys(
  value: unknown,
  code: string,
  seen = new Set<object>(),
  depth = 0,
) {
  if (!value || typeof value !== "object") return;
  if (depth > 12 || seen.has(value)) invalid(code);
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      invalid(code);
    rejectReservedKeys(nested, code, seen, depth + 1);
  }
  seen.delete(value);
}
function emptyFields(definitions: Record<string, string>) {
  return Object.fromEntries(
    Object.keys(definitions).map((key) => [
      key,
      { value: null, state: "not_discussed" as const, source_ids: [] },
    ]),
  );
}
function checkFields(
  fields: Record<string, WorkflowField>,
  definitions: Record<string, string>,
  sources: Map<string, WorkflowSource>,
  complete: boolean,
  scope: string,
) {
  if (
    complete &&
    Object.keys(fields).length !== Object.keys(definitions).length
  )
    invalid();
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(definitions, key)) invalid("invalid_field");
    for (const id of field.source_ids) {
      const source = sources.get(id);
      if (!source || source.kind === "background")
        throw new WorkflowCaseError(
          "invalid_source",
          "Use saved worker evidence from this case; background is not current-shift evidence.",
        );
      if (source.field_path && source.field_path !== `${scope}.${key}`)
        throw new WorkflowCaseError(
          "invalid_source",
          `Source ${id} supports only ${source.field_path}, not ${scope}.${key}. Omit this field or use a worker source that actually supports it.`,
        );
    }
  }
}

/** Valid citations establish provenance, not semantic truth or clinical judgement. */
export function validateWorkflowCase(value: unknown): WorkflowCase {
  rejectReservedKeys(value, "invalid_case");
  const result = caseSchema.safeParse(value);
  if (!result.success) invalid();
  const current: WorkflowCase = result.data;
  if (
    new Set(current.events.map((event) => event.id)).size !==
      current.events.length ||
    new Set(current.sources.map((source) => source.id)).size !==
      current.sources.length
  )
    invalid();
  const sources = new Map(current.sources.map((source) => [source.id, source]));
  for (const event of current.events) {
    checkFields(
      event.shared_fields,
      workflowSharedFieldDefinitions,
      sources,
      true,
      "shared_fields",
    );
    if (!Object.keys(event.risk_forms).length) invalid();
    for (const [type, form] of Object.entries(event.risk_forms)) {
      if (!form || form.risk_type !== type) invalid();
      if (
        (form.followup_status === "pending") !==
          (form.handled_revision === null) ||
        (form.handled_revision !== null &&
          form.handled_revision > current.revision)
      )
        invalid();
      checkFields(
        form.fields,
        workflowFormDefinitions[form.risk_type].fields,
        sources,
        true,
        form.risk_type,
      );
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(current)).length >
    workflowCaseLimits.case_bytes
  )
    throw new WorkflowCaseError(
      "limit_exceeded",
      "This workflow case has reached its size limit.",
    );
  return current;
}

export function createWorkflowCase(input: {
  id: string;
  note_id: string;
}): WorkflowCase {
  return validateWorkflowCase({
    schema_version: 1,
    id: input.id,
    note_id: input.note_id,
    revision: 0,
    events: [],
    sources: [],
  });
}

/** The server supplies the evidence identity and kind; agents cannot create sources. */
export function addWorkflowSource(
  value: WorkflowCase,
  source: WorkflowSource,
): WorkflowCase {
  const current = validateWorkflowCase(value);
  rejectReservedKeys(source, "invalid_source");
  const parsed = sourceSchema.safeParse(source);
  if (!parsed.success) invalid("invalid_source");
  const existing = current.sources.find((item) => item.id === parsed.data.id);
  if (existing) {
    if (
      existing.kind !== parsed.data.kind ||
      existing.text !== parsed.data.text ||
      existing.field_path !== parsed.data.field_path
    )
      invalid("invalid_source");
    return current;
  }
  return validateWorkflowCase({
    ...current,
    revision: current.revision + 1,
    sources: [...current.sources, parsed.data],
  });
}

/** Update one form; shared facts belong to the event and are reused by every form. */
export function applyWorkflowCasePatch(
  value: WorkflowCase,
  input: WorkflowCasePatch,
  options: { event_id?: string } = {},
): WorkflowCase {
  const current = validateWorkflowCase(value);
  rejectReservedKeys(input, "invalid_patch");
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) invalid("invalid_patch");
  const patch = parsed.data;
  if (patch.expected_revision !== current.revision)
    throw new WorkflowCaseError(
      "stale_revision",
      "Refresh the current workflow case before saving.",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(patch.fields_json);
  } catch {
    invalid("invalid_patch");
  }
  rejectReservedKeys(raw, "invalid_field");
  const parsedFields = patchFieldsSchema.safeParse(raw);
  if (!parsedFields.success) invalid("invalid_patch");
  const updates = parsedFields.data;
  const shared = updates.shared_fields ?? {};
  const fields = updates.fields ?? {};
  const hasFields =
    Object.keys(shared).length > 0 || Object.keys(fields).length > 0;
  if (!hasFields && !patch.followup_status) invalid("invalid_patch");
  const sources = new Map(current.sources.map((source) => [source.id, source]));
  checkFields(
    shared,
    workflowSharedFieldDefinitions,
    sources,
    false,
    "shared_fields",
  );
  checkFields(
    fields,
    workflowFormDefinitions[patch.risk_type].fields,
    sources,
    false,
    patch.risk_type,
  );
  let event = patch.event_id
    ? current.events.find((item) => item.id === patch.event_id)
    : undefined;
  if (patch.event_id && !event)
    throw new WorkflowCaseError(
      "missing_event",
      "Choose an existing event or start a new event.",
    );
  if (!hasFields && !event?.risk_forms[patch.risk_type])
    invalid("invalid_patch");
  if (!event) {
    const eventId = identifier.safeParse(options.event_id);
    if (
      !eventId.success ||
      current.events.some((item) => item.id === eventId.data)
    )
      invalid("invalid_event");
    event = {
      id: eventId.data,
      shared_fields: emptyFields(workflowSharedFieldDefinitions),
      risk_forms: {},
    };
    current.events.push(event);
  }
  const form = event.risk_forms[patch.risk_type] ?? {
    risk_type: patch.risk_type,
    fields: emptyFields(workflowFormDefinitions[patch.risk_type].fields),
    followup_status: "pending" as const,
    handled_revision: null,
  };
  const apply = (
    target: Record<string, WorkflowField>,
    changes: Record<string, WorkflowField>,
  ) => {
    let changed = false;
    for (const [key, field] of Object.entries(changes)) {
      // A correction can explicitly be unknown, but cannot erase previously
      // reviewed evidence by silently relabelling it as never discussed.
      if (
        target[key].state !== "not_discussed" &&
        field.state === "not_discussed"
      )
        invalid("invalid_patch");
      if (
        target[key].state !== field.state ||
        target[key].value !== field.value ||
        target[key].source_ids.length !== field.source_ids.length ||
        target[key].source_ids.some((id) => !field.source_ids.includes(id))
      )
        changed = true;
      target[key] = field;
    }
    return changed;
  };
  const sharedChanged = apply(event.shared_fields, shared);
  const formChanged = apply(form.fields, fields);
  event.risk_forms[patch.risk_type] = form;
  current.revision += 1;
  for (const [type, affected] of Object.entries(event.risk_forms)) {
    if (
      affected &&
      (sharedChanged || (type === patch.risk_type && formChanged))
    ) {
      affected.followup_status = "pending";
      affected.handled_revision = null;
    }
  }
  if (patch.followup_status) {
    form.followup_status = patch.followup_status;
    form.handled_revision = current.revision;
  }
  return validateWorkflowCase(current);
}

/** A single context snapshot gives every specialist the same shared facts. */
export function workflowCaseContext(value: WorkflowCase) {
  const current = validateWorkflowCase(value);
  return {
    ...current,
    shared_field_definitions: { ...workflowSharedFieldDefinitions },
    form_definitions: Object.fromEntries(
      workflowRiskTypes.map((type) => [
        type,
        {
          label: workflowFormDefinitions[type].label,
          fields: { ...workflowFormDefinitions[type].fields },
        },
      ]),
    ),
    evidence_instruction:
      "Only worker_utterance and worker_form_edit sources in this case support current-shift fields. Background is context only. Unknown and not applicable require explicit worker evidence. Undiscussed fields stay null; do not infer no. These are factual drafts for review.",
  };
}
