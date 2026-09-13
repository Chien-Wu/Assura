"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ClipboardList,
  Mic,
  ShieldCheck,
  FileText,
  ArrowUpRight,
  Plus,
  Check,
  Download,
  LoaderCircle,
  AlertCircle,
  ArrowLeft,
  Save,
  RefreshCw,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  emptyFields,
  definitions,
  checkForm,
  applicable,
  answerText,
  incidentOptions,
  followUpOptions,
  labelFor,
  noteText,
  noteAnswer,
  type ShiftFields,
  type ShiftNote,
  type FieldKey,
} from "@/lib/shift-form";

import ThemeToggle from "./theme-toggle";
import SignOutButton from "./sign-out-button";
import VoicePanel from "./voice-panel";
import SafetyPanel from "./safety-panel";
import { participants, participantFor } from "@/lib/participants";
import { type RestrictivePractice } from "@/lib/safety";

type Review = { note: ShiftNote; confirmationId: string };
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? "Something went wrong. Please try again.");
  return result;
}
const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
const hasContent = (fields: ShiftFields) =>
  Object.entries(fields).some(
    ([key, value]) =>
      value &&
      !((key === "incidents" || key === "followUp") && value === "unanswered"),
  );

export default function Workspace({
  user,
}: {
  user: { name: string; providerName?: string } | null;
}) {
  const router = useRouter();
  const [view, setView] = useState("worker");
  const [fields, setFields] = useState<ShiftFields>(emptyFields);
  const [note, setNote] = useState<ShiftNote | null>(null);
  const [notes, setNotes] = useState<ShiftNote[]>([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [recoveryCopy, setRecoveryCopy] = useState<ShiftNote | null>(null);
  const [filter, setFilter] = useState("all");
  const [showIssues, setShowIssues] = useState(false);
  const [notice, setNotice] = useState("");
  const [submitAttempt, setSubmitAttempt] = useState(0);
  const errorSummary = useRef<HTMLDivElement>(null);
  const newId = useRef<string | null>(null);
  const mutationLock = useRef(false);
  const leavingAfterSave = useRef(false);
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(note?.fields ?? emptyFields());
  const validation = checkForm(fields);
  const completed = note?.status === "complete";

  const loadNotes = useCallback(() => {
    if (!user) return;
    return api<{ notes: ShiftNote[] }>("/api/notes")
      .then((result) => {
        setNotes(result.notes);
        setListError("");
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : "Could not load notes.");
      })
      .finally(() => setLoading(false));
  }, [user]);
  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);
  useEffect(() => {
    if (!dirty && !voiceActive) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (leavingAfterSave.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, voiceActive]);

  function update(key: FieldKey, value: string) {
    setFields((current) => {
      const next = { ...current, [key]: value };
      return next;
    });
    setNotice("");
    setError("");
  }
  function acceptSaved(saved: ShiftNote) {
    setNote(saved);
    setFields(saved.fields);
    setNotes((current) => [
      saved,
      ...current.filter((item) => item.id !== saved.id),
    ]);
  }
  async function persist(): Promise<ShiftNote> {
    if (!user) throw new Error("Sign in to save your note.");
    let current = note;
    if (!current) {
      newId.current ??= crypto.randomUUID();
      current = (
        await api<{ note: ShiftNote }>("/api/notes", "POST", {
          id: newId.current,
        })
      ).note;
      setNote(current);
    }
    if (current.status === "complete") return current;
    if (JSON.stringify(fields) === JSON.stringify(current.fields)) {
      acceptSaved(current);
      return current;
    }
    const { note: saved } = await api<{ note: ShiftNote }>(
      `/api/notes/${current.id}`,
      "PATCH",
      { revision: current.revision, fields },
    );
    acceptSaved(saved);
    return saved;
  }
  async function action(name: string, fn: () => Promise<void>) {
    if (mutationLock.current || voiceActive) return;
    mutationLock.current = true;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      mutationLock.current = false;
      setBusy("");
    }
  }
  async function savePractice(restrictivePractice: RestrictivePractice) {
    await action("practice", async () => {
      const current = await persist();
      const result = await api<{ note: ShiftNote }>(
        `/api/notes/${current.id}`,
        "PATCH",
        { revision: current.revision, fields: {}, restrictivePractice },
      );
      acceptSaved(result.note);
    });
  }
  async function prepareVoiceDraft() {
    if (!participantFor(fields.participant))
      throw new Error("Choose a participant profile before starting.");
    if (mutationLock.current)
      throw new Error("Wait for the current save to finish.");
    mutationLock.current = true;
    setBusy("voiceStart");
    try {
      return await persist();
    } finally {
      mutationLock.current = false;
      setBusy("");
    }
  }
  function save() {
    return action("save", async () => {
      await persist();
      setNotice("Draft saved.");
    });
  }
  function openDetails() {
    return action("details", async () => {
      if (dirty && (note || hasContent(fields))) await persist();
      router.push("/onboarding?edit=1");
    });
  }
  async function saveBeforeSignOut() {
    if (dirty && (note || hasContent(fields))) await persist();
    // The unload handler may still hold the prior render's dirty state. It is
    // safe to leave only after persistence succeeds; the editor stays locked.
    leavingAfterSave.current = true;
  }
  useEffect(() => {
    if (submitAttempt > 0) errorSummary.current?.focus();
  }, [submitAttempt]);
  function prepareReview() {
    return action("review", async () => {
      setShowIssues(true);
      if (!validation.ready) {
        setSubmitAttempt((count) => count + 1);
        return;
      }
      const saved = await persist();
      const result = await api<Review>(
        `/api/notes/${saved.id}/review`,
        "POST",
        { revision: saved.revision },
      );
      setReview({ note: result.note, confirmationId: result.confirmationId });
    });
  }
  function confirm() {
    if (!review) return;
    return action("confirm", async () => {
      const result = await api<{ note: ShiftNote }>(
        `/api/notes/${review.note.id}/confirm`,
        "POST",
        {
          revision: review.note.revision,
          confirmationId: review.confirmationId,
          confirmed: true,
        },
      );
      acceptSaved(result.note);
      setReview(null);
      setNotice("Your shift note is complete.");
    });
  }
  function startNew() {
    return action("new", async () => {
      if (dirty && (note || hasContent(fields))) await persist();
      setNote(null);
      setFields(emptyFields());
      newId.current = null;
      setShowIssues(false);
      setView("worker");
    });
  }
  function openNote(id: string) {
    return action("open", async () => {
      if (dirty && (note || hasContent(fields))) await persist();
      const result = await api<{ note: ShiftNote }>(`/api/notes/${id}`);
      acceptSaved(result.note);
      setView("worker");
      setShowIssues(false);
    });
  }
  function download(saved: ShiftNote | null = note) {
    if (!saved) return;
    const link = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob([noteText(saved)], { type: "text/plain;charset=utf-8" }),
    );
    link.href = url;
    link.download = `shift-note-${saved.id.slice(0, 8)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function reloadSaved() {
    if (!note) return;
    return action("reload", async () => {
      const result = await api<{ note: ShiftNote }>(`/api/notes/${note.id}`);
      if (dirty)
        setRecoveryCopy({
          ...note,
          fields: { ...fields },
          status: "draft",
          confirmedAt: null,
        });
      acceptSaved(result.note);
      setReloadOpen(false);
      setNotice("Loaded the saved version.");
    });
  }
  const filtered = notes.filter(
    (item) =>
      filter === "all" ||
      (filter === "review"
        ? checkForm(item.fields).reviewReasons.length > 0
        : item.status === filter),
  );

  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        if (!voiceActive) setView(value);
      }}
      className="workspace-root"
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          LegalMate<span className="edition">WORKER</span>
        </div>
        <TabsList className="main-tabs">
          <TabsTrigger value="worker">
            <Mic size={16} /> My shift
          </TabsTrigger>
          <TabsTrigger value="history" disabled={voiceActive}>
            <ClipboardList size={16} /> My notes
          </TabsTrigger>
        </TabsList>
        <div className="profile">
          <ThemeToggle />
          {user ? (
            <>
              <span className="avatar">{user.name[0].toUpperCase()}</span>
              <span className="profile-name" title={user.name}>
                {user.name}
              </span>
              <SignOutButton
                disabled={voiceActive || Boolean(busy)}
                beforeSignOut={saveBeforeSignOut}
                onBusyChange={(signingOut) => {
                  mutationLock.current = signingOut;
                  setBusy(signingOut ? "signOut" : "");
                  if (!signingOut) leavingAfterSave.current = false;
                }}
              />
            </>
          ) : (
            <Link href="/?role=worker">
              Sign in <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
      </header>
      <main className="main-shell">
        <TabsContent value="worker">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {note
                  ? (note.providerName ?? "Unassigned provider")
                  : (user?.providerName ?? "SHIFT RECORD")}
              </p>
              <button
                type="button"
                className="workspace-provider entry-text-button"
                disabled={voiceActive || Boolean(busy)}
                onClick={() => void openDetails()}
              >
                Your details
              </button>
              <h1>
                {completed
                  ? "One shift, all wrapped up."
                  : "Let’s wrap up your shift."}
              </h1>
              <p>
                {completed
                  ? "Your confirmed record is saved and ready to review."
                  : "Keep the details that matter, while they’re still fresh."}
              </p>
            </div>
            <div className="heading-actions">
              <span className="demo-label">Demo form · Temporary fields</span>
              {note && (
                <Button
                  variant="outline"
                  disabled={Boolean(busy) || voiceActive}
                  onClick={startNew}
                >
                  <Plus size={16} /> New note
                </Button>
              )}
            </div>
          </div>
          {!user && (
            <div className="info-banner">
              <ShieldCheck size={18} />
              <p>
                <Link href="/?role=worker">Sign in to save your notes.</Link>{" "}
                This preview uses your own workspace records. Use fictional
                participant details.
              </p>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <p>{error}</p>
              {note && (
                <Button
                  variant="outline"
                  disabled={Boolean(busy) || voiceActive}
                  onClick={() => setReloadOpen(true)}
                >
                  Reload saved version
                </Button>
              )}
            </div>
          )}
          {recoveryCopy && (
            <div className="info-banner">
              <FileText size={18} />
              <p>
                Your previous unsaved answers are available as a copy until you
                leave this page.
              </p>
              <Button variant="outline" onClick={() => download(recoveryCopy)}>
                Download previous edits
              </Button>
            </div>
          )}
          {notice && (
            <div className="success-banner" role="status">
              <Check size={18} />
              <p>{notice}</p>
            </div>
          )}
          <div className="editor-grid">
            <aside className="conversation-card">
              <div className="panel-heading">
                <AudioLines size={20} />
                <span>Your conversation</span>
                <span className="quiet-badge">
                  {voiceActive
                    ? "Connected"
                    : completed
                      ? "Note complete"
                      : "English"}
                </span>
              </div>
              <VoicePanel
                signedIn={Boolean(user)}
                disabled={Boolean(busy)}
                note={note}
                prepareDraft={prepareVoiceDraft}
                onSaved={acceptSaved}
                onActive={setVoiceActive}
              />
              {completed && !voiceActive && (
                <div className="voice-download">
                  <Button className="voice-button" onClick={() => download()}>
                    <Download size={18} />
                    Download note
                  </Button>
                </div>
              )}
              <div className="coverage">
                <div>
                  <span>
                    {completed ? "Record complete" : "Details covered"}
                  </span>
                  <strong>
                    {validation.answered}
                    <span> / {validation.total}</span>
                  </strong>
                </div>
                <Progress
                  value={Math.max(
                    0,
                    (validation.answered / validation.total) * 100,
                  )}
                  aria-label="Details covered"
                  className="coverage-bar"
                />
                {!completed && validation.issues.length > 0 && (
                  <p>
                    {Array.from(
                      new Set(
                        validation.issues.map((issue) => labelFor(issue.field)),
                      ),
                    )
                      .slice(0, 3)
                      .join(" · ")}
                    {validation.issues.length > 3 ? " …" : ""}
                  </p>
                )}
                {!completed && validation.ready && (
                  <p>
                    All required details have an answer. Ready for your review.
                  </p>
                )}
              </div>
              <div className="conversation-footer">
                <ShieldCheck size={17} />
                <span>
                  {completed
                    ? "Confirmed by you. Review flags remain visible below."
                    : "You review and confirm before a note is completed."}
                </span>
              </div>
            </aside>
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
                          <a href={`#${issue.field}`}>
                            {labelFor(issue.field)}
                          </a>
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
                    .filter(({ key }) => applicable(key, fields))
                    .map(({ key, label }) => (
                      <div className="record-field" key={key}>
                        <h3>{label}</h3>
                        <p>
                          {note
                            ? noteAnswer(note, key)
                            : answerText(key, fields[key])}
                        </p>
                      </div>
                    ))}
                </div>
              ) : (
                <>
                  {[
                    { id: 1, title: "The essentials" },
                    { id: 2, title: "During the shift" },
                    { id: 3, title: "Concerns & next steps" },
                  ].map((section) => (
                    <div className="form-section" key={section.id}>
                      <h3>
                        <span>0{section.id}</span>
                        {section.title}
                      </h3>
                      {section.id === 1 && (
                        <p className="section-help">
                          Times are in Melbourne. Include both dates for
                          overnight shifts.
                        </p>
                      )}
                      <div
                        className={section.id === 1 ? "essentials-fields" : ""}
                      >
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
                                <label htmlFor={field.key}>{field.label}</label>
                                {field.key === "participant" ? (
                                  <Select
                                    value={fields.participant}
                                    onValueChange={(value) =>
                                      update("participant", value)
                                    }
                                    disabled={Boolean(busy) || voiceActive}
                                  >
                                    <SelectTrigger
                                      id="participant"
                                      className="w-full"
                                    >
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
                                    onValueChange={(value) =>
                                      update(field.key, value)
                                    }
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
                                      {Object.entries(options).map(
                                        ([value, label]) => (
                                          <SelectItem key={value} value={value}>
                                            {label}
                                          </SelectItem>
                                        ),
                                      )}
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
                                    onChange={(e) =>
                                      update(field.key, e.target.value)
                                    }
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
                                    onChange={(e) =>
                                      update(field.key, e.target.value)
                                    }
                                    aria-invalid={Boolean(issue)}
                                    aria-describedby={
                                      issue ? `${field.key}-error` : undefined
                                    }
                                  />
                                )}{" "}
                                {issue && (
                                  <p
                                    className="field-error"
                                    id={`${field.key}-error`}
                                  >
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
              <SafetyPanel
                key={`${note?.id ?? "new"}:${note?.revision ?? 0}:${fields.participant}`}
                note={note}
                participant={fields.participant}
                disabled={Boolean(busy) || voiceActive || completed || !user}
                onSave={savePractice}
              />
              {validation.reviewReasons.length > 0 && (
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
              <div className="form-bottom">
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
                    <Button
                      variant="outline"
                      disabled={voiceActive}
                      onClick={() => setView("history")}
                    >
                      <ArrowLeft size={15} /> My notes
                    </Button>
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
                        disabled={Boolean(busy) || voiceActive || !user}
                        onClick={prepareReview}
                      >
                        {busy === "review" ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : null}
                        Review & confirm
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="history">
          <div className="page-heading">
            <div>
              <p className="eyebrow">MY NOTES</p>
              <h1>The details, in one place.</h1>
              <p>Saved records and anything that needs a closer look.</p>
            </div>
            <Button disabled={Boolean(busy) || voiceActive} onClick={startNew}>
              <Plus size={17} /> New shift note
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
                    <TableHead>For review</TableHead>
                    <TableHead>
                      <span className="sr-only">Open note</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => {
                    const checks = checkForm(item.fields);
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
                          {checks.reviewReasons.length ? (
                            <span className="status-badge review">
                              {checks.reviewReasons.length}{" "}
                              {checks.reviewReasons.length === 1
                                ? "item"
                                : "items"}
                            </span>
                          ) : (
                            <span className="muted-text">—</span>
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
      </main>
      <footer className="site-footer">
        <span>LegalMate</span>
        <span>Demo workspace · Use fictional participant details</span>
      </footer>
      <Dialog
        open={reloadOpen}
        onOpenChange={(open) => {
          if (!busy) setReloadOpen(open);
        }}
      >
        <DialogContent>
          <DialogTitle>Load the latest saved version?</DialogTitle>
          <DialogDescription>
            Your unsaved answers will be kept on this page as a downloadable
            copy. Loading a saved version will not save or overwrite anything.
          </DialogDescription>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(busy) || voiceActive}
              onClick={() => setReloadOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              disabled={Boolean(busy) || voiceActive}
              onClick={reloadSaved}
            >
              Load saved version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(review)}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent className="confirmation-dialog">
          <DialogTitle>Review your shift note</DialogTitle>
          <DialogDescription>
            Check the details below. Confirming saves this version as your
            completed record.
          </DialogDescription>
          <div className="confirmation-scroll">
            {review &&
              definitions
                .filter(({ key }) => applicable(key, review.note.fields))
                .map(({ key, label }) => (
                  <div className="record-field" key={key}>
                    <h3>{label}</h3>
                    <p>{noteAnswer(review.note, key)}</p>
                  </div>
                ))}
            {review &&
              checkForm(review.note.fields).reviewReasons.length > 0 && (
                <div className="review-flags">
                  <h3>Items will remain marked for review</h3>
                  <ul>
                    {checkForm(review.note.fields).reviewReasons.map(
                      (reason) => (
                        <li key={reason}>{reason}</li>
                      ),
                    )}
                  </ul>
                </div>
              )}
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(busy) || voiceActive}
              onClick={() => setReview(null)}
            >
              Make changes
            </Button>
            <Button disabled={Boolean(busy) || voiceActive} onClick={confirm}>
              {busy === "confirm" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              Confirm & save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
