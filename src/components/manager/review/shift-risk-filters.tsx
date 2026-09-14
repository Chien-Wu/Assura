"use client";

import { Button } from "@/components/ui/button";
import { riskLevelLabels, riskTypeLabels } from "@/lib/assessment/result";
import type {
  RiskTypeFilter,
  SeriousnessFilter,
  ShiftRiskSummary,
} from "@/lib/assessment/shift-risk";
import { RiskBadge } from "./finding-review";
import styles from "./shift-risk-filters.module.css";

export default function ShiftRiskFilters({
  riskType,
  seriousness,
  onRiskTypeChange,
  onSeriousnessChange,
  onReset,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  disabled = false,
}: {
  riskType: RiskTypeFilter;
  seriousness: SeriousnessFilter;
  onRiskTypeChange: (value: RiskTypeFilter) => void;
  onSeriousnessChange: (value: SeriousnessFilter) => void;
  onReset: () => void;
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.filters}>
      <label>
        Risk type
        <select
          value={riskType}
          disabled={disabled}
          onChange={(event) =>
            onRiskTypeChange(event.target.value as RiskTypeFilter)
          }
        >
          <option value="all">All risk types</option>
          {Object.entries(riskTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value="none">No risk detected</option>
          <option value="unassessed">Not assessed</option>
        </select>
      </label>
      <label>
        Seriousness
        <select
          value={seriousness}
          disabled={disabled}
          onChange={(event) =>
            onSeriousnessChange(event.target.value as SeriousnessFilter)
          }
        >
          <option value="all">All seriousness levels</option>
          <option value="P4">P4 · Critical</option>
          <option value="P2-3">P2–3 · Internal review / urgent</option>
          <option value="P0-1">P0–1 · Routine / monitor</option>
          {(["P3", "P2", "P1", "P0"] as const).map((level) => (
            <option key={level} value={level}>
              {level} · {riskLevelLabels[level]}
            </option>
          ))}
          <option value="unassessed">Not assessed</option>
        </select>
      </label>
      <label>
        From date
        <input
          type="date"
          value={fromDate}
          max={toDate || undefined}
          disabled={disabled}
          onChange={(event) => onFromDateChange(event.target.value)}
        />
      </label>
      <label>
        To date
        <input
          type="date"
          value={toDate}
          min={fromDate || undefined}
          disabled={disabled}
          onChange={(event) => onToDateChange(event.target.value)}
        />
      </label>
      {(riskType !== "all" || seriousness !== "all" || fromDate || toDate) && (
        <Button variant="ghost" onClick={onReset} disabled={disabled}>
          Clear filters
        </Button>
      )}
      {fromDate && toDate && fromDate > toDate && (
        <p className={styles.error} role="alert">
          From date must be on or before To date.
        </p>
      )}
    </div>
  );
}

export function ShiftRiskStatus({
  risk,
}: {
  risk: ShiftRiskSummary | null | undefined;
}) {
  if (risk?.level) return <RiskBadge level={risk.level} />;
  const label =
    risk?.status === "running"
      ? "Check in progress"
      : risk?.status === "failed"
        ? "Check failed"
        : risk?.status === "stale"
          ? "Needs a new check"
          : "Not assessed";
  return <span className={styles.unassessed}>{label}</span>;
}
