"use client";
import { Button } from "@/components/ui/button";
import { displayShiftTime, type ScheduledShift } from "@/lib/roster/shifts";
import { ArrowUpRight, CalendarDays, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import "./worker-shifts.css";

export default function WorkerShifts({
  busy,
  onSelect,
}: {
  busy: boolean;
  onSelect: (shift: ScheduledShift) => void;
}) {
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/shifts");
      const data = (await response.json()) as {
        shifts: ScheduledShift[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error ?? "Could not load your shifts.");
      setShifts(data.shifts);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load your shifts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  return (
    <section className="worker-shifts" aria-label="Your assigned shifts">
      <div className="worker-shift-toolbar">
        <h1>Your shifts.</h1>
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading your shifts…</p>
      ) : !error && !shifts.length ? (
        <div className="worker-shift-empty">
          <CalendarDays size={30} />
          <h2>No shifts assigned yet</h2>
          <p>
            Your manager schedules shifts for you. Once a shift is assigned, it
            will appear here.
          </p>
        </div>
      ) : (
        <div className="worker-shift-list">
          {shifts.map((shift) => (
            <article className="worker-shift-card" key={shift.id}>
              <div>
                <h2>{shift.participantName}</h2>
                <p>
                  <span className="sr-only">Scheduled time in Melbourne: </span>
                  {displayShiftTime(shift.expectedStart)} —{" "}
                  {displayShiftTime(shift.expectedEnd)}
                </p>
              </div>
              <span
                className={`status-badge ${shift.noteStatus === "complete" ? "complete" : ""}`}
              >
                {shift.noteStatus === "complete"
                  ? "Complete"
                  : shift.noteStatus === "draft"
                    ? "Draft"
                    : "Not started"}
              </span>
              <Button
                disabled={busy || loading}
                variant={shift.noteId ? "outline" : "default"}
                onClick={() => onSelect(shift)}
              >
                {shift.noteStatus === "complete"
                  ? "View note"
                  : shift.noteId
                    ? "Continue note"
                    : "Write note"}
                <ArrowUpRight size={16} />
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
