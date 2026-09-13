"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  answerText,
  applicable,
  definitions,
  followUpOptions,
  incidentOptions,
  labelFor,
  noteAnswer,
  type ShiftNote,
} from "@/lib/notes/form";
import { participants } from "@/lib/roster/participant-profiles";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  LoaderCircle,
  Save,
} from "lucide-react";
import InterviewReferences from "./interview-references";
import { formatDate } from "./note-display";
import { RiskSummary } from "./risk-review";
import SafetyPanel from "./safety-panel";
import { useWorkspace } from "./use-workspace";
export default function ShiftNoteCard({
  note,
  completed,
  showIssues,
  validation,
  errorSummary,
  fields,
  savedRisk,
  update,
  busy,
  voiceActive,
  user,
  savePractice,
  dirty,
  setReviewNote,
  setView,
  save,
  reviewAndConfirm,
}: Pick<
  ReturnType<typeof useWorkspace>,
  | "note"
  | "completed"
  | "showIssues"
  | "validation"
  | "errorSummary"
  | "fields"
  | "savedRisk"
  | "update"
  | "busy"
  | "voiceActive"
  | "user"
  | "savePractice"
  | "dirty"
  | "setReviewNote"
  | "setView"
  | "save"
  | "reviewAndConfirm"
> & { note: ShiftNote }) {
  return (
    <section className="form-card" aria-label="Shift note form">
      <div className="form-title">
        <div>
          <h2>Shift note</h2>
          <p>
            {note
              ? `Updated ${formatDate(note.updatedAt)}`
              : "Start with what you remember."}
          </p>
        </div>
        <span className={`status-badge ${completed ? "complete" : ""}`}>
          {completed ? (
            <>
              <Check size={13} /> Complete
            </>
          ) : (
            "Draft"
          )}
        </span>
      </div>
      {!completed && showIssues && validation.issues.length > 0 && (
        <div
          className="error-banner error-summary"
          role="alert"
          tabIndex={-1}
          ref={errorSummary}
          aria-labelledby="error-summary-title"
        >
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <p id="error-summary-title">
              <strong>
                {validation.issues.length === 1
                  ? "1 detail still needs an answer"
                  : `${validation.issues.length} details still need an answer`}
              </strong>
            </p>
            <ul>
              {validation.issues.map((issue) => (
                <li key={issue.field}>
                  <a href={`#${issue.field}`}>{labelFor(issue.field)}</a>
                  {" — "}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {completed ? (
        <div className="record-body">
          {definitions
            .filter(
              ({ key, section }) =>
                applicable(key, fields) &&
                (!note.assessment ||
                  section < 3 ||
                  !["unanswered", "unknown", ""].includes(fields[key])),
            )
            .map(({ key, label }) => (
              <div className="record-field" key={key}>
                <h3>{label}</h3>
                <p>
                  {note && !note.assessment
                    ? noteAnswer(note, key)
                    : answerText(key, fields[key])}
                </p>
              </div>
            ))}
          {savedRisk && <RiskSummary result={savedRisk} />}
        </div>
      ) : (
        <>
          {[
            { id: 1, title: "The essentials" },
            { id: 2, title: "During the shift" },
          ].map((section) => (
            <div className="form-section" key={section.id}>
              <h3>
                <span>0{section.id}</span>
                {section.title}
              </h3>
              {section.id === 1 && (
                <p className="section-help">
                  Times are in Melbourne. Include both dates for overnight
                  shifts.
                </p>
              )}
              <div className={section.id === 1 ? "essentials-fields" : ""}>
                {definitions
                  .filter(
                    (field) =>
                      field.section === section.id &&
                      applicable(field.key, fields),
                  )
                  .map((field) => {
                    const issue = showIssues
                      ? validation.issues.find(
                          (item) => item.field === field.key,
                        )
                      : undefined;
                    const options =
                      field.key === "incidents"
                        ? incidentOptions
                        : followUpOptions;
                    return (
                      <div
                        className={`field-wrap ${field.key === "participant" ? "full-width" : ""}`}
                        key={field.key}
                      >
                        <label htmlFor={field.key}>
                          {note.shiftId &&
                          (field.key === "shiftStart" ||
                            field.key === "shiftEnd")
                            ? `Actual ${field.label.toLowerCase()}`
                            : field.label}
                        </label>
                        {field.key === "participant" && note.shiftId ? (
                          <Input
                            id="participant"
                            value={fields.participant}
                            readOnly
                            aria-describedby="scheduled-participant-help"
                          />
                        ) : field.key === "participant" ? (
                          <Select
                            value={fields.participant}
                            onValueChange={(value) =>
                              update("participant", value)
                            }
                            disabled={Boolean(busy) || voiceActive}
                          >
                            <SelectTrigger id="participant" className="w-full">
                              <SelectValue placeholder="Choose a participant" />
                            </SelectTrigger>
                            <SelectContent>
                              {participants.map((profile) => (
                                <SelectItem
                                  key={profile.id}
                                  value={profile.name}
                                >
                                  {profile.name} · {profile.id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : field.type === "select" ? (
                          <Select
                            value={fields[field.key]}
                            onValueChange={(value) => update(field.key, value)}
                            disabled={Boolean(busy) || voiceActive}
                          >
                            <SelectTrigger
                              id={field.key}
                              className="w-full"
                              aria-invalid={Boolean(issue)}
                              aria-describedby={
                                issue ? `${field.key}-error` : undefined
                              }
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(options).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : field.type === "textarea" ? (
                          <Textarea
                            id={field.key}
                            value={fields[field.key]}
                            maxLength={6000}
                            disabled={Boolean(busy) || voiceActive}
                            placeholder={
                              "placeholder" in field
                                ? String(field.placeholder)
                                : undefined
                            }
                            onChange={(e) => update(field.key, e.target.value)}
                            aria-invalid={Boolean(issue)}
                            aria-describedby={
                              issue ? `${field.key}-error` : undefined
                            }
                          />
                        ) : (
                          <Input
                            id={field.key}
                            type={field.type}
                            value={fields[field.key]}
                            maxLength={200}
                            disabled={Boolean(busy) || voiceActive}
                            placeholder={
                              "placeholder" in field
                                ? String(field.placeholder)
                                : undefined
                            }
                            onChange={(e) => update(field.key, e.target.value)}
                            aria-invalid={Boolean(issue)}
                            aria-describedby={
                              issue ? `${field.key}-error` : undefined
                            }
                          />
                        )}{" "}
                        {issue && (
                          <p className="field-error" id={`${field.key}-error`}>
                            {issue.message}
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </>
      )}
      {completed && !note.assessment && <InterviewReferences note={note} />}
      {completed && !note.assessment && (
        <SafetyPanel
          key={`${note?.id ?? "new"}:${note?.revision ?? 0}:${fields.participant}`}
          note={note}
          participant={fields.participant}
          disabled={Boolean(busy) || voiceActive || completed || !user}
          onSave={savePractice}
        />
      )}
      {completed && !note.assessment && validation.reviewReasons.length > 0 && (
        <div className="review-flags">
          <h3>
            <AlertCircle size={16} /> For review
          </h3>
          <ul>
            {validation.reviewReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={`form-bottom${voiceActive ? " with-handoff" : ""}`}>
        <span aria-live="polite">
          {busy === "save"
            ? "Saving…"
            : completed
              ? `Confirmed ${formatDate(note.confirmedAt!)}`
              : dirty
                ? "Changes not saved"
                : note
                  ? "Draft saved"
                  : "No note saved yet"}
        </span>
        <div>
          {completed ? (
            <>
              <Button variant="outline" onClick={() => setReviewNote(note)}>
                View saved record
              </Button>
              <Button
                variant="outline"
                disabled={voiceActive}
                onClick={() => setView("history")}
              >
                <ArrowLeft size={15} /> My notes
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={
                  Boolean(busy) ||
                  voiceActive ||
                  !user ||
                  (!dirty && Boolean(note)) ||
                  (!note && !hasContent(fields))
                }
                onClick={save}
              >
                {busy === "save" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}{" "}
                Save draft
              </Button>
              <Button
                disabled={Boolean(busy) || !user}
                aria-describedby={
                  voiceActive ? "review-handoff-help" : undefined
                }
                onClick={reviewAndConfirm}
              >
                {busy === "review" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : null}
                {busy === "review"
                  ? voiceActive
                    ? "Ending & saving…"
                    : "Preparing review…"
                  : voiceActive
                    ? "End conversation & review"
                    : "Review & confirm"}
              </Button>
            </>
          )}
        </div>
        {voiceActive && (
          <p
            id="review-handoff-help"
            className="section-help recorder-review-help"
          >
            Ends the conversation and saves its updates before opening review.
          </p>
        )}
      </div>
    </section>
  );
}

import { hasContent } from "./note-display";
