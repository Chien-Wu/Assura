"use client";
import type { AssessmentOutput } from "@/lib/assessment/legacy-types";
import { type RiskAssessment } from "@/lib/assessment/result";
import { type ShiftRiskSummary } from "@/lib/assessment/shift-risk";
import { type ShiftNote } from "@/lib/notes/form";
import { type RiskFinding } from "./finding-review";
export type Incident = {
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
export type Board = {
  notes: ShiftNote[];
  shiftRisks: ShiftRiskSummary[];
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
export type Audit = {
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
export const when = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not established";
export const interval = (minutes: number | null) =>
  minutes === null
    ? "Time not established"
    : minutes < 0
      ? "Check reported times"
      : minutes < 60
        ? `${Math.round(minutes)} min`
        : `${(minutes / 60).toFixed(1)} h`;
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? "The board could not load.");
  return data;
}
export function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
