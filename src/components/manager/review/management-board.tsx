"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { riskTypeLabels } from "@/lib/assessment/result";
import {
  matchesShiftRisk,
  type RiskTypeFilter,
  type SeriousnessFilter,
} from "@/lib/assessment/shift-risk";
import { displayShiftTime } from "@/lib/roster/shifts";
import { matchesShiftDate } from "@/lib/roster/shift-date-filter";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AuditDialog from "./audit-dialog";
import FindingReview from "./finding-review";
import ReviewForm from "./incident-review";
import ShiftRiskFilters, { ShiftRiskStatus } from "./shift-risk-filters";
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
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");
  const [riskType, setRiskType] = useState<RiskTypeFilter>("all");
  const [seriousness, setSeriousness] = useState<SeriousnessFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
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
          `/api/management${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ""}`,
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load.");
    } finally {
      inflight.current = false;
    }
  }, [signedIn, providerId]);
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
  const shiftRisks = board?.shiftRisks ?? [];
  const riskByNote = new Map(shiftRisks.map((risk) => [risk.noteId, risk]));
  const datedNotes =
    board?.notes.filter((note) =>
      matchesShiftDate(
        note.fields.shiftStart || note.expectedStart,
        fromDate,
        toDate,
      ),
    ) ?? [];
  const datedNoteIds = new Set(datedNotes.map((note) => note.id));
  const visibleNotes = datedNotes.filter((note) =>
    matchesShiftRisk(riskByNote.get(note.id), riskType, seriousness),
  );
  const visibleNoteIds = new Set(visibleNotes.map((note) => note.id));
  const legacyAssessments =
    board?.assessments?.filter(
      (item) =>
        visibleNoteIds.has(item.noteId) &&
        item.schemaVersion === 1 &&
        item.result?.concerns?.length,
    ) ?? [];
  const resetFilters = () => {
    setRiskType("all");
    setSeriousness("all");
    setFromDate("");
    setToDate("");
  };
  const filtered =
    board?.incidents.filter(
      (item) =>
        (!(fromDate || toDate) || datedNoteIds.has(item.noteId)) &&
        matchesShiftRisk(riskByNote.get(item.noteId), riskType, seriousness) &&
        (filter === "all" ||
          (filter === "open"
            ? item.assessment === "Needs review"
            : filter === "urgent"
              ? item.severity === "urgent"
              : item.code === "RISK_CONTENT_REMOVED" ||
                item.code === "CONTRADICTORY_NEGATIVE")),
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
      <div className="board-metrics" aria-label="Shifts by seriousness">
        {(
          [
            { value: "P4", label: "P4", description: "Critical" },
            {
              value: "P2-3",
              label: "P2–3",
              description: "Internal review / urgent",
            },
            { value: "P0-1", label: "P0–1", description: "Routine / monitor" },
          ] as const
        ).map((group) => (
          <button
            key={group.value}
            type="button"
            data-priority={group.value}
            aria-pressed={seriousness === group.value}
            disabled={!board}
            onClick={() => {
              setSeriousness(seriousness === group.value ? "all" : group.value);
            }}
          >
            <span className="board-metric-label">{group.label}</span>
            <ArrowUpRight size={20} aria-hidden="true" />
            <strong>
              {board
                ? shiftRisks.filter(
                    (risk) =>
                      datedNoteIds.has(risk.noteId) &&
                      matchesShiftRisk(risk, riskType, group.value),
                  ).length
                : "—"}
            </strong>
            <span>{group.description}</span>
          </button>
        ))}
      </div>
      <p className="section-help">
        Shifts grouped by their current overall seriousness
        {fromDate || toDate || riskType !== "all"
          ? " for the selected risk and dates"
          : ""}
        .{" "}
        {board
          ? `${shiftRisks.filter((risk) => datedNoteIds.has(risk.noteId) && matchesShiftRisk(risk, riskType, "unassessed")).length} not assessed.`
          : "Loading risk checks…"}
      </p>
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
      <section className="board-shifts" aria-labelledby="board-shifts-heading">
        <div className="board-toolbar">
          <h3 id="board-shifts-heading">All shifts</h3>
          <ShiftRiskFilters
            riskType={riskType}
            seriousness={seriousness}
            onRiskTypeChange={setRiskType}
            onSeriousnessChange={setSeriousness}
            onReset={resetFilters}
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
            disabled={!board}
          />
        </div>
        <p className="section-help" role="status">
          {board
            ? `${visibleNotes.length} of ${board.notes.length} shifts shown`
            : "Loading shifts…"}
          . Dates use the shift start, or scheduled start when not recorded.
        </p>
        {board && !visibleNotes.length && (
          <p className="board-empty">
            {board.notes.length
              ? "No shifts match these filters. Change or clear the filters to see more shifts."
              : "No shift notes have been started yet."}
          </p>
        )}
        {!!visibleNotes.length && (
          <div className="board-shift-list">
            {visibleNotes.map((note) => {
              const risk = riskByNote.get(note.id);
              return (
                <button
                  type="button"
                  className="board-shift-row"
                  key={note.id}
                  disabled={busy}
                  onClick={() => void showAudit(note.id)}
                >
                  <div className="board-shift-priority">
                    <ShiftRiskStatus risk={risk} />
                    <small>
                      {note.status === "complete"
                        ? "Worker confirmed"
                        : "Worker draft"}
                    </small>
                  </div>
                  <div className="board-shift-subject">
                    <strong>
                      {note.fields.participant || "Unnamed participant"}
                    </strong>
                    <span>
                      {risk?.riskTypes.length
                        ? risk.riskTypes
                            .map((type) => riskTypeLabels[type])
                            .join(" · ")
                        : risk?.level === "P0"
                          ? "No risk detected"
                          : "Risk check unfinished"}
                    </span>
                    {risk?.summary && <p>{risk.summary}</p>}
                  </div>
                  <div className="board-shift-context">
                    <span>{note.workerName || "Shift worker"}</span>
                    <small>
                      {note.fields.shiftStart
                        ? displayShiftTime(note.fields.shiftStart)
                        : note.expectedStart
                          ? `Scheduled ${displayShiftTime(note.expectedStart)}`
                          : "Shift time not recorded"}
                    </small>
                    <small>View note & evidence</small>
                  </div>
                  <ArrowUpRight size={18} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
      </section>
      <FindingReview
        findings={board?.findings ?? []}
        riskType={riskType}
        noteIds={visibleNoteIds}
        loading={!board}
        onRefresh={load}
        onAudit={(id) => void showAudit(id)}
        providerId={providerId}
      />
      {!!legacyAssessments.length && (
        <details className="reporting-guidance">
          <summary>Earlier AI assessments · retained evidence</summary>
          <p>
            These findings came from the earlier assessment workflow. Their
            original results and conversation remain in the audit.
          </p>
          {legacyAssessments.map((item) => (
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
