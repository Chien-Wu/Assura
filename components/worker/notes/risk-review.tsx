"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  normalizeRiskResult,
  overallRiskLevel,
  riskLevelLabels,
  riskTypeLabels,
  type RiskAssessment,
  type RiskResult,
} from "@/lib/assessment/result";
import {
  answerText,
  applicable,
  definitions,
  type ShiftNote,
} from "@/lib/notes/form";
import {
  AlertCircle,
  Check,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./risk-review.module.css";

type Payload = {
  note: ShiftNote;
  assessment: RiskAssessment | null;
  enabled: boolean;
};
type Binding = {
  note: ShiftNote;
  assessment: RiskAssessment;
  confirmationId: string;
};
type Props = {
  note: ShiftNote;
  onClose: () => void;
  onSaved: (note: ShiftNote) => void;
  onReload: (note: ShiftNote) => void;
};

class ReviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new ReviewRequestError(
      result.error ?? "Could not finish this check. Please try again.",
      response.status,
    );
  return result;
}

export function RiskSummary({ result }: { result: RiskResult }) {
  const level = overallRiskLevel(result);
  return (
    <section
      className={styles.riskCard}
      data-level={level}
      aria-label="AI risk check"
    >
      <div className={styles.riskHeading}>
        <span>
          <ShieldCheck size={17} aria-hidden="true" /> AI check
        </span>
        <strong className={styles.level}>
          {level} · {riskLevelLabels[level]}
        </strong>
      </div>
      {result.risks.length > 0 && (
        <ul className={styles.riskTypes}>
          {result.risks.map((risk) => (
            <li key={risk.type}>
              {riskTypeLabels[risk.type]} <strong>{risk.level}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.summary}>{result.summary}</p>
      <p className={styles.caption}>AI suggestions for human review.</p>
    </section>
  );
}

export default function RiskReview({
  note,
  onClose,
  onSaved,
  onReload,
}: Props) {
  const readOnly = note.status === "complete";
  const endpoint = `/api/notes/${encodeURIComponent(note.id)}/assessment`;
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [busy, setBusy] = useState(readOnly ? "" : "loading");
  const [error, setError] = useState("");
  const [changedNote, setChangedNote] = useState<ShiftNote | null>(null);
  const live = useRef(true);
  const operation = useRef(false);
  const latestAssessment = useRef<RiskAssessment | null>(null);
  const latestBinding = useRef<Binding | null>(null);
  const callbacks = useRef({ onClose, onSaved, onReload });
  useEffect(() => {
    callbacks.current = { onClose, onSaved, onReload };
  }, [onClose, onSaved, onReload]);

  const accept = useCallback(
    (payload: Payload): boolean => {
      if (!live.current) return false;
      if (
        payload.note.id !== note.id ||
        payload.note.revision !== note.revision
      ) {
        setChangedNote(payload.note);
        latestBinding.current = null;
        setBinding(null);
        setError(
          "The saved note changed. Load that version before confirming.",
        );
        return false;
      }
      if (payload.note.status === "complete" && !readOnly) {
        callbacks.current.onSaved(payload.note);
        return false;
      }
      const candidate = payload.assessment;
      if (
        candidate &&
        latestAssessment.current?.id === candidate.id &&
        candidate.revision < latestAssessment.current.revision
      )
        return false;
      latestAssessment.current = candidate;
      setAssessment(candidate);
      const currentBinding = latestBinding.current;
      if (
        currentBinding &&
        (!candidate ||
          candidate.id !== currentBinding.assessment.id ||
          candidate.revision !== currentBinding.assessment.revision ||
          candidate.status !== "ready" ||
          candidate.sourceRevision !== note.revision)
      ) {
        latestBinding.current = null;
        setBinding(null);
      }
      return true;
    },
    [note.id, note.revision, readOnly],
  );

  const prepare = useCallback(
    async (current: RiskAssessment) => {
      if (!live.current) return;
      if (
        current.schemaVersion !== 2 ||
        current.status !== "ready" ||
        current.sourceRevision !== note.revision ||
        !normalizeRiskResult(current.result)
      ) {
        throw new Error(
          "The check has not produced a verified result for this saved note. Please retry.",
        );
      }
      const existing = latestBinding.current;
      if (
        existing?.assessment.id === current.id &&
        existing.assessment.revision === current.revision
      )
        return;
      setBusy("prepare");
      const prepared = await request<Binding>(
        `/api/notes/${encodeURIComponent(note.id)}/review`,
        {
          revision: note.revision,
          assessmentId: current.id,
          assessmentRevision: current.revision,
        },
      );
      if (!live.current) return;
      if (
        prepared.note.id !== note.id ||
        prepared.note.revision !== note.revision ||
        prepared.assessment.id !== current.id ||
        prepared.assessment.revision !== current.revision ||
        prepared.assessment.sourceRevision !== note.revision ||
        prepared.assessment.status !== "ready" ||
        !prepared.confirmationId
      ) {
        throw new Error(
          "The saved record changed while preparing review. Refresh it before confirming.",
        );
      }
      latestBinding.current = prepared;
      setBinding(prepared);
    },
    [note.id, note.revision],
  );

  const sync = useCallback(
    async (payload: Payload) => {
      if (!accept(payload)) return;
      const current = payload.assessment;
      if (
        current?.schemaVersion === 2 &&
        current.sourceRevision === note.revision &&
        current.status === "ready"
      ) {
        setError("");
        await prepare(current);
      } else if (current?.status === "failed") {
        setError(
          current.error ??
            "The check could not finish. Your saved note is safe; retry when ready.",
        );
      } else if (current?.status === "stale") {
        setError(
          "This check belongs to an earlier saved version. Retry to check the current note.",
        );
      } else if (!current || current.schemaVersion !== 2) {
        setError(
          "A current check is needed before this note can be confirmed.",
        );
      } else {
        setError("");
      }
    },
    [accept, prepare, note.revision],
  );

  const check = useCallback(
    async (retry = false) => {
      if (operation.current || readOnly) return;
      operation.current = true;
      setBusy("checking");
      setError("");
      try {
        const payload = await request<Payload>(endpoint);
        if (!accept(payload)) return;
        const current = payload.assessment;
        const exact =
          current?.schemaVersion === 2 &&
          current.sourceRevision === note.revision;
        if (exact && current.status === "ready") {
          await prepare(current);
          return;
        }
        if (exact && current.status === "running") return;
        if (!payload.enabled)
          throw new Error(
            "The AI check needs setup. Your draft is saved; try again once the service is available.",
          );
        if (exact && current.status === "failed" && !retry) {
          setError(
            current.error ?? "The check could not finish. Your draft is saved.",
          );
          return;
        }
        const result = await request<Payload>(
          endpoint,
          exact && current.status === "failed"
            ? {
                action: "retry",
                assessmentId: current.id,
                revision: current.revision,
              }
            : { action: "start", revision: note.revision },
        );
        await sync(result);
      } catch (cause) {
        if (live.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not check the note. Please retry.",
          );
      } finally {
        operation.current = false;
        if (live.current) setBusy("");
      }
    },
    [endpoint, note.revision, accept, prepare, sync, readOnly],
  );

  useEffect(() => {
    live.current = true;
    const start = setTimeout(() => {
      if (!readOnly) void check();
    }, 0);
    // A saved server check can finish after closing; never update the editor from
    // its late response. Reopening reads that same note revision's saved result.
    return () => {
      clearTimeout(start);
      live.current = false;
    };
  }, [check, readOnly]);

  useEffect(() => {
    if (assessment?.status !== "running" || changedNote || readOnly) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!operation.current) {
        operation.current = true;
        try {
          const payload = await request<Payload>(endpoint);
          if (!cancelled) await sync(payload);
        } catch (cause) {
          if (live.current)
            setError(
              cause instanceof Error
                ? cause.message
                : "Connection interrupted. Your saved note is safe.",
            );
        } finally {
          operation.current = false;
          if (live.current) setBusy("");
        }
      }
      if (!cancelled) timer = setTimeout(poll, 1800);
    }
    timer = setTimeout(poll, 1800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assessment?.status, endpoint, sync, changedNote, readOnly]);

  async function confirm() {
    const prepared = latestBinding.current;
    if (!prepared || operation.current || changedNote || readOnly) return;
    operation.current = true;
    setBusy("confirm");
    setError("");
    try {
      const response = await request<{ note: ShiftNote }>(
        `/api/notes/${encodeURIComponent(note.id)}/confirm`,
        {
          revision: prepared.note.revision,
          assessmentId: prepared.assessment.id,
          assessmentRevision: prepared.assessment.revision,
          confirmationId: prepared.confirmationId,
          confirmed: true,
        },
      );
      if (
        response.note.id !== note.id ||
        response.note.revision !== note.revision ||
        response.note.status !== "complete"
      )
        throw new Error(
          "The server did not confirm this saved version. Please refresh and try again.",
        );
      if (live.current) callbacks.current.onSaved(response.note);
    } catch (cause) {
      if (!live.current) return;
      if (cause instanceof ReviewRequestError && cause.status === 409) {
        latestBinding.current = null;
        setBinding(null);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not confirm your note. Please try again.",
      );
      // Recover an acknowledged save when only its response was interrupted.
      try {
        const latest = await request<Payload>(endpoint);
        accept(latest);
      } catch {
        /* Keep the original error and exact confirmation binding. */
      }
    } finally {
      operation.current = false;
      if (live.current) setBusy("");
    }
  }

  const result = readOnly
    ? normalizeRiskResult(note.assessment)
    : !changedNote &&
        assessment?.schemaVersion === 2 &&
        assessment.status === "ready" &&
        assessment.sourceRevision === note.revision
      ? normalizeRiskResult(assessment.result)
      : null;
  const checking =
    !readOnly &&
    !changedNote &&
    (busy === "loading" ||
      busy === "checking" ||
      busy === "prepare" ||
      assessment?.status === "running");
  const canConfirm = Boolean(
    binding && result && !changedNote && !busy && !readOnly,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && busy !== "confirm") onClose();
      }}
    >
      <DialogContent
        className={styles.dialog}
        showCloseButton={busy !== "confirm"}
      >
        <div>
          <DialogTitle>
            {readOnly ? "Your saved shift note" : "Review your shift note"}
          </DialogTitle>
          <DialogDescription className={styles.description}>
            {readOnly
              ? "The record you confirmed, with its saved check."
              : "Check that this saved account accurately reflects your shift, then confirm it."}
          </DialogDescription>
        </div>
        <div className={styles.scroll}>
          {result ? (
            <RiskSummary result={result} />
          ) : checking ? (
            <div className={styles.checking} role="status">
              <LoaderCircle size={18} className="spin" />
              <div>
                <strong>Checking the saved note…</strong>
                <p>Your account is ready to review below.</p>
              </div>
            </div>
          ) : readOnly ? (
            <p className={styles.legacy}>
              No saved AI check is available for this earlier record.
            </p>
          ) : null}
          {error && (
            <div className={styles.error} role="alert">
              <AlertCircle size={18} />
              <div>
                <p>{error}</p>
                {!changedNote && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={() => void check(true)}
                  >
                    <RefreshCw size={14} />
                    {assessment?.status === "ready"
                      ? "Retry review"
                      : "Retry check"}
                  </Button>
                )}
              </div>
            </div>
          )}
          {changedNote && (
            <Button variant="outline" onClick={() => onReload(changedNote)}>
              <RefreshCw size={15} /> Load latest saved note
            </Button>
          )}
          <section className={styles.account} aria-label="Saved worker account">
            <div className={styles.accountHeading}>
              <h3>Your saved account</h3>
              <span>{note.workerName}</span>
            </div>
            <p className={styles.timezone}>Shift times: {note.timezone}</p>
            <dl>
              {definitions
                .filter(
                  ({ key, section }) =>
                    applicable(key, note.fields) &&
                    (section < 3 ||
                      !["unanswered", "unknown", ""].includes(
                        note.fields[key],
                      )),
                )
                .map(({ key, label }) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {key === "shiftStart" || key === "shiftEnd"
                        ? note.fields[key].replace("T", " · ")
                        : answerText(key, note.fields[key])}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        </div>
        <DialogFooter className={styles.footer}>
          <Button
            variant="outline"
            disabled={busy === "confirm"}
            onClick={onClose}
          >
            {readOnly ? "Close" : "Back to editing"}
          </Button>
          {!readOnly && (
            <Button disabled={!canConfirm} onClick={() => void confirm()}>
              {busy === "confirm" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              {busy === "confirm" ? "Saving…" : "Confirm & save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
