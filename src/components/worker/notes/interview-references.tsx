"use client";
import type { QuestionStatus } from "@/lib/knowledge/interview";
import type { KnowledgeSource } from "@/lib/knowledge/records";
import { definitions, type ShiftNote } from "@/lib/notes/form";
import { useEffect, useState } from "react";

type ReferenceQuestion = {
  id: string;
  question: string;
  status: QuestionStatus;
  answerQuote: string | null;
  citations: (
    | (KnowledgeSource & { accessible: true })
    | { sourceId: string; accessible: false }
  )[];
};
const statuses: Record<QuestionStatus, string> = {
  proposed: "Prepared; not yet asked",
  emitted: "Asked; answer not recorded",
  answered: "Answer recorded",
  unknown: "Worker reported uncertainty",
  cancelled: "Not asked",
};

export default function InterviewReferences({
  note,
}: {
  note: ShiftNote | null;
}) {
  const [result, setResult] = useState<{
    noteId: string;
    questions: ReferenceQuestion[];
    error?: string;
  } | null>(null);
  const id = note?.id;
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    void fetch(`/api/notes/${id}/interview/questions`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Historical references are temporarily unavailable.");
        return response.json() as Promise<{ questions: ReferenceQuestion[] }>;
      })
      .then((data) => {
        if (!abort.signal.aborted)
          setResult({ noteId: id, questions: data.questions });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setResult({
            noteId: id,
            questions: [],
            error: "Historical references are temporarily unavailable.",
          });
      });
    return () => abort.abort();
  }, [id, note?.revision, note?.clarificationCount, note?.status]);
  if (
    !id ||
    result?.noteId !== id ||
    (!result.error && !result.questions.length)
  )
    return null;
  return (
    <section
      className="interview-references"
      aria-label="Historical references for interview questions"
    >
      <h3>Why these questions were asked</h3>
      <p>
        Earlier records provide context. This shift&apos;s observations come
        from the worker&apos;s answers.
      </p>
      {result.error && <p role="status">{result.error}</p>}
      {result.questions.map((question) => (
        <details key={question.id}>
          <summary>
            {question.question} <span>— {statuses[question.status]}</span>
          </summary>
          {question.answerQuote && (
            <p>Worker&apos;s answer: “{question.answerQuote}”</p>
          )}
          {question.citations.map((source) =>
            source.accessible ? (
              <details key={source.sourceId} className="interview-source">
                <summary>
                  Source shift: {source.shiftStart.replace("T", " ")} ·
                  Melbourne · {source.workerName}
                  {source.isSynthetic ? " · Fictional test record" : ""}
                </summary>
                {definitions
                  .filter(
                    ({ key }) =>
                      key !== "participant" &&
                      source.fields[key as keyof typeof source.fields],
                  )
                  .map(({ key, label }) => (
                    <div key={key}>
                      <strong>{label}</strong>
                      <p>{source.fields[key as keyof typeof source.fields]}</p>
                    </div>
                  ))}
              </details>
            ) : (
              <p key={source.sourceId}>
                A cited source is no longer available to your account.
              </p>
            ),
          )}
        </details>
      ))}
    </section>
  );
}
