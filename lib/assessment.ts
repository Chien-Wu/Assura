import { z } from "zod";
import { assessmentQuestionText } from "./assessment-questions.ts";

export type AssessmentStatus =
  | "running"
  | "needs_answer"
  | "ready"
  | "failed"
  | "stale";
export const assessmentAreas = [
  "incident_injury",
  "incident_near_miss",
  "safeguarding",
  "health_wellbeing",
  "medication",
  "behaviour",
  "restrictive_practice",
  "complaint",
  "service_exception",
  "missing_person",
] as const;
export type AssessmentArea = (typeof assessmentAreas)[number];
export type AssessmentPriority = "P0" | "P1" | "P2" | "P3" | "P4";
export type AssessmentEvidence = { sourceId: string; quote: string };
export type AssessmentConcern = {
  id: string;
  areas: AssessmentArea[];
  title: string;
  whatHappened: string;
  resolution: "resolved" | "unresolved" | "unknown";
  howResolved: string | null;
  priority: AssessmentPriority;
  evidence: AssessmentEvidence[];
  missingInformation: string[];
  nextShiftWatchFor: string | null;
};
export const assessmentTopics = [
  "incident_safeguarding",
  "health_wellbeing",
  "medication",
  "behaviour_restriction",
  "complaint",
  "service_exception",
] as const;
export type AssessmentTopic = (typeof assessmentTopics)[number];
export type AssessmentScreeningState =
  | "not_discussed"
  | "explicit_no"
  | "concern"
  | "not_applicable"
  | "unknown";
export type AssessmentOutput = {
  action: "ask_question" | "show_summary";
  introduction: string | null;
  nextQuestion: { id: string; text: string } | null;
  concerns: AssessmentConcern[];
  screening: Array<{
    topic: AssessmentTopic;
    state: AssessmentScreeningState;
    evidence: AssessmentEvidence[];
  }>;
  summary: string;
  missingInformation: string[];
  contradictions: string[];
  urgentAttention: boolean;
  urgentMessage: string | null;
};
export type AssessmentMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  questionId: string | null;
  createdAt: string;
};
export type ShiftAssessment = {
  id: string;
  noteId: string;
  sourceRevision: number;
  revision: number;
  status: AssessmentStatus;
  result: AssessmentOutput | null;
  messages: AssessmentMessage[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AssessmentSource = { id: string; text: string };
export type AssessmentModelInput = {
  note: unknown;
  profile: unknown;
  history: unknown;
  sources: AssessmentSource[];
  messages: AssessmentMessage[];
  previous: AssessmentOutput | null;
};

const text = (max: number) => z.string().min(1).max(max);
const evidenceSchema = z
  .object({ sourceId: text(160), quote: text(3000) })
  .strict();
const evidenceList = z.array(evidenceSchema).max(30);
const missingList = z.array(text(1000)).max(40);
const concernSchema = z
  .object({
    id: text(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
    areas: z.array(z.enum(assessmentAreas)).min(1).max(assessmentAreas.length),
    title: text(200),
    whatHappened: text(6000),
    resolution: z.enum(["resolved", "unresolved", "unknown"]),
    howResolved: text(3000).nullable(),
    priority: z.enum(["P0", "P1", "P2", "P3", "P4"]),
    evidence: evidenceList.min(1),
    missingInformation: missingList,
    nextShiftWatchFor: text(2000).nullable(),
  })
  .strict();
const outputSchema = z
  .object({
    action: z.enum(["ask_question", "show_summary"]),
    introduction: text(600).nullable(),
    nextQuestion: z
      .object({ id: text(160), text: text(600) })
      .strict()
      .nullable(),
    concerns: z.array(concernSchema).max(20),
    screening: z
      .array(
        z
          .object({
            topic: z.enum(assessmentTopics),
            state: z.enum([
              "not_discussed",
              "explicit_no",
              "concern",
              "not_applicable",
              "unknown",
            ]),
            evidence: evidenceList,
          })
          .strict(),
      )
      .length(assessmentTopics.length),
    summary: z.string().max(10000),
    missingInformation: missingList,
    contradictions: z.array(text(2000)).max(40),
    urgentAttention: z.boolean(),
    urgentMessage: text(1000).nullable(),
  })
  .strict();

// The provider and local validator share one structural schema. All object fields
// are required; optional values are explicit nulls for strict Structured Outputs.
export const assessmentOutputJsonSchema = z.toJSONSchema(outputSchema);

export class AssessmentValidationError extends Error {
  constructor(
    message = "The assessment could not be validated. Please retry.",
  ) {
    super(message);
    this.name = "AssessmentValidationError";
  }
}

const topicForArea: Record<AssessmentArea, AssessmentTopic> = {
  incident_injury: "incident_safeguarding",
  incident_near_miss: "incident_safeguarding",
  safeguarding: "incident_safeguarding",
  missing_person: "incident_safeguarding",
  health_wellbeing: "health_wellbeing",
  medication: "medication",
  behaviour: "behaviour_restriction",
  restrictive_practice: "behaviour_restriction",
  complaint: "complaint",
  service_exception: "service_exception",
};

/** Exact citation checks establish provenance, not semantic entailment. The model
 * can still misinterpret a valid quote or write an unsupported derived summary;
 * the worker and manager review remain necessary. Only current-shift sources
 * belong in input.sources; profile/history are background supplied separately. */
export function validateAssessmentOutput(
  value: unknown,
  input: AssessmentModelInput,
): AssessmentOutput {
  const parsed = outputSchema.safeParse(value);
  // Do not expose Zod errors: they may include sensitive model content.
  if (!parsed.success) throw new AssessmentValidationError();
  const output: AssessmentOutput = parsed.data;
  const sources = new Map<string, string>();
  for (const source of input.sources) {
    if (!source.id || typeof source.text !== "string" || sources.has(source.id))
      throw new AssessmentValidationError(
        "Assessment sources are incomplete or ambiguous.",
      );
    sources.set(source.id, source.text);
  }
  const verifyEvidence = (evidence: AssessmentEvidence[]) => {
    for (const item of evidence) {
      if (
        !item.quote.trim() ||
        !sources.get(item.sourceId)?.includes(item.quote)
      )
        throw new AssessmentValidationError(
          "The assessment cited evidence that could not be verified. Please retry.",
        );
    }
  };
  const ids = output.concerns.map((concern) => concern.id);
  if (new Set(ids).size !== ids.length) throw new AssessmentValidationError();
  const topics = output.screening.map((item) => item.topic);
  if (new Set(topics).size !== assessmentTopics.length)
    throw new AssessmentValidationError(
      "The assessment did not account for every review area. Please retry.",
    );
  for (const concern of output.concerns) {
    verifyEvidence(concern.evidence);
    if (new Set(concern.areas).size !== concern.areas.length)
      throw new AssessmentValidationError();
    if ((concern.resolution === "resolved") !== (concern.howResolved !== null))
      throw new AssessmentValidationError(
        "The assessment's resolution details are inconsistent. Please retry.",
      );
    if (
      concern.resolution === "unknown" &&
      concern.missingInformation.length === 0
    )
      throw new AssessmentValidationError(
        "The assessment must preserve the unknown outcome. Please retry.",
      );
    for (const area of concern.areas) {
      if (
        !output.screening.some(
          (item) =>
            item.topic === topicForArea[area] && item.state === "concern",
        )
      )
        throw new AssessmentValidationError(
          "A recorded concern conflicts with the review coverage. Please retry.",
        );
    }
  }
  for (const screening of output.screening) {
    verifyEvidence(screening.evidence);
    if (screening.state === "not_discussed" && screening.evidence.length !== 0)
      throw new AssessmentValidationError();
    if (screening.state !== "not_discussed" && screening.evidence.length === 0)
      throw new AssessmentValidationError(
        "The assessment must cite evidence for its review coverage. Please retry.",
      );
    if (
      screening.state === "concern" &&
      !output.concerns.some((concern) =>
        concern.areas.some((area) => topicForArea[area] === screening.topic),
      )
    )
      throw new AssessmentValidationError(
        "A review concern has no corresponding event record. Please retry.",
      );
  }
  if (input.previous?.concerns.some((concern) => !ids.includes(concern.id)))
    throw new AssessmentValidationError(
      "A previously raised concern was omitted. Please retry.",
    );
  if (output.urgentAttention !== (output.urgentMessage !== null))
    throw new AssessmentValidationError(
      "The assessment's urgent guidance is inconsistent. Please retry.",
    );
  if (
    output.concerns.some(
      (concern) => concern.priority === "P3" || concern.priority === "P4",
    ) &&
    !output.urgentAttention
  )
    throw new AssessmentValidationError(
      "Immediate attention needs visible guidance. Please retry.",
    );
  if (output.action === "ask_question") {
    const question = output.nextQuestion;
    if (!question || question.text !== assessmentQuestionText(question.id, ids))
      throw new AssessmentValidationError(
        "The assessment returned an unsupported follow-up question. Please retry.",
      );
    if (
      input.messages.some(
        (message) =>
          message.role === "user" &&
          message.questionId === question.id &&
          message.text.trim(),
      )
    )
      throw new AssessmentValidationError(
        "The assessment repeated an answered question. Please retry.",
      );
    if (output.introduction?.includes("?"))
      throw new AssessmentValidationError(
        "The assessment must ask one question at a time. Please retry.",
      );
  } else if (output.nextQuestion !== null || !output.summary.trim()) {
    throw new AssessmentValidationError(
      "The assessment summary is incomplete. Please retry.",
    );
  }
  return output;
}
