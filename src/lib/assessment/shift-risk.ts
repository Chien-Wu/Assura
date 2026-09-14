import {
  normalizeRiskResult,
  type RiskLevel,
  type RiskType,
} from "./result.ts";

export type RiskTypeFilter = "all" | "none" | "unassessed" | RiskType;
export type SeriousnessFilter =
  | "all"
  | "unassessed"
  | "P4"
  | "P2-3"
  | "P0-1"
  | RiskLevel;
export type ShiftRiskSummary = {
  noteId: string;
  level: RiskLevel | null;
  riskTypes: RiskType[];
  status: "unassessed" | "running" | "ready" | "failed" | "stale";
  summary: string;
};
type ShiftRiskAssessment = {
  id: string;
  noteId: string;
  sourceRevision: number;
  schemaVersion: number;
  status: string;
  result: unknown;
  updatedAt: string;
};
type ShiftRiskFinding = {
  assessmentId: string;
  noteId: string;
  sourceRevision: number;
  isCurrent: boolean;
  type: RiskType;
  managerLevel: RiskLevel | null;
};

export function summarizeShiftRisk(
  note: { id: string; revision: number; status: string },
  assessments: ShiftRiskAssessment[],
  findings: ShiftRiskFinding[],
): ShiftRiskSummary {
  const assessment = assessments
    .filter((item) => item.noteId === note.id)
    .sort(
      (a, b) =>
        b.sourceRevision - a.sourceRevision ||
        b.schemaVersion - a.schemaVersion ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0];
  const unassessed: ShiftRiskSummary = {
    noteId: note.id,
    level: null,
    riskTypes: [],
    status: "unassessed",
    summary: "",
  };
  if (!assessment) return unassessed;
  if (
    assessment.sourceRevision !== note.revision ||
    (assessment.schemaVersion !== 2 && note.status !== "complete") ||
    assessment.status === "stale" ||
    assessment.status === "needs_answer"
  )
    return { ...unassessed, status: "stale" };
  if (assessment.status !== "ready")
    return {
      ...unassessed,
      status: assessment.status === "running" ? "running" : "failed",
    };
  const result = normalizeRiskResult(assessment.result);
  if (!result) return { ...unassessed, status: "failed" };
  const currentFindings = findings.filter(
    (finding) =>
      finding.noteId === note.id &&
      finding.assessmentId === assessment.id &&
      finding.sourceRevision === note.revision &&
      finding.isCurrent,
  );
  const level = result.risks.reduce<RiskLevel>((highest, risk) => {
    const effective =
      currentFindings.find((finding) => finding.type === risk.type)
        ?.managerLevel ?? risk.level;
    return effective > highest ? effective : highest;
  }, "P0");
  return {
    noteId: note.id,
    level,
    riskTypes: result.risks.map((risk) => risk.type),
    status: "ready",
    summary: result.summary,
  };
}

export function matchesShiftRisk(
  summary: ShiftRiskSummary | null | undefined,
  riskType: RiskTypeFilter = "all",
  seriousness: SeriousnessFilter = "all",
): boolean {
  const level = summary?.level ?? null;
  const riskMatches =
    riskType === "all" ||
    (riskType === "unassessed"
      ? level === null
      : riskType === "none"
        ? level !== null && summary?.riskTypes.length === 0
        : summary?.riskTypes.includes(riskType) === true);
  const seriousnessMatches =
    seriousness === "all" ||
    (seriousness === "unassessed"
      ? level === null
      : seriousness === "P2-3"
        ? level === "P2" || level === "P3"
        : seriousness === "P0-1"
          ? level === "P0" || level === "P1"
          : level === seriousness);
  return riskMatches && seriousnessMatches;
}
