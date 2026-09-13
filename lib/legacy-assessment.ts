// Read-only shapes for historical conversational assessments.
// Current classification and legacy-result validation live in risk-assessment.ts.
export type AssessmentStatus =
  | "running"
  | "needs_answer"
  | "ready"
  | "failed"
  | "stale";
export type AssessmentArea =
  | "incident_injury"
  | "incident_near_miss"
  | "safeguarding"
  | "health_wellbeing"
  | "medication"
  | "behaviour"
  | "restrictive_practice"
  | "complaint"
  | "service_exception"
  | "missing_person";
type AssessmentPriority = "P0" | "P1" | "P2" | "P3" | "P4";
type AssessmentEvidence = { sourceId: string; quote: string };
type AssessmentConcern = {
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
type AssessmentTopic =
  | "incident_safeguarding"
  | "health_wellbeing"
  | "medication"
  | "behaviour_restriction"
  | "complaint"
  | "service_exception";
type AssessmentScreeningState =
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
