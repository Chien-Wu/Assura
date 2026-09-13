import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workflowRiskTypes,
  workflowFormDefinitions,
  workflowSharedFieldDefinitions,
  WorkflowCaseError,
  createWorkflowCase,
  addWorkflowSource,
  applyWorkflowCasePatch,
  validateWorkflowCase,
  workflowCaseContext,
} from "../../src/lib/workflow/case.ts";

const known = (value, source = "worker:1") => ({
  value,
  state: "known",
  source_ids: [source],
});
const unknown = (source = "worker:1") => ({
  value: null,
  state: "unknown",
  source_ids: [source],
});
const undiscussed = () => ({
  value: null,
  state: "not_discussed",
  source_ids: [],
});
const base = () =>
  addWorkflowSource(createWorkflowCase({ id: "case_1", note_id: "note_1" }), {
    id: "worker:1",
    kind: "worker_utterance",
    text: "Sarah refused the scheduled medication. I don't know the dose.",
  });
const patch = (current, fields, options = {}) =>
  applyWorkflowCasePatch(
    current,
    {
      risk_type: "medication",
      expected_revision: current.revision,
      fields_json: JSON.stringify(fields),
      ...options,
    },
    { event_id: "event_1" },
  );
const medication = () =>
  patch(base(), {
    shared_fields: {
      what_happened: known("Sarah refused the scheduled medication."),
    },
    fields: {
      variance_type: known("Participant refused"),
      scheduled_dose: unknown(),
    },
  });
const code = (expected) => (error) =>
  error instanceof WorkflowCaseError && error.code === expected;

test("the six form definitions separate behaviour ABC and restrictive practice", () => {
  assert.equal(workflowRiskTypes.length, 6);
  assert.ok(workflowRiskTypes.includes("behaviour_abc"));
  assert.ok(workflowRiskTypes.includes("restrictive_practice"));
  assert.ok(!workflowRiskTypes.includes("complaint"));
  assert.ok(workflowFormDefinitions.medication.fields.scheduled_dose);
  assert.ok(workflowFormDefinitions.medication.fields.actual_amount);
  assert.ok(workflowSharedFieldDefinitions.current_safety);
});

test("new cases have no risk events and new form fields stay explicitly undiscussed", () => {
  const empty = createWorkflowCase({ id: "case_1", note_id: "note_1" });
  assert.equal(empty.schema_version, 1);
  assert.equal(empty.revision, 0);
  assert.deepEqual(empty.events, []);
  const result = medication();
  const form = result.events[0].risk_forms.medication;
  assert.deepEqual(form.fields.actual_amount, undiscussed());
  assert.deepEqual(form.fields.scheduled_dose, unknown());
  assert.equal(form.followup_status, "pending");
  assert.equal(form.handled_revision, null);
  assert.deepEqual(
    result.events[0].shared_fields.current_safety,
    undiscussed(),
  );
});

test("worker sources are append-only and exact source replay does not advance revision", () => {
  const initial = createWorkflowCase({ id: "case_1", note_id: "note_1" });
  const source = {
    id: "worker:raw",
    kind: "worker_utterance",
    text: "  I refused.  ",
  };
  const next = addWorkflowSource(initial, source);
  assert.equal(initial.sources.length, 0);
  assert.equal(next.sources[0].text, source.text);
  assert.equal(next.revision, 1);
  assert.equal(addWorkflowSource(next, source).revision, 1);
  for (const changed of [
    { ...source, text: "I refused." },
    { ...source, kind: "background" },
  ])
    assert.throws(
      () => addWorkflowSource(next, changed),
      code("invalid_source"),
    );
});

test("old revisions, unknown events and colliding generated IDs cannot overwrite the case", () => {
  const current = medication();
  const before = structuredClone(current);
  assert.throws(
    () =>
      patch(
        current,
        { fields: { symptoms: unknown() } },
        {
          event_id: "event_1",
          expected_revision: current.revision - 1,
        },
      ),
    code("stale_revision"),
  );
  assert.throws(
    () =>
      patch(
        current,
        { fields: { symptoms: unknown() } },
        {
          event_id: "not_in_case",
        },
      ),
    code("missing_event"),
  );
  assert.throws(
    () => patch(current, { fields: { symptoms: unknown() } }),
    code("invalid_event"),
  );
  assert.deepEqual(current, before);
});

test("only current-case worker sources may support facts, unknowns or inapplicability", () => {
  const current = addWorkflowSource(base(), {
    id: "plan:1",
    kind: "background",
    text: "The plan lists a scheduled dose of 5 mg.",
  });
  for (const source of ["other-case:worker", "plan:1"]) {
    assert.throws(
      () =>
        patch(current, { fields: { scheduled_dose: known("5 mg", source) } }),
      code("invalid_source"),
    );
    assert.throws(
      () => patch(current, { fields: { scheduled_dose: unknown(source) } }),
      code("invalid_source"),
    );
  }
  const edited = addWorkflowSource(current, {
    id: "edit:1",
    kind: "worker_form_edit",
    text: "I checked my account: the scheduled dose was 5 mg.",
  });
  assert.equal(
    patch(edited, { fields: { scheduled_dose: known("5 mg", "edit:1") } })
      .events[0].risk_forms.medication.fields.scheduled_dose.value,
    "5 mg",
  );
});

test("missing evidence, implicit negatives and inconsistent field states are rejected", () => {
  const invalidFields = [
    { value: "No symptoms", state: "known", source_ids: [] },
    { value: "No", state: "unknown", source_ids: ["worker:1"] },
    { value: null, state: "known", source_ids: ["worker:1"] },
    { value: null, state: "unknown", source_ids: [] },
    { value: null, state: "not_applicable", source_ids: [] },
    { value: null, state: "not_discussed", source_ids: ["worker:1"] },
    { value: "   ", state: "known", source_ids: ["worker:1"] },
    { value: "No", state: "known", source_ids: ["worker:1", "worker:1"] },
  ];
  for (const field of invalidFields)
    assert.throws(
      () => patch(base(), { fields: { symptoms: field } }),
      code("invalid_patch"),
    );
  const result = patch(base(), {
    fields: {
      prn_indication: {
        value: null,
        state: "not_applicable",
        source_ids: ["worker:1"],
      },
    },
  });
  assert.equal(
    result.events[0].risk_forms.medication.fields.prn_indication.state,
    "not_applicable",
  );
});

test("one event links multiple forms and shared facts are updated once", () => {
  const first = medication();
  const linked = patch(
    first,
    {
      fields: { actual_or_potential_impact: unknown() },
    },
    { risk_type: "incident_safeguarding", event_id: "event_1" },
  );
  assert.equal(linked.events.length, 1);
  assert.equal(Object.keys(linked.events[0].risk_forms).length, 2);
  assert.equal(
    linked.events[0].shared_fields.what_happened.value,
    "Sarah refused the scheduled medication.",
  );
  assert.deepEqual(
    linked.events[0].risk_forms.medication.fields,
    first.events[0].risk_forms.medication.fields,
  );
  const correctedSource = addWorkflowSource(linked, {
    id: "worker:2",
    kind: "worker_utterance",
    text: "Sarah is now comfortable and the manager has been contacted.",
  });
  const corrected = patch(
    correctedSource,
    {
      shared_fields: { current_safety: known("Comfortable now", "worker:2") },
    },
    { risk_type: "incident_safeguarding", event_id: "event_1" },
  );
  assert.equal(
    corrected.events[0].shared_fields.current_safety.value,
    "Comfortable now",
  );
  assert.ok(
    !Object.hasOwn(
      corrected.events[0].risk_forms.medication.fields,
      "current_safety",
    ),
  );
});

test("separate events of the same risk type do not overwrite each other", () => {
  const first = medication();
  const two = applyWorkflowCasePatch(
    first,
    {
      risk_type: "medication",
      expected_revision: first.revision,
      fields_json: JSON.stringify({
        fields: { variance_type: known("Late dose") },
      }),
    },
    { event_id: "event_2" },
  );
  assert.equal(two.events.length, 2);
  assert.equal(
    two.events[0].risk_forms.medication.fields.variance_type.value,
    "Participant refused",
  );
  assert.equal(
    two.events[1].risk_forms.medication.fields.variance_type.value,
    "Late dose",
  );
});

test("a form can be handled or deferred in the same atomic patch", () => {
  const current = medication();
  const handled = patch(
    current,
    {},
    { event_id: "event_1", followup_status: "handled" },
  );
  assert.equal(handled.revision, current.revision + 1);
  assert.equal(
    handled.events[0].risk_forms.medication.followup_status,
    "handled",
  );
  assert.equal(
    handled.events[0].risk_forms.medication.handled_revision,
    handled.revision,
  );
  const deferred = patch(
    handled,
    {},
    { event_id: "event_1", followup_status: "deferred" },
  );
  assert.equal(
    deferred.events[0].risk_forms.medication.followup_status,
    "deferred",
  );
  assert.equal(
    deferred.events[0].risk_forms.medication.handled_revision,
    deferred.revision,
  );
  assert.throws(
    () => patch(base(), {}, { followup_status: "handled" }),
    code("invalid_patch"),
  );
});

test("shared corrections reopen related forms, while unchanged shared facts do not", () => {
  const first = patch(
    medication(),
    {},
    { event_id: "event_1", followup_status: "handled" },
  );
  const linked = patch(
    first,
    {
      shared_fields: {
        what_happened: known("Sarah refused the scheduled medication."),
      },
      fields: { actual_or_potential_impact: unknown() },
    },
    {
      risk_type: "incident_safeguarding",
      event_id: "event_1",
      followup_status: "handled",
    },
  );
  assert.equal(
    linked.events[0].risk_forms.medication.followup_status,
    "handled",
  );
  const changed = patch(
    linked,
    {
      shared_fields: { current_safety: unknown() },
    },
    {
      risk_type: "incident_safeguarding",
      event_id: "event_1",
      followup_status: "handled",
    },
  );
  assert.equal(
    changed.events[0].risk_forms.medication.followup_status,
    "pending",
  );
  assert.equal(changed.events[0].risk_forms.medication.handled_revision, null);
  assert.equal(
    changed.events[0].risk_forms.incident_safeguarding.followup_status,
    "handled",
  );
  assert.equal(
    changed.events[0].risk_forms.incident_safeguarding.handled_revision,
    changed.revision,
  );
  assert.equal(
    linked.events[0].risk_forms.medication.followup_status,
    "handled",
  );
});

test("a form-specific correction reopens only that form", () => {
  const linked = patch(
    medication(),
    { fields: { actual_or_potential_impact: unknown() } },
    {
      risk_type: "incident_safeguarding",
      event_id: "event_1",
      followup_status: "handled",
    },
  );
  const handled = patch(
    linked,
    {},
    { event_id: "event_1", followup_status: "handled" },
  );
  const next = patch(
    handled,
    { fields: { symptoms: unknown() } },
    { event_id: "event_1" },
  );
  assert.equal(next.events[0].risk_forms.medication.followup_status, "pending");
  assert.equal(
    next.events[0].risk_forms.incident_safeguarding.followup_status,
    "handled",
  );
});

test("known facts may be corrected to explicitly unknown but not erased as undiscussed", () => {
  const current = medication();
  assert.throws(
    () =>
      patch(
        current,
        { fields: { variance_type: undiscussed() } },
        { event_id: "event_1" },
      ),
    code("invalid_patch"),
  );
  const corrected = patch(
    current,
    { fields: { variance_type: unknown() } },
    { event_id: "event_1" },
  );
  assert.equal(
    corrected.events[0].risk_forms.medication.fields.variance_type.state,
    "unknown",
  );
  assert.equal(
    current.events[0].risk_forms.medication.fields.variance_type.state,
    "known",
  );
});

test("unsupported form keys, nested scopes, malformed JSON and oversized content fail closed", () => {
  assert.throws(
    () => patch(base(), { fields: { observed_behaviour: known("Walking") } }),
    code("invalid_field"),
  );
  assert.throws(
    () => patch(base(), { shared_fields: { actual_amount: known("5 mg") } }),
    code("invalid_field"),
  );
  assert.throws(
    () =>
      patch(base(), {
        risk_type: "incident_safeguarding",
        fields: { symptoms: unknown() },
      }),
    code("invalid_patch"),
  );
  assert.throws(
    () => patch(base(), { fields: { symptoms: known("x".repeat(6001)) } }),
    code("invalid_patch"),
  );
  assert.throws(
    () => patch(base(), {}, { fields_json: "{" }),
    code("invalid_patch"),
  );
  assert.throws(
    () => patch(base(), {}, { fields_json: " ".repeat(64001) }),
    code("invalid_patch"),
  );
  assert.throws(
    () =>
      patch(
        base(),
        {},
        {
          fields_json: JSON.stringify({
            fields: JSON.parse(
              '{"symptoms":{"value":null,"state":"unknown","source_ids":["worker:1"]},"__proto__":{"value":null,"state":"unknown","source_ids":["worker:1"]}}',
            ),
          }),
        },
      ),
    code("invalid_field"),
  );
});

test("persisted cases reject damaged form shapes, mismatched evidence and impossible handled revisions", () => {
  for (const mutate of [
    (value) => {
      value.schema_version = 2;
    },
    (value) => {
      value.events.push(structuredClone(value.events[0]));
    },
    (value) => {
      delete value.events[0].risk_forms.medication.fields.actual_amount;
    },
    (value) => {
      value.events[0].risk_forms.medication.risk_type = "behaviour_abc";
    },
    (value) => {
      value.sources[0].kind = "background";
    },
    (value) => {
      value.events[0].risk_forms.medication.followup_status = "handled";
    },
    (value) => {
      value.events[0].risk_forms.medication.followup_status = "handled";
      value.events[0].risk_forms.medication.handled_revision = 999;
    },
  ]) {
    const value = medication();
    mutate(value);
    assert.throws(() => validateWorkflowCase(value), WorkflowCaseError);
  }
});

test("structured form evidence cannot be reused for a different field or rebound on replay", () => {
  const source = {
    id: "form:time",
    kind: "worker_form_edit",
    text: "Scheduled at 1 pm",
    field_path: "medication.scheduled_time",
  };
  const current = addWorkflowSource(base(), source);
  const saved = patch(current, {
    fields: { scheduled_time: known("1 pm", source.id) },
  });
  assert.equal(
    saved.events[0].risk_forms.medication.fields.scheduled_time.value,
    "1 pm",
  );
  assert.throws(
    () =>
      patch(current, {
        shared_fields: { occurred_at: known("1 pm", source.id) },
      }),
    code("invalid_source"),
  );
  assert.throws(
    () =>
      addWorkflowSource(current, {
        ...source,
        field_path: "shared_fields.occurred_at",
      }),
    code("invalid_source"),
  );
  assert.throws(
    () =>
      addWorkflowSource(base(), {
        ...source,
        field_path: "medication.missing_field",
      }),
    code("invalid_source"),
  );
  assert.throws(
    () => addWorkflowSource(base(), { ...source, kind: "worker_utterance" }),
    code("invalid_source"),
  );
  saved.events[0].shared_fields.occurred_at = known("1 pm", source.id);
  assert.throws(() => validateWorkflowCase(saved), code("invalid_source"));
});

test("context includes source identities, labels and all linked facts without returning mutable state", () => {
  const current = medication();
  const context = workflowCaseContext(current);
  assert.equal(context.revision, current.revision);
  assert.equal(context.sources[0].id, "worker:1");
  assert.ok(context.form_definitions.medication.fields.scheduled_dose);
  assert.match(context.evidence_instruction, /Background is context only/);
  context.sources[0].text = "Changed by client";
  context.events[0].shared_fields.what_happened.value = "Changed by client";
  context.form_definitions.medication.fields.scheduled_dose =
    "Changed by client";
  assert.notEqual(current.sources[0].text, "Changed by client");
  assert.notEqual(
    current.events[0].shared_fields.what_happened.value,
    "Changed by client",
  );
  assert.notEqual(
    workflowFormDefinitions.medication.fields.scheduled_dose,
    "Changed by client",
  );
});
