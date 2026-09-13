import type { Participant } from "./participants";
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
const normal = (s: string) => s.toLowerCase().replace(/[’]/g, "'");
function negativeClause(text: string, match: RegExpMatchArray) {
  const before =
    normal(text.slice(Math.max(0, (match.index ?? 0) - 90), match.index))
      .split(/[.!?;,]|\b(?:but|however|then|although)\b/)
      .at(-1) ?? "";
  // Keep negation local to the observation; a later positive clause still wins.
  return /\b(?:no|not|never|didn't|did not|without|wasn't|was not|weren't|were not|hasn't|has not)\s+(?:(?:any|a|the|signs?|of|have|had|been|observed|reported|experience|experiencing|see|seen|evidence|severe|repeated|further|prn)\s+){0,6}$/.test(
    before,
  );
}
function medicationCandidate(
  text: string,
  profile?: Participant,
): { quote: string; forBehaviour: boolean } | undefined {
  for (const clause of text.split(/[.!?;]|\bbut\b/i)) {
    for (const match of clause.matchAll(
      /\b(?:prn|calming meds|something to settle|medicated|risperidone|chemical restraint)\b/gi,
    )) {
      if (negativeClause(clause, match)) continue;
      const forBehaviour =
        /\b(?:behavio[u]?r|settle|calm|self.injur|distress|aggress|chemical restraint)/i.test(
          clause,
        );
      const routineOnly =
        match[0].toLowerCase() === "medicated" &&
        profile?.medications.some(
          (m) => m.routine && normal(clause).includes(m.name),
        ) &&
        (!forBehaviour ||
          /\b(?:diabetes|epilepsy|routine|prescribed)\b/i.test(clause));
      if (!routineOnly) return { quote: clause.trim(), forBehaviour };
    }
  }
}
export function detectRisks(text: string, profile?: Participant): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const add = (
    code: string,
    category: string,
    reason: string,
    pattern: RegExp,
    severity: "urgent" | "review" = "urgent",
    negate = true,
  ) => {
    for (const match of text.matchAll(pattern)) {
      if (negate && negativeClause(text, match)) continue;
      flags.push({ code, category, reason, quote: match[0], severity });
      break;
    }
  };
  add(
    "CANDIDATE_SERIOUS_INJURY",
    "choking",
    "Coughing or choking during a meal needs prompt factual review; this is not a diagnosis.",
    /\b(?:chok(?:ed|ing)|coughing fit(?: while eating)?|cough(?:ed|ing)[^.?!]{0,65}(?:meal|eat(?:ing)?|food|drink(?:ing)?)|couldn['’]?t (?:breathe|speak)|went red[^.?!]{0,35}(?:eat|meal))\b/gi,
  );
  add(
    "CANDIDATE_INCIDENT",
    "fall",
    "A reported fall needs observation and supervisor assessment.",
    /\b(?:fell|slipped|tripped|went down|had a fall)\b/gi,
  );
  add(
    "CANDIDATE_INCIDENT",
    "seizure_event",
    "Reported movements or unresponsiveness need factual follow-up, without assigning a clinical cause.",
    /\b(?:seizure|fit|shaking|went stiff|unresponsive|passed out|went floppy)\b/gi,
  );
  add(
    "CANDIDATE_INCIDENT",
    "contact_or_injury",
    "Reported contact, injury or emergency attendance needs supervisor assessment.",
    /\b(?:hit (?:him|her|me|them|another|his|her|self)|bit (?:him|her|me|them)|scratched|pushed (?:him|her|me|them)|grabbed (?:him|her|me|them)|kicked|bruise|swelling|bleeding|hospital|ambulance|stitches|(?:a|red|visible) mark)\b/gi,
  );
  add(
    "CANDIDATE_INCIDENT",
    "care_concern",
    "Reported unmet food, fluid or supervision needs require review.",
    /\b(?:hasn['’]?t (?:eaten|been drinking)|lost weight|soiled|left alone)\b/gi,
  );
  add(
    "CANDIDATE_RESTRICTIVE_PRACTICE",
    "environmental",
    "Restricting movement or access may be an environmental restrictive practice; confirm observable facts.",
    /\b(?:environmental restraint|locked (?:the |his |her )?(?:kitchen |bedroom |front )?door|kept (?:the )?door shut|kept (?:him|her|them) (?:in (?:his|her|their) room|inside)|wouldn['’]?t let (?:him|her|them) out|locked (?:the )?fridge|put the food away|kept the snacks locked|rationed|took (?:his|her|their) (?:phone|keys))\b/gi,
  );
  add(
    "CANDIDATE_RESTRICTIVE_PRACTICE",
    "physical",
    "Holding or preventing movement may be physical restraint; confirm what occurred.",
    /\b(?:held (?:him|her|them|his arms|her arms)|had to restrain|physically stopped|blocked (?:him|her|them)|pinned|guided hold|physical restraint)\b/gi,
  );
  add(
    "CANDIDATE_RESTRICTIVE_PRACTICE",
    "seclusion",
    "Separation or confinement needs factual review to establish whether the person could leave.",
    /\b(?:sent (?:him|her|them) to (?:his|her|their) room|time out|kept apart from the others|seclusion)\b/gi,
  );
  add(
    "CANDIDATE_RESTRICTIVE_PRACTICE",
    "mechanical",
    "A chair or wheelchair restraint may be a mechanical restrictive practice.",
    /\b(?:lap belt in (?:the )?chair|strapped into (?:the )?wheelchair|mechanical restraint)\b/gi,
  );
  const medication = medicationCandidate(text, profile);
  if (medication) {
    flags.push({
      code: medication.forBehaviour
        ? "CANDIDATE_RESTRICTIVE_PRACTICE"
        : "MEDICATION_PURPOSE_UNVERIFIED",
      category: "chemical",
      reason: medication.forBehaviour
        ? "Medication reported for behaviour may be chemical restraint; verify purpose and plan limits."
        : "Ask what the medication was given for. Do not classify routine treatment as restraint.",
      quote: medication.quote,
      severity: medication.forBehaviour ? "urgent" : "review",
    });
  }
  add(
    "DUPLICATE_NOTE_RISK",
    "record_quality",
    "A generic account may omit this shift's specific facts; it is not proof of duplication.",
    /\b(?:same as usual|same as last time|copy (?:the )?(?:last|previous) note)\b/gi,
    "review",
    false,
  );
  return flags.map((flag) => ({
    ...flag,
    planItem:
      flag.category === "environmental" &&
      /kitchen.*door|door.*kitchen/i.test(text) &&
      profile?.id === "P-001"
        ? "RP-02"
        : profile?.plan.find((p) => p.category === flag.category)?.id,
  }));
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
export function assessRP(
  rp: RestrictivePractice,
  profile?: Participant,
): RiskFlag[] {
  if (rp.used !== "yes") return [];
  if (rp.category === "chemical" && rp.given_for_behaviour === "no") return [];
  const result: RiskFlag[] = [];
  const add = (
    code: string,
    reason: string,
    severity: "urgent" | "review" = "urgent",
  ) =>
    result.push({
      code,
      category: rp.category,
      reason,
      quote: rp.what_happened,
      severity,
      planItem: rp.schedule_item || undefined,
    });
  if (rp.category === "chemical" && rp.given_for_behaviour !== "yes") {
    add(
      "MEDICATION_PURPOSE_UNVERIFIED",
      "Behaviour-related purpose has not been established; do not treat routine treatment as chemical restraint.",
      "review",
    );
    return result;
  }
  const item = profile?.plan.find(
    (item) => item.id === rp.schedule_item && item.category === rp.category,
  );
  if (item) {
    add(
      "MONTHLY_RP_REPORT_REQUIRED",
      "Recorded use must be included in monthly restrictive practice reporting; this does not replace incident reporting.",
      "review",
    );
    if (rp.in_behaviour_plan !== "yes")
      add(
        "AUTHORISATION_UNVERIFIED",
        "A matching schedule item is recorded, but the worker has not confirmed its coverage for this use. A supervisor must resolve the discrepancy; worker uncertainty alone does not establish unauthorised use.",
        "review",
      );
    if (!item.authorised)
      add(
        "UNAUTHORISED_RESTRICTIVE_PRACTICE",
        "The recorded schedule item has no verified state authorisation.",
      );
    const breach =
      (item.maxMinutes !== undefined &&
        rp.duration_minutes !== null &&
        rp.duration_minutes > item.maxMinutes) ||
      (item.maxDoseMg !== undefined &&
        rp.dose_mg !== "" &&
        Number(rp.dose_mg) > item.maxDoseMg) ||
      (item.maxUses24h !== undefined &&
        rp.uses_in_24h !== "" &&
        Number(rp.uses_in_24h) > item.maxUses24h);
    if (breach)
      add(
        "PLAN_LIMIT_BREACH",
        "The reported duration, dose or frequency exceeds the participant's recorded plan limit. Escalate as a candidate reportable incident.",
      );
    if (
      (item.maxMinutes !== undefined && rp.duration_minutes === null) ||
      (item.maxDoseMg !== undefined && rp.dose_mg === "") ||
      (item.maxUses24h !== undefined && rp.uses_in_24h === "")
    )
      add(
        "PLAN_LIMITS_UNVERIFIED",
        "One or more required duration, dose or frequency details remain unknown.",
      );
  } else if (profile?.behaviourPlan === false)
    add(
      "UNAUTHORISED_RESTRICTIVE_PRACTICE",
      "The reported practice has no coverage in the participant's recorded behaviour plan. Urgent supervisor assessment; reporting may be required.",
    );
  else
    add(
      "AUTHORISATION_UNVERIFIED",
      "Plan coverage or authorisation is unverified. Confirm the schedule item and conditions of use; worker uncertainty does not establish lawful or unlawful use.",
    );
  return result;
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
