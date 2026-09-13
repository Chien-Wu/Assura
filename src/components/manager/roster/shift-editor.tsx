"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Participant } from "@/lib/roster/participant-profiles";
import { X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { request, type Worker } from "./roster-api";
export default function ShiftEditor({
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
