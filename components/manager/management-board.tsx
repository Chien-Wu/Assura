"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Clock,
  FileText,
  RefreshCw,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { noteText, type ShiftNote } from "@/lib/shift-form";
import InterviewReferences from "../worker/interview-references";
import type { AssessmentOutput } from "@/lib/assessment";
import { riskTypeLabels, type RiskAssessment } from "@/lib/risk-assessment";
import FindingReview, { RiskBadge, type RiskFinding } from "./finding-review";
type Incident = {
  id: string;
  noteId: string;
  code: string;
  category: string;
  reason: string;
  quote: string;
  severity: string;
  capturedAt: string;
  inboxAt: string | null;
  providerBecameAwareAt: string | null;
  eventAt: string | null;
  commissionNotifiedAt: string | null;
  eventToAwarenessMinutes: number | null;
  awarenessToCommissionMinutes: number | null;
  assessment: string;
  history: {
    created_at: string;
    actor: string;
    details: Record<string, string>;
  }[];
};
type Board = {
  notes: ShiftNote[];
  findings: RiskFinding[];
  assessments?: {
    id: string;
    noteId: string;
    participant: string;
    schemaVersion: number;
    sourceRevision: number;
    status: string;
    result: AssessmentOutput | null;
  }[];
  incidents: Incident[];
  monthly: {
    participantId: string;
    participant: string;
    item: string;
    description: string;
    recordedUses: number;
  }[];
  reportingGuidance: string;
  delivery: string;
  audience: string;
};
type Audit = {
  note: ShiftNote;
  assessment: RiskAssessment | null;
  assessmentAudit?: {
    id: string;
    sourceRevision: number;
    schemaVersion: number;
    result: AssessmentOutput | null;
    messages: { id: string; role: string; text: string; createdAt: string }[];
  }[];
  findings: RiskFinding[];
  transcript: {
    session_id: string;
    sequence: number;
    role: string;
    content: string;
    received_at: string;
  }[];
  changes: {
    revision: number;
    field: string;
    before_value: string;
    after_value: string;
    actor: string;
    source: string;
    created_at: string;
  }[];
  draftV0: ShiftNote | null;
  retention: { minimumUntil: string; extendedRetention: string };
};
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not established";
const interval = (minutes: number | null) =>
  minutes === null
    ? "Time not established"
    : minutes < 0
      ? "Check reported times"
      : minutes < 60
        ? `${Math.round(minutes)} min`
        : `${(minutes / 60).toFixed(1)} h`;
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? "The board could not load.");
  return data;
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
export default function ManagementBoard({
  signedIn,
  onOpenNote,
  providerId,
}: {
  signedIn: boolean;
  onOpenNote?: (id: string) => void;
  providerId?: string;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");
  const [selected, setSelected] = useState<Incident | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const load = useCallback(async () => {
    if (!signedIn || inflight.current) return;
    inflight.current = true;
    try {
      setBoard(
        await api<Board>(
          `/api/management?month=${month}${providerId ? `&providerId=${encodeURIComponent(providerId)}` : ""}`,
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load.");
    } finally {
      inflight.current = false;
    }
  }, [signedIn, month, providerId]);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  async function showAudit(id: string) {
    setBusy(true);
    try {
      setAudit(await api<Audit>(`/api/notes/${id}/audit`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!signedIn)
    return (
      <div className="info-banner">Sign in to view the management board.</div>
    );
  const open =
    board?.incidents.filter((item) => item.assessment === "Needs review") ?? [];
  const filtered =
    board?.incidents.filter(
      (item) =>
        filter === "all" ||
        (filter === "open"
          ? item.assessment === "Needs review"
          : filter === "urgent"
            ? item.severity === "urgent"
            : item.code === "RISK_CONTENT_REMOVED" ||
              item.code === "CONTRADICTORY_NEGATIVE"),
    ) ?? [];
  return (
    <section className="management-board">
      <div className="board-intro">
        <div>
          <h2>Management board</h2>
          <p>{board?.audience ?? "Loading workspace records…"}</p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>
      <div className="board-metrics">
        <div>
          <AlertCircle size={20} />
          <strong>
            {open.filter((i) => i.severity === "urgent").length +
              (board?.findings?.filter(
                (item) =>
                  item.reviewStatus !== "closed" &&
                  (item.managerLevel ?? item.aiLevel) >= "P3",
              ).length ?? 0)}
          </strong>
          <span>Urgent items awaiting review</span>
        </div>
        <div>
          <Clock size={20} />
          <strong>
            {board?.notes.filter((n) => n.status === "draft").length ?? 0}
          </strong>
          <span>Draft notes · latest 100</span>
        </div>
        <div>
          <FileText size={20} />
          <strong>
            {board?.incidents.filter(
              (i) =>
                i.code === "RISK_CONTENT_REMOVED" ||
                i.code === "CONTRADICTORY_NEGATIVE",
            ).length ?? 0}
          </strong>
          <span>Edits needing evidence review</span>
        </div>
      </div>
      <div className="info-banner">
        <p>
          {board?.delivery ?? "In-app demo inbox only."} Captured time, inbox
          time and provider awareness are separate. Record any earlier
          awareness; adding a row here does not establish a statutory deadline.
        </p>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <FindingReview
        findings={board?.findings ?? []}
        loading={!board}
        onRefresh={load}
        onAudit={(id) => void showAudit(id)}
        providerId={providerId}
      />
      {!!board?.assessments?.some(
        (item) => item.schemaVersion === 1 && item.result?.concerns?.length,
      ) && (
        <details className="reporting-guidance">
          <summary>Earlier AI assessments · retained evidence</summary>
          <p>
            These findings came from the earlier assessment workflow. Their
            original results and conversation remain in the audit.
          </p>
          {board.assessments
            .filter(
              (item) =>
                item.schemaVersion === 1 && item.result?.concerns?.length,
            )
            .map((item) => (
              <article className="incident-card" key={item.id}>
                <h4>
                  {item.participant} · note version {item.sourceRevision}
                </h4>
                <p>{item.result?.summary}</p>
                {item.result?.concerns.map((concern) => (
                  <p key={concern.id}>
                    <strong>
                      {concern.priority} · {concern.title}
                    </strong>
                    <br />
                    {concern.whatHappened}
                  </p>
                ))}
                <Button
                  variant="outline"
                  onClick={() => void showAudit(item.noteId)}
                >
                  Original assessment & evidence
                </Button>
              </article>
            ))}
        </details>
      )}
      <div className="board-toolbar">
        <h3>Captured evidence requiring review</h3>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Awaiting review</SelectItem>
            <SelectItem value="urgent">Urgent candidates</SelectItem>
            <SelectItem value="edits">Risk edits and contradictions</SelectItem>
            <SelectItem value="all">All retained items</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!filtered.length && (
        <p className="board-empty">
          {board
            ? "No items in this view. Captured candidates appear here before note confirmation."
            : "Loading review items…"}
        </p>
      )}
      <div className="incident-grid">
        {filtered.map((item) => {
          const note = board?.notes.find((n) => n.id === item.noteId);
          return (
            <article
              className={`incident-card ${item.severity === "urgent" ? "urgent" : ""}`}
              key={item.id}
            >
              <div className="incident-heading">
                <span className="status-badge review">{item.assessment}</span>
                <span>
                  {item.severity === "urgent"
                    ? "Urgent assessment"
                    : "Evidence review"}
                </span>
              </div>
              <h4>
                {note?.fields.participant || "Participant in linked record"}
              </h4>
              <p className="incident-type">{item.code.replaceAll("_", " ")}</p>
              <p>{item.reason}</p>
              <blockquote>{item.quote}</blockquote>
              <dl className="incident-timeline">
                <div>
                  <dt>Event</dt>
                  <dd>{when(item.eventAt)}</dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>{when(item.capturedAt)}</dd>
                </div>
                <div>
                  <dt>In-app inbox</dt>
                  <dd>{when(item.inboxAt)}</dd>
                </div>
                <div>
                  <dt>Reported provider awareness</dt>
                  <dd>{when(item.providerBecameAwareAt)}</dd>
                </div>
                <div>
                  <dt>Event → awareness</dt>
                  <dd>{interval(item.eventToAwarenessMinutes)}</dd>
                </div>
                <div>
                  <dt>Awareness → Commission notification</dt>
                  <dd>{interval(item.awarenessToCommissionMinutes)}</dd>
                </div>
              </dl>
              <div className="incident-actions">
                <Button onClick={() => setSelected(item)}>Record review</Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void showAudit(item.noteId)}
                >
                  Transcript & audit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    onOpenNote
                      ? onOpenNote(item.noteId)
                      : void showAudit(item.noteId)
                  }
                >
                  Open note
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      <details className="reporting-guidance">
        <summary>Reporting guidance and unresolved facts</summary>
        <p>{board?.reportingGuidance}</p>
        <p>
          Plan inclusion, limits and state authorisation are separate checks. A
          monthly return does not replace incident reporting. No Commission
          report is submitted by this demo.
        </p>
        <a
          href="https://www.ndiscommission.gov.au/rules-and-standards/reportable-incidents-and-incident-management/reportable-incidents"
          target="_blank"
          rel="noreferrer"
        >
          NDIS Commission reporting guidance
        </a>
      </details>
      <div className="board-toolbar">
        <h3>Monthly restrictive-practice returns</h3>
        <label>
          Reporting month
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>
      <p className="section-help">
        Prepare monthly reports within five business days after month end;
        short-term approvals may require fortnightly reporting. No use recorded
        here is a prompt to verify a nil return, not proof that no use occurred.
      </p>
      <div className="monthly-grid">
        {board?.monthly.map((item) => (
          <article key={item.participantId + item.item}>
            <h4>
              {item.participant} · {item.item}
            </h4>
            <p>{item.description}</p>
            <strong>
              {item.recordedUses} recorded shift{" "}
              {item.recordedUses === 1 ? "entry" : "entries"}
            </strong>
            <p>
              {item.recordedUses
                ? "Include actual uses in the monthly return; check any separate incident obligations."
                : "No use recorded here — verify whether a nil return is appropriate."}
            </p>
          </article>
        ))}
      </div>
      <div className="board-toolbar">
        <h3>Record evidence</h3>
        <Select value="" onValueChange={(id) => void showAudit(id)}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a note to inspect" />
          </SelectTrigger>
          <SelectContent>
            {board?.notes.map((note) => (
              <SelectItem key={note.id} value={note.id}>
                {note.fields.participant || "Unnamed draft"} ·{" "}
                {note.fields.shiftStart || "Time not added"} · {note.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
      >
        <DialogContent className="management-dialog">
          <DialogTitle>Supervisor review</DialogTitle>
          <DialogDescription>
            Add facts and an assessment. Every entry is retained; original flags
            and worker statements remain available.
          </DialogDescription>
          {selected && (
            <ReviewForm
              item={selected}
              onSave={async (body) => {
                await api(
                  `/api/management/${encodeURIComponent(selected.id)}${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ""}`,
                  body,
                );
                setSelected(null);
                await load();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(audit)}
        onOpenChange={(value) => {
          if (!value) setAudit(null);
        }}
      >
        <DialogContent className="management-dialog audit-dialog">
          <DialogTitle>Original evidence & review history</DialogTitle>
          <DialogDescription>
            The original conversation protects what the worker disclosed. Note
            edits cannot change it.
          </DialogDescription>
          {audit && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    audit,
                    `shift-${audit.note.id}-incident-evidence.json`,
                  )
                }
              >
                <Download size={16} />
                Download evidence bundle
              </Button>
              <div className="audit-scroll">
                <p>
                  Retention minimum: {when(audit.retention.minimumUntil)}.{" "}
                  {audit.retention.extendedRetention}
                </p>
                <h3>Original generated note · draft_v0</h3>
                <pre>
                  {audit.draftV0
                    ? noteText(audit.draftV0)
                    : "Not prepared for review yet. The captured transcript is already retained."}
                </pre>
                <InterviewReferences note={audit.note} />
                <h3>Current saved note</h3>
                <pre>{noteText(audit.note)}</pre>
                {audit.assessment && (
                  <>
                    <h3>Risk check · {audit.assessment.status}</h3>
                    <p>
                      {audit.assessment.result?.summary ??
                        "Risk check not finished."}
                    </p>
                    {audit.assessment.result?.risks.map((risk) => (
                      <article key={risk.type}>
                        <strong>{riskTypeLabels[risk.type]}</strong>{" "}
                        <RiskBadge level={risk.level} />
                        {risk.evidence.map((evidence, index) => (
                          <blockquote key={index}>
                            {evidence.quote}
                            <small>Source: {evidence.sourceId}</small>
                          </blockquote>
                        ))}
                      </article>
                    ))}
                  </>
                )}
                {!!audit.findings?.length && (
                  <>
                    <h3>Manager finding reviews · all note versions</h3>
                    {audit.findings.map((finding) => (
                      <article key={finding.id}>
                        <strong>
                          {riskTypeLabels[finding.type]} · original AI{" "}
                          {finding.aiLevel} · note version{" "}
                          {finding.sourceRevision}
                        </strong>
                        <p>
                          {finding.reviewStatus}
                          {finding.managerLevel
                            ? ` · manager level ${finding.managerLevel}`
                            : " · AI level retained"}
                        </p>
                        {finding.history.map((action) => (
                          <p key={action.id}>
                            {when(action.createdAt)} · {action.actorName} ·{" "}
                            {action.status}
                            {action.managerLevel
                              ? ` · ${action.managerLevel}`
                              : ""}
                            <br />
                            {action.comment}
                          </p>
                        ))}
                      </article>
                    ))}
                  </>
                )}
                {audit.assessmentAudit
                  ?.filter((item) => item.schemaVersion === 1)
                  .map((item) => (
                    <details key={item.id}>
                      <summary>
                        Earlier AI assessment and conversation · note version{" "}
                        {item.sourceRevision}
                      </summary>
                      <p>{item.result?.summary}</p>
                      {item.result?.concerns?.map((concern) => (
                        <article key={concern.id}>
                          <strong>
                            {concern.priority} · {concern.title}
                          </strong>
                          <p>{concern.whatHappened}</p>
                          {concern.evidence.map((source, index) => (
                            <blockquote key={index}>
                              {source.quote}
                              <small>{source.sourceId}</small>
                            </blockquote>
                          ))}
                        </article>
                      ))}
                      {item.messages.map((message) => (
                        <article key={message.id}>
                          <small>
                            {message.role === "user"
                              ? "Worker"
                              : "Earlier AI assistant"}{" "}
                            · {when(message.createdAt)}
                          </small>
                          <p>{message.text}</p>
                        </article>
                      ))}
                    </details>
                  ))}
                <h3>Append-only transcript</h3>
                {audit.transcript.length ? (
                  audit.transcript.map((turn) => (
                    <article key={turn.session_id + turn.sequence}>
                      <small>
                        {when(turn.received_at)} ·{" "}
                        {turn.role === "user"
                          ? "Worker"
                          : turn.role === "agent"
                            ? "Assistant"
                            : "Interruption"}
                      </small>
                      <p>{turn.content}</p>
                    </article>
                  ))
                ) : (
                  <p>
                    No immutable session events exist for this record. It may
                    predate this capture feature.
                  </p>
                )}
                <h3>Every saved change</h3>
                {audit.changes.map((change, index) => (
                  <article key={index}>
                    <strong>
                      {change.field.replaceAll("_", " ")} · revision{" "}
                      {change.revision}
                    </strong>
                    <small>
                      {when(change.created_at)} · {change.source} · actor{" "}
                      {change.actor}
                    </small>
                    <div className="audit-diff">
                      <pre>
                        {JSON.parse(change.before_value) ?? "Not recorded"}
                      </pre>
                      <span>→</span>
                      <pre>
                        {JSON.parse(change.after_value) ?? "Not recorded"}
                      </pre>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function ReviewForm({
  item,
  onSave,
}: {
  item: Incident;
  onSave: (body: Record<string, string>) => Promise<void>;
}) {
  const [details, setDetails] = useState({
    eventAt: "",
    providerBecameAwareAt: "",
    commissionNotifiedAt: "",
    awarenessSource: "",
    comment: "",
    assessment: "Needs review",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...details,
        ...Object.fromEntries(
          ["eventAt", "providerBecameAwareAt", "commissionNotifiedAt"].map(
            (key) => [
              key,
              details[key as keyof typeof details]
                ? new Date(details[key as keyof typeof details]).toISOString()
                : "",
            ],
          ),
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="review-form">
      <p className="section-help">
        Enter observed or evidenced times, using your device’s local timezone.
        Leave unknown times empty. Earlier provider awareness is preserved.
      </p>
      {(
        [
          ["eventAt", "Event time"],
          ["providerBecameAwareAt", "Provider first became aware"],
          [
            "commissionNotifiedAt",
            "Commission notified externally — if already done",
          ],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <Input
            type="datetime-local"
            value={details[key]}
            onChange={(e) => setDetails({ ...details, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Who became aware, and how is the time known?
        <Input
          value={details.awarenessSource}
          onChange={(e) =>
            setDetails({ ...details, awarenessSource: e.target.value })
          }
        />
      </label>
      <label>
        Supervisor assessment
        <Select
          value={details.assessment}
          onValueChange={(assessment) => setDetails({ ...details, assessment })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              "Needs review",
              "Reportable — supervisor assessed",
              "Not reportable — supervisor assessed",
            ].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label>
        Facts, disagreement or reason for assessment
        <Textarea
          value={details.comment}
          onChange={(e) => setDetails({ ...details, comment: e.target.value })}
        />
      </label>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Add review entry"}
      </Button>
      <details>
        <summary>{item.history.length} previous review entries</summary>
        {item.history.map((entry, index) => (
          <p key={index}>
            {when(entry.created_at)} ·{" "}
            {entry.details.comment ||
              entry.details.assessment ||
              entry.details.awarenessSource}
          </p>
        ))}
      </details>
    </div>
  );
}
