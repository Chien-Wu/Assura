"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  riskLevelLabels,
  riskTypeLabels,
  type RiskEvidence,
  type RiskLevel,
  type RiskType,
} from "@/lib/assessment/result";
import type { RiskTypeFilter } from "@/lib/assessment/shift-risk";
import { ArrowUpRight, CheckCheck, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import styles from "./finding-review.module.css";

export type RiskFinding = {
  id: string;
  assessmentId: string;
  noteId: string;
  participant: string;
  workerName: string;
  sourceRevision: number;
  isCurrent: boolean;
  noteStatus: string;
  type: RiskType;
  aiLevel: RiskLevel;
  evidence: RiskEvidence[];
  summary: string;
  createdAt: string;
  reviewStatus: "open" | "reviewing" | "closed";
  managerLevel: RiskLevel | null;
  reviewRevision: number;
  history: {
    id: string;
    actorName: string;
    createdAt: string;
    status: string;
    managerLevel: RiskLevel | null;
    comment: string;
  }[];
};
const statusLabels = {
  open: "Awaiting review",
  reviewing: "In review",
  closed: "Closed",
};
const when = (value: string) => new Date(value).toLocaleString();

export function RiskBadge({
  level,
  prefix = "",
}: {
  level: RiskLevel;
  prefix?: string;
}) {
  return (
    <span className={styles.badge} data-level={level}>
      {prefix}
      {level} · {riskLevelLabels[level]}
    </span>
  );
}

export default function FindingReview({
  findings,
  loading,
  onRefresh,
  onAudit,
  providerId,
  riskType = "all",
  noteIds,
}: {
  findings: RiskFinding[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onAudit: (id: string) => void;
  providerId?: string;
  riskType?: RiskTypeFilter;
  noteIds?: Set<string>;
}) {
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<RiskFinding | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const matching = findings.filter(
    (finding) =>
      (!noteIds || noteIds.has(finding.noteId)) &&
      (riskType === "all" || finding.type === riskType),
  );
  const visible = matching.filter(
    (finding) =>
      filter === "all" ||
      (filter === "closed"
        ? finding.reviewStatus === "closed"
        : finding.reviewStatus !== "closed" &&
          (filter !== "urgent" ||
            (finding.managerLevel ?? finding.aiLevel) >= "P3")),
  );
  const pending = matching.filter(
    (finding) => finding.reviewStatus !== "closed",
  ).length;
  return (
    <section className={styles.queue} aria-label="AI risk review">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>SHIFT RISK CHECKS</span>
          <h3>
            Needs your attention <span>{pending}</span>
          </h3>
          <p>
            Findings from the shifts shown above. Read the evidence and record
            your decision.
          </p>
        </div>
        <label className={styles.filter}>
          Show
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="pending">Open findings</option>
            <option value="urgent">Urgent & critical</option>
            <option value="closed">Closed</option>
            <option value="all">All findings</option>
          </select>
        </label>
      </div>
      {notice && (
        <p role="status" className={styles.notice}>
          <CheckCheck size={16} />
          {notice}
        </p>
      )}
      {!visible.length ? (
        <div className={styles.empty}>
          <ShieldCheck size={28} />
          <strong>
            {loading ? "Loading risk checks…" : "No findings in this view"}
          </strong>
          <p>
            Routine checks stay with the shift note. Findings appear here as
            soon as a check finishes.
          </p>
        </div>
      ) : (
        <div className={styles.rows}>
          {visible.map((finding) => (
            <button
              className={styles.row}
              key={finding.id}
              onClick={() => {
                setNotice("");
                setSelected(finding);
              }}
            >
              <div className={styles.priority}>
                <RiskBadge level={finding.managerLevel ?? finding.aiLevel} />
                <small>{statusLabels[finding.reviewStatus]}</small>
              </div>
              <div className={styles.subject}>
                <strong>
                  {finding.participant || "Participant in linked note"}
                </strong>
                <span>{riskTypeLabels[finding.type]}</span>
                <p>{finding.summary}</p>
              </div>
              <div className={styles.context}>
                <span>{finding.workerName || "Shift worker"}</span>
                <small>{when(finding.createdAt)}</small>
                <small>
                  {!finding.isCurrent
                    ? "Earlier note version · still needs review"
                    : finding.noteStatus === "complete"
                      ? "Worker confirmed"
                      : "Worker draft"}
                </small>
                {finding.managerLevel && (
                  <small>Original AI level: {finding.aiLevel}</small>
                )}
              </div>
              <ArrowUpRight size={18} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !saving) setSelected(null);
        }}
      >
        <DialogContent className={styles.dialog} showCloseButton={!saving}>
          <DialogTitle>Review shift finding</DialogTitle>
          <DialogDescription>
            The AI finding is retained alongside your review decision.
          </DialogDescription>
          {selected && (
            <FindingForm
              key={selected.id}
              finding={selected}
              latest={findings.find((item) => item.id === selected.id)}
              providerId={providerId}
              onBusy={setSaving}
              onAudit={() => {
                onAudit(selected.noteId);
              }}
              onRefresh={onRefresh}
              onSaved={async () => {
                setSelected((current) =>
                  current?.id === selected.id ? null : current,
                );
                setNotice(
                  "Review saved. The original finding and your decision are retained.",
                );
                await onRefresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FindingForm({
  finding,
  latest,
  providerId,
  onAudit,
  onRefresh,
  onSaved,
  onBusy,
}: {
  finding: RiskFinding;
  latest?: RiskFinding;
  providerId?: string;
  onAudit: () => void;
  onRefresh: () => Promise<void>;
  onSaved: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [base, setBase] = useState(finding);
  const [status, setStatus] = useState(finding.reviewStatus);
  const [level, setLevel] = useState(finding.managerLevel ?? "ai");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const changed = Boolean(
    latest && latest.reviewRevision !== base.reviewRevision,
  );
  const reasonRequired =
    status === "closed" ||
    (level !== "ai" && level !== base.managerLevel) ||
    (level === "ai" && base.managerLevel !== null);
  async function save() {
    setBusy(true);
    onBusy(true);
    setError("");
    const body = {
      revision: base.reviewRevision,
      status,
      managerLevel: level === "ai" ? null : level,
      comment: comment.trim(),
    };
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const response = await fetch(
        `/api/management/findings/${encodeURIComponent(base.id)}${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, requestId: request.current.id }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          setConflict(true);
          await onRefresh();
        }
        throw new Error(
          data.error ?? "Your review could not be saved. Please retry.",
        );
      }
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your review could not be saved. Please retry.",
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className={styles.detail}>
      <div>
        <h3>{base.participant}</h3>
        <p>
          {riskTypeLabels[base.type]} · {base.workerName}
        </p>
        <RiskBadge level={base.aiLevel} prefix="AI: " />
        {base.managerLevel && (
          <>
            {" "}
            <RiskBadge level={base.managerLevel} prefix="Manager: " />
          </>
        )}
      </div>
      {!base.isCurrent && (
        <p className={styles.warning}>
          This finding belongs to note version {base.sourceRevision}. A later
          edit has not closed it.
        </p>
      )}
      <section className={styles.summary}>
        <strong>AI summary</strong>
        <p>{base.summary}</p>
        <small>
          {base.noteStatus === "complete"
            ? "Worker confirmed note"
            : "Worker draft"}{" "}
          · version {base.sourceRevision} · {when(base.createdAt)}
        </small>
      </section>
      <section>
        <h4>Supporting evidence</h4>
        {base.evidence.map((item, index) => (
          <blockquote key={`${item.sourceId}:${index}`}>
            {item.quote}
            <small>{item.sourceId}</small>
          </blockquote>
        ))}
        <Button variant="outline" onClick={onAudit} disabled={busy}>
          View note, transcript & audit
        </Button>
      </section>
      <div className={styles.fields}>
        <label>
          Review status
          <select
            disabled={busy}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as RiskFinding["reviewStatus"])
            }
          >
            <option value="open">Awaiting review</option>
            <option value="reviewing">In review</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label>
          Manager priority
          <select
            disabled={busy}
            value={level}
            onChange={(event) =>
              setLevel(event.target.value as RiskLevel | "ai")
            }
          >
            <option value="ai">Use AI level ({base.aiLevel})</option>
            {Object.entries(riskLevelLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {value} · {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Review note {reasonRequired ? "(required)" : "(optional)"}
        <Textarea
          disabled={busy}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={4000}
          placeholder="Record your decision, actions taken, or reason for changing the priority."
        />
      </label>
      {(conflict || changed) && (
        <div className={styles.warning} role="alert">
          <p>
            Another review has been saved. Your draft comment is still here.
          </p>
          <Button
            variant="outline"
            disabled={!latest || busy}
            onClick={() => {
              if (latest) {
                setBase(latest);
                setStatus(latest.reviewStatus);
                setLevel(latest.managerLevel ?? "ai");
                setConflict(false);
                setError("");
                request.current = null;
              }
            }}
          >
            Load latest decision
          </Button>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Button
        disabled={
          busy || conflict || changed || (reasonRequired && !comment.trim())
        }
        onClick={() => void save()}
      >
        {busy ? "Saving review…" : "Save review"}
      </Button>
      <section className={styles.history}>
        <h4>Review history</h4>
        {!base.history.length ? (
          <p>No manager review yet.</p>
        ) : (
          [...base.history].reverse().map((action) => (
            <article key={action.id}>
              <strong>
                {action.actorName} ·{" "}
                {statusLabels[action.status as keyof typeof statusLabels] ??
                  action.status}
              </strong>
              <small>
                {when(action.createdAt)} ·{" "}
                {action.managerLevel
                  ? `Manager level: ${action.managerLevel}`
                  : "AI level retained"}
              </small>
              {action.comment && <p>{action.comment}</p>}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
