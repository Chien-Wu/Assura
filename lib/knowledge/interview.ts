export type QuestionStatus =
  | "proposed"
  | "emitted"
  | "answered"
  | "unknown"
  | "cancelled";
type QuestionUpdate = {
  questionId: string;
  state: "answered" | "unknown";
  quote: string;
};

export function normalizeQuestion(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanQuestionInput(input: Record<string, unknown>) {
  const { retrievalId, sourceIds, purposeKey, question } = input;
  if (
    typeof retrievalId !== "string" ||
    retrievalId.length > 80 ||
    !retrievalId ||
    !Array.isArray(sourceIds) ||
    sourceIds.length < 1 ||
    sourceIds.length > 4 ||
    sourceIds.some((id) => typeof id !== "string" || !id || id.length > 120) ||
    new Set(sourceIds).size !== sourceIds.length ||
    typeof purposeKey !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{2,99}$/.test(purposeKey) ||
    typeof question !== "string" ||
    question.trim().length < 12 ||
    question.length > 700 ||
    (question.match(/\?/g)?.length ?? 0) !== 1 ||
    !question.trim().endsWith("?") ||
    /[\u0000-\u001f]/.test(question)
  ) {
    throw new Error(
      "Provide one question, a stable purpose key, and one to four source IDs from the retrieval result.",
    );
  }
  const questionKey = normalizeQuestion(question);
  if (
    questionKey.length < 8 ||
    questionKey.split(" ").length < 2 ||
    !/\p{L}/u.test(questionKey)
  ) {
    throw new Error(
      "Provide a substantive question rather than punctuation or identifiers.",
    );
  }
  return {
    retrievalId,
    sourceIds: (sourceIds as string[]).slice().sort(),
    purposeKey,
    question: question.trim(),
    questionKey,
  };
}

export function cleanQuestionUpdates(value: unknown): QuestionUpdate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3)
    throw new Error("Provide at most three question updates.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.questionId !== "string" ||
      !item.questionId ||
      item.questionId.length > 80 ||
      ids.has(item.questionId) ||
      !["answered", "unknown"].includes(item.state) ||
      typeof item.quote !== "string" ||
      item.quote.trim().length < 2 ||
      item.quote.length > 2000
    ) {
      throw new Error(
        "Question updates require a unique question ID, answered/unknown state and an exact worker quote.",
      );
    }
    ids.add(item.questionId);
    return {
      questionId: item.questionId,
      state: item.state,
      quote: item.quote.trim(),
    };
  });
}
