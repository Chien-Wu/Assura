"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Clock, FileText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AuditDialog from "./audit-dialog";
import FindingReview from "./finding-review";
import ReviewForm from "./incident-review";
import {
  api,
  interval,
  when,
  type Audit,
  type Board,
  type Incident,
} from "./management-data";
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
      <AuditDialog audit={audit} setAudit={setAudit} />
    </section>
  );
}
