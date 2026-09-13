import { z } from "zod";
import type { AssessmentArea, AssessmentOutput } from "./legacy-assessment.ts";

export const riskTypes = [
  "incident_safeguarding",
  "health_medication",
  "behaviour_restrictive_practice",
  "complaint",
  "service_exception",
] as const;
export type RiskType = (typeof riskTypes)[number];
export type RiskLevel = "P0" | "P1" | "P2" | "P3" | "P4";
export const riskLevelLabels: Record<RiskLevel, string> = {
  P0: "Routine",
  P1: "Monitor",
  P2: "Internal review",
  P3: "Urgent",
  P4: "Critical",
};
export const riskTypeLabels: Record<RiskType, string> = {
  incident_safeguarding: "Incident and safeguarding",
  health_medication: "Health and medication",
  behaviour_restrictive_practice: "Behaviour and restrictive practice",
  complaint: "Complaint",
  service_exception: "Service exception",
};
export type RiskEvidence = { sourceId: string; quote: string };
export type RiskResult = {
  risks: Array<{ type: RiskType; level: RiskLevel; evidence: RiskEvidence[] }>;
  summary: string;
};
export type RiskAssessment = {
  id: string;
  noteId: string;
  sourceRevision: number;
  revision: number;
  schemaVersion: number;
  status: "running" | "ready" | "failed" | "stale";
  result: RiskResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RiskModelInput = {
  note: unknown;
  sources: Array<{ id: string; text: string }>;
};

const evidenceSchema = z
  .object({
    sourceId: z.string().min(1).max(160),
    quote: z.string().min(1).max(3000),
  })
  .strict();
const riskSchema = z
  .object({
    type: z.enum(riskTypes),
    level: z.enum(["P1", "P2", "P3", "P4"]),
    evidence: z.array(evidenceSchema).min(1).max(6),
  })
  .strict();
const resultSchema = z
  .object({
    risks: z.array(riskSchema).max(riskTypes.length),
    summary: z.string().min(1).max(1000),
  })
  .strict();
// A merged historical result may carry more evidence and a longer original
// summary than a new short model response. Keep normalization idempotent.
const normalizedSchema = resultSchema.extend({
  risks: z
    .array(
      riskSchema.extend({ evidence: z.array(evidenceSchema).min(1).max(600) }),
    )
    .max(riskTypes.length),
  summary: z.string().min(1).max(10000),
});
export const riskResultJsonSchema = z.toJSONSchema(resultSchema);

export class RiskValidationError extends Error {
  constructor() {
    super("The risk check could not verify its result. Please retry.");
    this.name = "RiskValidationError";
  }
}

function hasQuestion(text: string): boolean {
  return (
    /[?？]/u.test(text) ||
    /\b(?:ask|interview|question)\s+(?:the\s+)?(?:worker|participant|reporter)\b/i.test(
      text,
    ) ||
    /(?:^|[.!]\s+)(?:please\s+)?(?:clarify|tell (?:us|me)|provide (?:more|further)|confirm (?:whether|if)|describe (?:what|how))\b/i.test(
      text,
    )
  );
}

export function validateRiskResult(
  value: unknown,
  input: RiskModelInput,
): RiskResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new RiskValidationError();
  const result = parsed.data;
  if (
    !result.summary.trim() ||
    hasQuestion(result.summary) ||
    new Set(result.risks.map((risk) => risk.type)).size !== result.risks.length
  )
    throw new RiskValidationError();
  const sources = new Map<string, string>();
  for (const source of input.sources) {
    if (
      !source.id.trim() ||
      sources.has(source.id) ||
      typeof source.text !== "string"
    )
      throw new RiskValidationError();
    sources.set(source.id, source.text);
  }
  for (const risk of result.risks) {
    for (const evidence of risk.evidence) {
      if (
        !evidence.quote.trim() ||
        !sources.get(evidence.sourceId)?.includes(evidence.quote)
      )
        throw new RiskValidationError();
    }
  }
  // Exact quotation proves provenance, not that every derived interpretation is
  // entailed. The short summary and risk levels remain suggestions for review.
  return result;
}

export function overallRiskLevel(result: RiskResult): RiskLevel {
  return result.risks.reduce<RiskLevel>(
    (level, risk) => (risk.level > level ? risk.level : level),
    "P0",
  );
}

const legacyAreaTypes: Record<AssessmentArea, RiskType> = {
  incident_injury: "incident_safeguarding",
  incident_near_miss: "incident_safeguarding",
  safeguarding: "incident_safeguarding",
  missing_person: "incident_safeguarding",
  health_wellbeing: "health_medication",
  medication: "health_medication",
  behaviour: "behaviour_restrictive_practice",
  restrictive_practice: "behaviour_restrictive_practice",
  complaint: "complaint",
  service_exception: "service_exception",
};

// Historical normalization is deliberately separate from current model validation.
// It preserves all old summary text and evidence without editing stored JSON.
const legacySchema = z
  .object({
    action: z.literal("show_summary"),
    introduction: z.string().nullable(),
    nextQuestion: z.null(),
    concerns: z
      .array(
        z
          .object({
            id: z.string().min(1),
            areas: z
              .array(
                z.enum(
                  Object.keys(legacyAreaTypes) as [
                    AssessmentArea,
                    ...AssessmentArea[],
                  ],
                ),
              )
              .min(1),
            title: z.string().min(1),
            whatHappened: z.string().min(1),
            resolution: z.enum(["resolved", "unresolved", "unknown"]),
            howResolved: z.string().nullable(),
            priority: z.enum(["P0", "P1", "P2", "P3", "P4"]),
            evidence: z.array(evidenceSchema).min(1),
            missingInformation: z.array(z.string()),
            nextShiftWatchFor: z.string().nullable(),
          })
          .strict(),
      )
      .max(20),
    screening: z
      .array(
        z
          .object({
            topic: z.enum([
              "incident_safeguarding",
              "health_wellbeing",
              "medication",
              "behaviour_restriction",
              "complaint",
              "service_exception",
            ]),
            state: z.enum([
              "not_discussed",
              "explicit_no",
              "concern",
              "not_applicable",
              "unknown",
            ]),
            evidence: z.array(evidenceSchema),
          })
          .strict(),
      )
      .length(6),
    summary: z.string().min(1).max(10000),
    missingInformation: z.array(z.string()),
    contradictions: z.array(z.string()),
    urgentAttention: z.boolean(),
    urgentMessage: z.string().nullable(),
  })
  .strict();

export function normalizeRiskResult(value: unknown): RiskResult | null {
  const current = normalizedSchema.safeParse(value);
  if (current.success) {
    if (
      !current.data.summary.trim() ||
      hasQuestion(current.data.summary) ||
      new Set(current.data.risks.map((risk) => risk.type)).size !==
        current.data.risks.length
    )
      return null;
    if (
      current.data.risks.some((risk) =>
        risk.evidence.some(
          (evidence) => !evidence.sourceId.trim() || !evidence.quote.trim(),
        ),
      )
    )
      return null;
    return current.data;
  }
  const parsed = legacySchema.safeParse(value);
  if (!parsed.success) return null;
  const legacy: AssessmentOutput = parsed.data;
  if (
    !legacy.summary.trim() ||
    new Set(legacy.screening.map((entry) => entry.topic)).size !== 6
  )
    return null;
  if (
    legacy.concerns.length === 0 &&
    (legacy.urgentAttention ||
      legacy.screening.some((entry) => entry.state === "concern"))
  )
    return null;
  const grouped = new Map<RiskType, RiskResult["risks"][number]>();
  for (const concern of legacy.concerns) {
    // A historical P0 concern is informational; do not manufacture a P1 finding.
    if (concern.priority === "P0") continue;
    for (const area of concern.areas) {
      const type = legacyAreaTypes[area];
      const existing = grouped.get(type);
      const evidence = [...(existing?.evidence ?? []), ...concern.evidence];
      if (evidence.some((item) => !item.sourceId.trim() || !item.quote.trim()))
        return null;
      grouped.set(type, {
        type,
        level:
          existing && existing.level > concern.priority
            ? existing.level
            : concern.priority,
        evidence: [
          ...new Map(
            evidence.map((item) => [
              JSON.stringify([item.sourceId, item.quote]),
              { ...item },
            ]),
          ).values(),
        ],
      });
    }
  }
  if (legacy.urgentAttention && grouped.size === 0) return null;
  return {
    risks: riskTypes.flatMap((type) =>
      grouped.has(type) ? [grouped.get(type)!] : [],
    ),
    summary: legacy.summary,
  };
}
