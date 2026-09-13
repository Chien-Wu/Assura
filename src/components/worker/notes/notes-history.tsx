"use client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import {
  normalizeRiskResult,
  overallRiskLevel,
  riskLevelLabels,
} from "@/lib/assessment/result";
import {
  AlertCircle,
  ArrowUpRight,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { formatDate } from "./note-display";
import { reviewCount, useWorkspace } from "./use-workspace";
export default function NotesHistory({
  busy,
  voiceActive,
  startNew,
  notes,
  filter,
  setFilter,
  listError,
  error,
  loading,
  setLoading,
  loadNotes,
  filtered,
  user,
  setView,
  openNote,
}: Pick<
  ReturnType<typeof useWorkspace>,
  | "busy"
  | "voiceActive"
  | "startNew"
  | "notes"
  | "filter"
  | "setFilter"
  | "listError"
  | "error"
  | "loading"
  | "setLoading"
  | "loadNotes"
  | "filtered"
  | "user"
  | "setView"
  | "openNote"
>) {
  return (
    <TabsContent value="history">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MY NOTES</p>
          <h1>The details, in one place.</h1>
          <p>Saved records and anything that needs a closer look.</p>
        </div>
        <Button disabled={Boolean(busy) || voiceActive} onClick={startNew}>
          <Plus size={17} /> Choose a shift
        </Button>
      </div>
      <div className="list-toolbar">
        <div>
          <span className="demo-label">Demo workspace</span>
          <span>Your own saved records · {notes.length} notes</span>
        </div>
        <label className="filter-label">
          Show
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="filter-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All notes</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="review">For review</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      {(listError || error) && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <p>{listError || error}</p>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void loadNotes();
            }}
          >
            <RefreshCw size={15} /> Retry
          </Button>
        </div>
      )}
      {loading ? (
        <div className="empty-records" role="status">
          <LoaderCircle className="spin" size={28} />
          <p>Loading your notes…</p>
        </div>
      ) : filtered.length === 0 ? (
        <section className="empty-records">
          <FileText size={32} />
          <h2>
            {filter === "all" ? "No shift notes yet" : "No matching notes"}
          </h2>
          <p>
            {!user
              ? "Sign in to see and save your workspace records."
              : filter === "all"
                ? "Start a shift note. Your saved records will appear here."
                : "Try another filter to see your saved records."}
          </p>
          {!user ? (
            <Button asChild>
              <Link href="/?role=worker" target="_top">
                Sign in
              </Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setView("worker")}>
              Go to my shift
            </Button>
          )}
        </section>
      ) : (
        <section className="notes-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Participant</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk check</TableHead>
                <TableHead>
                  <span className="sr-only">Open note</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const result = normalizeRiskResult(item.assessment);
                const level = result ? overallRiskLevel(result) : null;
                const legacyReviews = result ? 0 : reviewCount(item);
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <strong>
                        {item.fields.participant || "Unnamed participant"}
                      </strong>
                      <small>Saved {formatDate(item.updatedAt)}</small>
                    </TableCell>
                    <TableCell>
                      {item.fields.shiftStart
                        ? item.fields.shiftStart.replace("T", " · ")
                        : "Not added"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`status-badge ${item.status === "complete" ? "complete" : ""}`}
                      >
                        {item.status === "complete" ? "Complete" : "Draft"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {level ? (
                        <span
                          className={`status-badge ${level === "P0" ? "complete" : "review"}`}
                        >
                          {level} · {riskLevelLabels[level]}
                        </span>
                      ) : legacyReviews ? (
                        <span className="status-badge review">
                          {legacyReviews} earlier review{" "}
                          {legacyReviews === 1 ? "item" : "items"}
                        </span>
                      ) : (
                        <span className="muted-text">
                          {item.status === "complete"
                            ? "No saved check"
                            : "Not checked"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        disabled={Boolean(busy) || voiceActive}
                        onClick={() => openNote(item.id)}
                      >
                        Open <ArrowUpRight size={15} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}
    </TabsContent>
  );
}
