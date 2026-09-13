"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CalendarDays, Plus, RefreshCw, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Participant, PlanItem } from "@/lib/participants";
import { displayShiftTime, type ScheduledShift } from "@/lib/shifts";
import ManagementBoard from "./management-board";
import ManagerHeader, {
  type ManagerAccount,
  type ManagerSection,
} from "./manager-header";
import "./roster.css";

type Worker = { userId: string; fullName: string };
type Profile = Omit<Participant, "id">;

const blankProfile = (): Profile => ({
  name: "",
  ndis: "",
  dateOfBirth: null,
  setting: "",
  conditions: [],
  risks: [],
  communication: "",
  mealtimePlan: "",
  seizureProtocol: "",
  behaviourPlan: false,
  medications: [],
  goals: [],
  plan: [],
});

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

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

function ShiftEditor({
  participants,
  workers,
  preferredParticipantId,
  query,
  onCancel,
  onSaved,
}: {
  participants: Participant[];
  workers: Worker[];
  preferredParticipantId: string;
  query: string;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [participantId, setParticipantId] = useState(
    participants.some(
      (participant) => participant.id === preferredParticipantId,
    )
      ? preferredParticipantId
      : "",
  );
  const [workerId, setWorkerId] = useState("");
  const [expectedStart, setExpectedStart] = useState("");
  const [expectedEnd, setExpectedEnd] = useState("");
  const timezone = "Australia/Melbourne";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    if (expectedEnd <= expectedStart) {
      setError("Expected end must be after expected start.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await request(`/api/shifts?${query}`, "POST", {
        participantId,
        workerId,
        expectedStart,
        expectedEnd,
        timezone,
      });
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to schedule the shift.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      className="roster-form"
      onSubmit={(event) => void submit(event)}
      aria-labelledby="shift-editor-heading"
    >
      <div className="roster-form-heading">
        <div>
          <h2 id="shift-editor-heading">Schedule a shift</h2>
          <p>
            The assigned worker will select this shift before starting their
            note.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close shift form"
          disabled={saving}
          onClick={onCancel}
        >
          <X size={18} />
        </Button>
      </div>
      <fieldset className="roster-fields" disabled={saving}>
        <label>
          Participant
          <select
            required
            className="roster-select"
            value={participantId}
            onChange={(event) => setParticipantId(event.target.value)}
            autoFocus
          >
            <option value="">Select participant</option>
            {participants.map((participant) => (
              <option key={participant.id} value={participant.id}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Worker
          <select
            required
            className="roster-select"
            value={workerId}
            onChange={(event) => setWorkerId(event.target.value)}
          >
            <option value="">Select worker</option>
            {workers.map((worker) => (
              <option key={worker.userId} value={worker.userId}>
                {worker.fullName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expected start
          <Input
            required
            type="datetime-local"
            value={expectedStart}
            onChange={(event) => setExpectedStart(event.target.value)}
          />
        </label>
        <label>
          Expected end
          <Input
            required
            type="datetime-local"
            value={expectedEnd}
            min={expectedStart || undefined}
            onChange={(event) => setExpectedEnd(event.target.value)}
          />
        </label>
        <p className="roster-field-help roster-field-wide">
          Both expected times use {timezone}.
        </p>
      </fieldset>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="roster-form-footer">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Scheduling…" : "Schedule shift"}
        </Button>
      </div>
    </form>
  );
}

function ParticipantEditor({
  participant,
  query,
  onCancel,
  onSaved,
}: {
  participant: Participant | null;
  query: string;
  onCancel: () => void;
  onSaved: (participant: Participant) => Promise<void>;
}) {
  const [profile, setProfile] = useState<Profile>(() => {
    if (!participant) return blankProfile();
    const copy = { ...participant };
    Reflect.deleteProperty(copy, "id");
    return copy;
  });
  const [conditions, setConditions] = useState(
    participant?.conditions.join("\n") ?? "",
  );
  const [risks, setRisks] = useState(participant?.risks.join("\n") ?? "");
  const [goals, setGoals] = useState(participant?.goals.join("\n") ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((previous) => ({ ...previous, [key]: value }));
  const updateMedication = (
    index: number,
    patch: Partial<Profile["medications"][number]>,
  ) =>
    update(
      "medications",
      profile.medications.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  const updatePlan = (index: number, patch: Partial<PlanItem>) =>
    update(
      "plan",
      profile.plan.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const lines = (value: string) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    try {
      const saved = await request<{ participant: Participant }>(
        `/api/participants${participant ? `/${encodeURIComponent(participant.id)}` : ""}?${query}`,
        participant ? "PATCH" : "POST",
        {
          profile: {
            ...profile,
            name: profile.name.trim(),
            conditions: lines(conditions),
            risks: lines(risks),
            goals: lines(goals),
          },
        },
      );
      await onSaved(saved.participant);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save participant details.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      className="roster-form"
      onSubmit={(event) => void submit(event)}
      aria-labelledby="participant-editor-heading"
    >
      <div className="roster-form-heading">
        <div>
          <h2 id="participant-editor-heading">
            {participant ? "Edit participant" : "New participant"}
          </h2>
          <p>Enter recorded care information. Only the name is required.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close participant form"
          disabled={saving}
          onClick={onCancel}
        >
          <X size={18} />
        </Button>
      </div>
      <fieldset disabled={saving}>
        <div className="roster-fields">
          <label>
            Full name <span aria-hidden="true">*</span>
            <Input
              required
              maxLength={120}
              value={profile.name}
              onChange={(event) => update("name", event.target.value)}
              autoFocus
            />
          </label>
          <label>
            Date of birth
            <Input
              type="date"
              value={profile.dateOfBirth ?? ""}
              onChange={(event) =>
                update("dateOfBirth", event.target.value || null)
              }
            />
          </label>
          <label>
            NDIS / participant reference
            <Input
              maxLength={80}
              value={profile.ndis}
              onChange={(event) => update("ndis", event.target.value)}
            />
          </label>
          <label>
            Care setting
            <Input
              value={profile.setting}
              onChange={(event) => update("setting", event.target.value)}
            />
          </label>
          <label className="roster-field-wide">
            Communication preferences
            <Textarea
              value={profile.communication}
              onChange={(event) => update("communication", event.target.value)}
              rows={2}
            />
          </label>
          <label>
            Conditions<span className="roster-field-help">One per line</span>
            <Textarea
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              rows={3}
            />
          </label>
          <label>
            Known risks<span className="roster-field-help">One per line</span>
            <Textarea
              value={risks}
              onChange={(event) => setRisks(event.target.value)}
              rows={3}
            />
          </label>
          <label>
            Recorded mealtime plan
            <Textarea
              value={profile.mealtimePlan}
              onChange={(event) => update("mealtimePlan", event.target.value)}
              rows={3}
            />
          </label>
          <label>
            Recorded seizure protocol
            <Textarea
              value={profile.seizureProtocol ?? ""}
              onChange={(event) =>
                update("seizureProtocol", event.target.value)
              }
              rows={3}
            />
          </label>
          <label className="roster-field-wide">
            Goals<span className="roster-field-help">One per line</span>
            <Textarea
              value={goals}
              onChange={(event) => setGoals(event.target.value)}
              rows={3}
            />
          </label>
        </div>
        <details className="roster-details">
          <summary>Medications ({profile.medications.length})</summary>
          <p className="roster-field-help">
            Copy details from the participant’s recorded plan.
          </p>
          {profile.medications.map((medication, index) => (
            <div className="roster-detail-row" key={index}>
              <div className="roster-fields">
                <label>
                  Medication name
                  <Input
                    required
                    value={medication.name}
                    onChange={(event) =>
                      updateMedication(index, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Recorded instructions
                  <Input
                    value={medication.description}
                    onChange={(event) =>
                      updateMedication(index, {
                        description: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="roster-row-actions">
                <label className="roster-checkbox">
                  <input
                    type="checkbox"
                    checked={medication.routine}
                    onChange={(event) =>
                      updateMedication(index, { routine: event.target.checked })
                    }
                  />
                  Routine prescribed medication
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update(
                      "medications",
                      profile.medications.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove medication {index + 1}
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update("medications", [
                ...profile.medications,
                { name: "", description: "", routine: false },
              ])
            }
          >
            <Plus size={15} />
            Add medication
          </Button>
        </details>
        <details className="roster-details">
          <summary>
            Behaviour support and restrictive practices ({profile.plan.length})
          </summary>
          <label className="roster-checkbox">
            <input
              type="checkbox"
              checked={profile.behaviourPlan}
              onChange={(event) =>
                update("behaviourPlan", event.target.checked)
              }
            />
            Behaviour support plan recorded
          </label>
          {profile.plan.map((item, index) => (
            <div className="roster-detail-row" key={index}>
              <div className="roster-fields">
                <label>
                  Plan item reference
                  <Input
                    required
                    value={item.id}
                    onChange={(event) =>
                      updatePlan(index, { id: event.target.value })
                    }
                  />
                </label>
                <label>
                  Category
                  <select
                    className="roster-select"
                    value={item.category}
                    onChange={(event) =>
                      updatePlan(index, { category: event.target.value })
                    }
                  >
                    <option value="">Select category</option>
                    <option value="chemical">Chemical</option>
                    <option value="environmental">Environmental</option>
                    <option value="mechanical">Mechanical</option>
                    <option value="physical">Physical</option>
                    <option value="seclusion">Seclusion</option>
                    {item.category &&
                      ![
                        "chemical",
                        "environmental",
                        "mechanical",
                        "physical",
                        "seclusion",
                      ].includes(item.category) && (
                        <option value={item.category}>{item.category}</option>
                      )}
                  </select>
                </label>
                <label>
                  Description
                  <Input
                    required
                    value={item.description}
                    onChange={(event) =>
                      updatePlan(index, { description: event.target.value })
                    }
                  />
                </label>
                <label>
                  Recorded behaviour
                  <Input
                    value={item.behaviour}
                    onChange={(event) =>
                      updatePlan(index, { behaviour: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="roster-fields roster-limit-fields">
                <label>
                  Maximum minutes
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.maxMinutes ?? ""}
                    onChange={(event) =>
                      updatePlan(index, {
                        maxMinutes:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Maximum dose (mg)
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.maxDoseMg ?? ""}
                    onChange={(event) =>
                      updatePlan(index, {
                        maxDoseMg:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Maximum uses / 24 h
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={item.maxUses24h ?? ""}
                    onChange={(event) =>
                      updatePlan(index, {
                        maxUses24h:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <div className="roster-row-actions">
                <label className="roster-checkbox">
                  <input
                    type="checkbox"
                    checked={item.authorised}
                    onChange={(event) =>
                      updatePlan(index, { authorised: event.target.checked })
                    }
                  />
                  Authorisation recorded in the plan
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update(
                      "plan",
                      profile.plan.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove plan item {index + 1}
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update("plan", [
                ...profile.plan,
                {
                  id: `RP-${crypto.randomUUID().slice(0, 8)}`,
                  category: "",
                  description: "",
                  behaviour: "",
                  authorised: false,
                },
              ])
            }
          >
            <Plus size={15} />
            Add plan item
          </Button>
        </details>
      </fieldset>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="roster-form-footer">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save participant"}
        </Button>
      </div>
    </form>
  );
}
