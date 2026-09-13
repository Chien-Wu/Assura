export type PendingAssessmentAnswer = {
  action: "answer";
  assessmentId: string;
  revision: number;
  questionId: string;
  answer: string;
  requestId: string;
};
export type AssessmentAnswerScope = {
  assessmentId: string;
  questionId: string;
};
export type AssessmentAnswerDraft = {
  text: string;
  assessmentId: string | null;
  questionId: string | null;
  pending: PendingAssessmentAnswer | null;
};

export function sameAssessmentAnswerScope(
  draft: AssessmentAnswerScope | null,
  current: AssessmentAnswerScope | null,
): boolean {
  return Boolean(
    draft &&
      current &&
      draft.assessmentId === current.assessmentId &&
      draft.questionId === current.questionId,
  );
}

function isPendingAnswer(value: unknown): value is PendingAssessmentAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Record<string, unknown>;
  return (
    pending.action === "answer" &&
    typeof pending.assessmentId === "string" &&
    pending.assessmentId.length > 0 &&
    typeof pending.questionId === "string" &&
    pending.questionId.length > 0 &&
    Number.isSafeInteger(pending.revision) &&
    Number(pending.revision) >= 0 &&
    typeof pending.answer === "string" &&
    pending.answer.trim().length > 0 &&
    pending.answer.length <= 6000 &&
    typeof pending.requestId === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(pending.requestId)
  );
}

/** Old unscoped text is retained as a detached draft, never assigned to whatever
 * question happens to be current when the page is reopened. A saved retry has
 * its original authoritative scope in the pending request. */
export function parseAssessmentAnswerDraft(
  raw: string,
): AssessmentAnswerDraft | null {
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const pending = isPendingAnswer(value.pending) ? value.pending : null;
  const text =
    pending?.answer ??
    (typeof value.text === "string"
      ? value.text
      : typeof value.answer === "string"
        ? value.answer
        : "");
  if (!text && !pending) return null;
  return {
    text,
    assessmentId:
      pending?.assessmentId ??
      (typeof value.assessmentId === "string" && value.assessmentId
        ? value.assessmentId
        : null),
    questionId:
      pending?.questionId ??
      (typeof value.questionId === "string" && value.questionId
        ? value.questionId
        : null),
    pending,
  };
}
