"use client";
import { normalizeRiskResult } from "@/lib/assessment/result";
import {
  checkForm,
  definitions,
  emptyFields,
  noteText,
  type FieldKey,
  type ShiftFields,
  type ShiftNote,
} from "@/lib/notes/form";
import { type RestrictivePractice } from "@/lib/notes/safety";
import { participantForNote } from "@/lib/roster/participant-profiles";
import { type ScheduledShift } from "@/lib/roster/shifts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type RecorderReviewControl } from "../recorder/use-voice-recorder";
import { hasContent } from "./note-display";
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
export const reviewCount = (item: ShiftNote) => {
  const result = normalizeRiskResult(item.assessment);
  return result
    ? result.risks.length
    : item.status === "complete"
      ? checkForm(item.fields).reviewReasons.length
      : 0;
};
export function useWorkspace({
  user,
  workflowEnabled = false,
}: {
  user: { name: string; providerName?: string } | null;
  workflowEnabled?: boolean;
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

  const [reloadOpen, setReloadOpen] = useState(false);

  const [reviewNote, setReviewNote] = useState<ShiftNote | null>(null);

  const [recoveryCopy, setRecoveryCopy] = useState<ShiftNote | null>(null);

  const [filter, setFilter] = useState("all");

  const [showIssues, setShowIssues] = useState(false);

  const [notice, setNotice] = useState("");

  const [submitAttempt, setSubmitAttempt] = useState(0);

  const errorSummary = useRef<HTMLDivElement>(null);

  const mutationLock = useRef(false);

  const recorderReview = useRef<RecorderReviewControl | null>(null);

  const leavingAfterSave = useRef(false);

  const dirty =
    JSON.stringify(fields) !== JSON.stringify(note?.fields ?? emptyFields());

  const allChecks = checkForm(fields);

  const basicFields = definitions.filter((field) => field.section < 3);

  const basicIssues = allChecks.issues.filter((issue) =>
    basicFields.some((field) => field.key === issue.field),
  );

  const validation = {
    ...allChecks,
    issues: basicIssues,
    ready: basicIssues.length === 0,
    total: basicFields.length,
    answered:
      basicFields.length -
      new Set(basicIssues.map((issue) => issue.field)).size,
  };

  const completed = note?.status === "complete";

  const savedRisk = normalizeRiskResult(note?.assessment);

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
    const noteId = new URLSearchParams(window.location.search).get("note");
    if (!noteId) return;
    let cancelled = false;
    api<{ note: ShiftNote }>(`/api/notes/${encodeURIComponent(noteId)}`)
      .then(({ note: saved }) => {
        if (cancelled) return;
        setNote(saved);
        setFields(saved.fields);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your saved note.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    const current = note;
    if (!current)
      throw new Error("Choose an assigned shift before writing a note.");
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

  async function action(
    name: string,
    fn: () => Promise<void>,
    allowRecorderHandoff = false,
  ) {
    if (mutationLock.current || (voiceActive && !allowRecorderHandoff)) return;
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
    if (!note || !participantForNote(note))
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

  function reviewAndConfirm() {
    return action(
      "review",
      async () => {
        // Stopping can finish a queued correction. Use the returned server note,
        // never this render's pre-stop fields or persist() closure.
        let saved: ShiftNote;
        if (voiceActive) {
          if (!recorderReview.current)
            throw new Error(
              "The conversation is still preparing. Please try again in a moment.",
            );
          saved = await recorderReview.current.finishForReview();
        } else {
          saved = await persist();
        }
        acceptSaved(saved);
        setShowIssues(true);
        const issues = checkForm(saved.fields).issues.filter((issue) =>
          basicFields.some((field) => field.key === issue.field),
        );
        if (issues.length) {
          setSubmitAttempt((count) => count + 1);
          return;
        }
        setReviewNote(saved);
      },
      true,
    );
  }

  function startNew() {
    return action("new", async () => {
      if (dirty && (note || hasContent(fields))) await persist();
      setNote(null);
      setFields(emptyFields());
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

  function selectShift(shift: ScheduledShift) {
    return action("shift", async () => {
      if (dirty && note) await persist();
      const result = shift.noteId
        ? await api<{ note: ShiftNote }>(`/api/notes/${shift.noteId}`)
        : await api<{ note: ShiftNote }>("/api/notes", "POST", {
            id: crypto.randomUUID(),
            shiftId: shift.id,
          });
      acceptSaved(result.note);
      setShowIssues(false);
      setView("worker");
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
      (filter === "review" ? reviewCount(item) > 0 : item.status === filter),
  );
  function onSignOutBusyChange(signingOut: boolean) {
    mutationLock.current = signingOut;
    setBusy(signingOut ? "signOut" : "");
    if (!signingOut) leavingAfterSave.current = false;
  }
  return {
    user,
    workflowEnabled,
    router,
    view,
    setView,
    fields,
    note,
    notes,
    loading,
    setLoading,
    busy,
    onSignOutBusyChange,
    voiceActive,
    setVoiceActive,
    error,
    listError,
    reloadOpen,
    setReloadOpen,
    reviewNote,
    setReviewNote,
    recoveryCopy,
    filter,
    setFilter,
    showIssues,
    notice,
    setNotice,
    errorSummary,
    recorderReview,
    dirty,
    validation,
    completed,
    savedRisk,
    loadNotes,
    update,
    acceptSaved,
    persist,
    action,
    savePractice,
    prepareVoiceDraft,
    save,
    openDetails,
    saveBeforeSignOut,
    reviewAndConfirm,
    startNew,
    openNote,
    selectShift,
    download,
    reloadSaved,
    filtered,
  };
}
