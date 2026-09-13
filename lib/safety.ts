// Retained safety fields and recorded flags support existing notes and audit views.
// New risk classification uses the silent assessment service.
export type FieldState = "stated_positive" | "stated_negative" | "not_reviewed";
export type RestrictivePractice = {
  used: "not_reviewed" | "yes" | "no" | "unsure";
  what_happened: string;
  category:
    | "environmental"
    | "chemical"
    | "physical"
    | "mechanical"
    | "seclusion"
    | "unsure";
  in_behaviour_plan: "not_reviewed" | "yes" | "no" | "worker_does_not_know";
  schedule_item: string;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  behaviour_of_concern: string;
  dose_mg: string;
  uses_in_24h: string;
  given_for_behaviour: "not_reviewed" | "yes" | "no" | "unsure";
  harm: "not_reviewed" | "yes" | "no" | "unsure";
};
export type Safety = {
  fieldStates: Record<string, FieldState>;
  evidence: Record<string, string>;
  restrictivePractice: RestrictivePractice;
};
export type RiskFlag = {
  id?: string;
  code: string;
  category: string;
  reason: string;
  quote: string;
  severity: "urgent" | "review";
  capturedAt?: string;
  sessionId?: string;
  sequence?: number;
  planItem?: string;
};
export const emptyRP = (): RestrictivePractice => ({
  used: "not_reviewed",
  what_happened: "",
  category: "unsure",
  in_behaviour_plan: "not_reviewed",
  schedule_item: "",
  start_time: "",
  end_time: "",
  duration_minutes: null,
  behaviour_of_concern: "",
  dose_mg: "",
  uses_in_24h: "",
  given_for_behaviour: "not_reviewed",
  harm: "not_reviewed",
});
export const emptySafety = (): Safety => ({
  fieldStates: {},
  evidence: {},
  restrictivePractice: emptyRP(),
});
export function readSafety(raw?: string | null): Safety {
  const value = raw ? JSON.parse(raw) : {};
  return {
    ...emptySafety(),
    ...value,
    restrictivePractice: { ...emptyRP(), ...value.restrictivePractice },
  };
}
export function rpPatch(
  current: RestrictivePractice,
  patch: unknown,
): RestrictivePractice {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid restrictive practice details.");
  const next = { ...current };
  const choices: Record<string, string[]> = {
    used: ["not_reviewed", "yes", "no", "unsure"],
    category: [
      "environmental",
      "chemical",
      "physical",
      "mechanical",
      "seclusion",
      "unsure",
    ],
    in_behaviour_plan: ["not_reviewed", "yes", "no", "worker_does_not_know"],
    given_for_behaviour: ["not_reviewed", "yes", "no", "unsure"],
    harm: ["not_reviewed", "yes", "no", "unsure"],
  };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "duration_minutes") continue;
    if (
      !Object.hasOwn(current, key) ||
      typeof value !== "string" ||
      value.length > 6000
    )
      throw new Error("Unsupported restrictive practice field.");
    if (choices[key] && !choices[key].includes(value))
      throw new Error(`Invalid ${key}.`);
    if (
      ["dose_mg", "uses_in_24h"].includes(key) &&
      value !== "" &&
      (!/^\d+(?:\.\d+)?$/.test(value) ||
        (key === "uses_in_24h" && !Number.isInteger(Number(value))))
    )
      throw new Error(`Enter a numeric ${key} or leave it unknown.`);
    if (
      ["start_time", "end_time"].includes(key) &&
      value &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) ||
        !Number.isFinite(Date.parse(value + ":00Z")) ||
        new Date(value + ":00Z").toISOString().slice(0, 16) !== value)
    )
      throw new Error("Restrictive practice times need a date and time.");
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  const start = Date.parse(next.start_time + ":00Z"),
    end = Date.parse(next.end_time + ":00Z");
  if (Number.isFinite(start) && Number.isFinite(end) && end < start)
    throw new Error(
      "The end must follow the start; include the next date for overnight use.",
    );
  next.duration_minutes =
    Number.isFinite(start) && Number.isFinite(end)
      ? (end - start) / 60000
      : null;
  return next;
}
export function retentionUntil(createdAt: string, dob: string | null = null) {
  const date = new Date(createdAt);
  date.setUTCFullYear(date.getUTCFullYear() + 7);
  if (dob) {
    const birth = new Date(dob);
    const ageAtCreation =
      (Date.parse(createdAt) - birth.valueOf()) / (365.25 * 86400000);
    if (ageAtCreation < 18) {
      birth.setUTCFullYear(birth.getUTCFullYear() + 25);
      if (birth > date) return birth.toISOString();
    }
  }
  return date.toISOString();
}
export const reportingGuidance =
  "Urgent supervisor assessment. Commission guidance: 24 hours where harm occurred or a 24-hour incident category applies; otherwise unauthorised restrictive practice notification is generally due within five business days of provider awareness. Unknown harm or authorisation requires clarification. Registered-provider obligations must be assessed by a responsible person.";
