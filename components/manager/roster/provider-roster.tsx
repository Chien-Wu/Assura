"use client";
import { Button } from "@/components/ui/button";
import type { Participant } from "@/lib/roster/participant-profiles";
import { displayShiftTime, type ScheduledShift } from "@/lib/roster/shifts";
import { CalendarDays, Plus, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ManagerHeader, {
  type ManagerAccount,
  type ManagerSection,
} from "../manager-header";
import ManagementBoard from "../review/management-board";
import ParticipantEditor from "./participant-editor";
import { request, type Worker } from "./roster-api";
import "./roster.css";
import ShiftEditor from "./shift-editor";
export default function ProviderRoster({
  providerId,
  account,
}: {
  providerId: string;
  account: ManagerAccount;
}) {
  const [section, setSection] = useState<ManagerSection>("shifts");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Participant | "new" | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [preferredParticipantId, setPreferredParticipantId] = useState("");
  const loadVersion = useRef(0);
  const query = `providerId=${encodeURIComponent(providerId)}`;
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const [participantData, workerData, shiftData] = await Promise.all([
        request<{ participants: Participant[] }>(`/api/participants?${query}`),
        request<{ workers: Worker[] }>(`/api/provider-workers?${query}`),
        request<{ shifts: ScheduledShift[] }>(`/api/shifts?${query}`),
      ]);
      if (version !== loadVersion.current) return;
      setParticipants(participantData.participants);
      setWorkers(workerData.workers);
      setShifts(shiftData.shifts);
    } catch (cause) {
      if (version !== loadVersion.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load the provider workspace.",
      );
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <>
      <ManagerHeader
        account={account}
        providerId={providerId}
        section={section}
        onSectionChange={setSection}
      />
      <main className="main-shell manager-shell">
        <div className="provider-roster">
          {section === "review" && (
            <ManagementBoard signedIn providerId={providerId} />
          )}
          {section !== "review" && error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {section !== "review" && notice && (
            <p className="roster-success" role="status">
              {notice}
            </p>
          )}
          {/* Keep inline editors mounted so navigation preserves their drafts. */}
          <section
            hidden={section !== "participants"}
            aria-labelledby="participants-heading"
          >
            <div className="roster-heading">
              <div>
                <h1 id="participants-heading">Participants</h1>
                <p>
                  Set up each participant’s details before assigning a shift.
                </p>
              </div>
              <div className="roster-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || editor !== null}
                  onClick={() => void load()}
                >
                  <RefreshCw size={16} />
                  Refresh
                </Button>
                <Button
                  type="button"
                  disabled={editor !== null}
                  onClick={() => {
                    setNotice("");
                    setEditor("new");
                  }}
                >
                  <Plus size={16} />
                  Add participant
                </Button>
              </div>
            </div>
            {editor && (
              <ParticipantEditor
                key={editor === "new" ? "new" : editor.id}
                participant={editor === "new" ? null : editor}
                query={query}
                onCancel={() => setEditor(null)}
                onSaved={async (saved) => {
                  if (editor === "new") setPreferredParticipantId(saved.id);
                  setEditor(null);
                  setNotice(`${saved.name}’s details have been saved.`);
                  await load();
                }}
              />
            )}
            {loading ? (
              <p className="roster-empty" role="status">
                Loading participants…
              </p>
            ) : !participants.length && !error ? (
              <div className="roster-empty">
                <Users size={28} />
                <h2>Add your first participant</h2>
                <p>
                  Start with their name. You can add care details as they become
                  available.
                </p>
              </div>
            ) : (
              <div className="roster-participant-grid">
                {participants.map((participant) => (
                  <article
                    key={participant.id}
                    className="roster-participant-card"
                  >
                    <div className="roster-card-heading">
                      <span className="roster-avatar" aria-hidden="true">
                        {participant.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <h2>{participant.name}</h2>
                        <p>
                          {participant.ndis
                            ? `Reference ${participant.ndis}`
                            : "No reference recorded"}
                        </p>
                      </div>
                    </div>
                    <p className="roster-setting">
                      {participant.setting || "Care setting not recorded"}
                    </p>
                    <div className="roster-card-footer">
                      <span>
                        {participant.risks.length
                          ? `${participant.risks.length} recorded risk${participant.risks.length === 1 ? "" : "s"}`
                          : "No risks recorded"}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={editor !== null}
                        onClick={() => {
                          setNotice("");
                          setEditor(participant);
                        }}
                      >
                        Edit details
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section
            hidden={section !== "shifts"}
            aria-labelledby="shifts-heading"
          >
            <div className="roster-heading">
              <div>
                <h1 id="shifts-heading">Shifts</h1>
                <p>
                  Assign a participant and worker, then set the expected shift
                  times.
                </p>
              </div>
              <div className="roster-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading || scheduling}
                  onClick={() => void load()}
                >
                  <RefreshCw size={16} />
                  Refresh
                </Button>
                <Button
                  type="button"
                  disabled={
                    loading ||
                    !!error ||
                    scheduling ||
                    !participants.length ||
                    !workers.length
                  }
                  onClick={() => {
                    setNotice("");
                    setScheduling(true);
                  }}
                >
                  <Plus size={16} />
                  Schedule shift
                </Button>
              </div>
            </div>
            {scheduling && (
              <ShiftEditor
                participants={participants}
                workers={workers}
                preferredParticipantId={preferredParticipantId}
                query={query}
                onCancel={() => setScheduling(false)}
                onSaved={async () => {
                  setScheduling(false);
                  setNotice(
                    "Shift scheduled. The assigned worker can now select it to start a note.",
                  );
                  await load();
                }}
              />
            )}
            {!loading &&
              !error &&
              (!participants.length || !workers.length) && (
                <div className="roster-setup">
                  <div>
                    <h2>
                      {!participants.length
                        ? "Set up a participant first"
                        : "Your workers will appear here"}
                    </h2>
                    <p>
                      {!participants.length
                        ? "Add participant details, then schedule their first shift."
                        : "A worker becomes available after signing in, completing their profile and choosing this provider."}
                    </p>
                  </div>
                  {!participants.length && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSection("participants");
                        setEditor("new");
                      }}
                    >
                      Add participant
                    </Button>
                  )}
                </div>
              )}
            {loading ? (
              <p className="roster-empty" role="status">
                Loading shifts…
              </p>
            ) : !shifts.length && !error ? (
              <div className="roster-empty">
                <CalendarDays size={28} />
                <h2>No shifts scheduled</h2>
                <p>
                  Scheduled shifts appear here and in the assigned worker’s
                  workspace.
                </p>
              </div>
            ) : (
              <div className="roster-shift-list">
                {shifts.map((shift) => (
                  <article key={shift.id} className="roster-shift-card">
                    <div className="roster-shift-people">
                      <h2>{shift.participantName}</h2>
                      <p>
                        <Users size={15} aria-hidden="true" />
                        {shift.workerName}
                      </p>
                    </div>
                    <div className="roster-shift-time">
                      <span>Expected shift</span>
                      <strong>
                        {displayShiftTime(shift.expectedStart)} —{" "}
                        {displayShiftTime(shift.expectedEnd)}
                      </strong>
                      <small>{shift.timezone}</small>
                    </div>
                    <span
                      className={`roster-note-status${shift.noteStatus === "complete" ? " roster-note-complete" : shift.noteStatus === "draft" ? " roster-note-draft" : ""}`}
                    >
                      {shift.noteStatus === "complete"
                        ? "Note complete"
                        : shift.noteStatus === "draft"
                          ? "Note in progress"
                          : "Note not started"}
                    </span>
                  </article>
                ))}
              </div>
            )}
            <p className="roster-schedule-caption">
              Expected times are for planning. Workers confirm the actual times
              in their shift note.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
