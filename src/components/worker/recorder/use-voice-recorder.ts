"use client";
import { definitions, type ShiftNote } from "@/lib/notes/form";
import { createRecorderHandoff } from "@/lib/recorder/handoff";
import { type ConversationMode, type VoiceEvent } from "@/lib/recorder/state";
import {
  parseRecorderUpdate,
  recorderDynamicVariables,
  recorderFormResult,
  recorderToolFailure,
} from "@/lib/recorder/tools";
import { useConversation } from "@elevenlabs/react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
type Session = {
  id: string;
  conversationId: string;
  note: ShiftNote;
  sequence: number;
  workerSequence: number;
  interruptionGeneration: number;
  generation: number;
};
type FormResult = { note: ShiftNote } & Record<string, unknown>;
async function request<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(18000),
  });
  const text = await response.text();
  let result: T & { error?: string };
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      "The service could not respond. End the call and try again.",
    );
  }
  if (!response.ok)
    throw new Error(
      result.error ||
        "The request failed. Your saved draft is still available.",
    );
  return result;
}
export type RecorderReviewControl = {
  finishForReview: () => Promise<ShiftNote>;
};
export type Props = {
  signedIn: boolean;
  disabled: boolean;
  note: ShiftNote | null;
  prepareDraft: () => Promise<ShiftNote>;
  onSaved: (note: ShiftNote) => void;
  onActive: (active: boolean) => void;
  reviewControl: RefObject<RecorderReviewControl | null>;
};
export function useVoiceRecorder({
  signedIn,
  disabled,
  note,
  prepareDraft,
  onSaved,
  onActive,
  reviewControl,
  initialError,
  initialMessages,
  selectedMode,
  onReset,
}: Props & {
  initialError: string;
  initialMessages: VoiceEvent[];
  selectedMode: ConversationMode;
  onReset: (error: string, messages: VoiceEvent[]) => void;
}) {
  const textOnly = selectedMode === "text";

  const [available, setAvailable] = useState<boolean | null>(null);

  const [phase, setPhase] = useState<
    "idle" | "starting" | "active" | "stopping"
  >("idle");

  const [error, setError] = useState(initialError);

  const [messages, setMessages] = useState<VoiceEvent[]>(initialMessages);

  const history = useRef<VoiceEvent[]>(initialMessages);

  const [input, setInput] = useState("");

  const [sending, setSending] = useState(false);

  const [waiting, setWaiting] = useState(false);

  const sendLock = useRef(false);

  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages]);

  const active = useRef<Session | null>(null);

  const generation = useRef(0);

  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const latest = useRef({ onSaved, onActive, prepareDraft });

  const locked = useRef(false);

  const closing = useRef(false);

  const handoff = useRef<ReturnType<
    typeof createRecorderHandoff<ShiftNote>
  > | null>(null);

  const handoffError = useRef<Error | null>(null);

  const formSaveError = useRef<Error | null>(null);

  const startup = useRef<Promise<void>>(Promise.resolve());

  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = { onSaved, onActive, prepareDraft };
  }, [onSaved, onActive, prepareDraft]);

  useEffect(() => {
    let live = true;
    request<{ enabled: boolean }>("/api/voice/status")
      .then((data) => {
        if (live) setAvailable(data.enabled);
      })
      .catch(() => {
        if (live) setAvailable(false);
      });
    return () => {
      live = false;
    };
  }, []);

  function sessionRequest<T>(session: Session, body: unknown) {
    return request<T>(`/api/voice/sessions/${session.id}`, body);
  }

  function enqueue<T>(session: Session, job: () => Promise<T>): Promise<T> {
    const work = queue.current.then(() => {
      if (active.current !== session)
        throw new Error(
          "This call has ended. Start again to resume your draft.",
        );
      return job();
    });
    queue.current = work.catch((cause: unknown) => {
      if (closing.current && !handoffError.current)
        handoffError.current =
          cause instanceof Error
            ? cause
            : new Error(
                "Some conversation updates could not be saved. Please check your draft.",
              );
    });
    return work;
  }

  function saved(session: Session, value: ShiftNote) {
    session.note = value;
    if (active.current === session) latest.current.onSaved(value);
  }

  function clearTimer() {
    if (startupTimer.current) {
      clearTimeout(startupTimer.current);
      startupTimer.current = null;
    }
  }

  function finish(message = "") {
    if (message && !handoffError.current)
      handoffError.current = new Error(message);
    if (handoff.current) return handoff.current();
    if (!locked.current) return Promise.resolve({ note: null, error: null });
    handoff.current = createRecorderHandoff<ShiftNote>({
      stopAdmission: () => {
        closing.current = true;
        generation.current++;
        clearTimer();
        setPhase("stopping");
        conversation.endSession();
      },
      waitForStartup: () => startup.current,
      drainWrites: async () => {
        await queue.current;
        if (handoffError.current) throw handoffError.current;
        if (formSaveError.current) throw formSaveError.current;
      },
      closeSession: async () => {
        const session = active.current;
        if (session) await sessionRequest(session, { action: "close" });
      },
      readSaved: async () => {
        const session = active.current;
        const noteId = session?.note.id ?? note?.id;
        if (!noteId) throw new Error("Choose a saved shift before reviewing.");
        const result = await request<{ note: ShiftNote }>(
          `/api/notes/${noteId}`,
        );
        if (session) saved(session, result.note);
        else latest.current.onSaved(result.note);
        return result.note;
      },
      complete: ({ error: problem }) => {
        active.current = null;
        latest.current.onActive(false);
        onReset(problem?.message ?? "", history.current);
      },
    });
    return handoff.current();
  }

  function stop() {
    void finish();
  }

  function fatal(message: string) {
    setError(message);
    void finish(message);
  }

  function invalidate() {
    const session = active.current;
    if (!session || closing.current) return;
    session.interruptionGeneration++;
    const event: VoiceEvent = {
      sequence: ++session.sequence,
      kind: "interrupt",
      text: "Recorder interrupted or corrected",
    };
    void enqueue(session, () =>
      sessionRequest(session, { action: "event", event, responseMode: "ack" }),
    ).catch((e) => {
      if (active.current === session) fatal(e.message);
    });
  }

  function recordMessage(
    role: "user" | "agent",
    message: string,
    eventId?: number,
  ) {
    const session = active.current;
    if (!session || closing.current)
      return Promise.reject(new Error("This conversation has ended."));
    const event: VoiceEvent = {
      sequence: ++session.sequence,
      kind: role,
      text: message,
      eventId,
    };
    if (role === "user") session.workerSequence = event.sequence;
    history.current = [...history.current, event];
    setMessages(history.current);
    return enqueue(session, async () => {
      const result = await sessionRequest<{
        note?: ShiftNote;
        remainingClarifications?: number;
        riskFlags?: unknown;
        escalation?: unknown;
        coverage?: unknown;
        questions?: unknown;
      }>(session, { action: "event", event, responseMode: "ack" });
      if (result.note) saved(session, result.note);
      return result;
    });
  }

  async function sendText() {
    const session = active.current;
    const message = input.trim();
    if (
      !textOnly ||
      !session ||
      closing.current ||
      sendLock.current ||
      waiting ||
      phase !== "active" ||
      !message ||
      note?.status === "complete"
    )
      return;
    sendLock.current = true;
    setSending(true);
    setError("");
    try {
      // Typed turns are not echoed locally by the SDK. Persist once before the
      // recorder can act on them, including a correction.
      await recordMessage("user", message);
      if (closing.current || active.current !== session) return;
      conversation.sendUserMessage(message);
      setInput("");
      setWaiting(true);
    } catch (e) {
      fatal(
        e instanceof Error
          ? e.message
          : "Your message could not be sent. Start again to continue.",
      );
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function tool(
    name: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const session = active.current;
    if (!session || closing.current)
      return JSON.stringify(
        recorderToolFailure(new Error("This conversation has ended."), "stale"),
      );
    const isCurrent = () =>
      active.current === session &&
      !closing.current &&
      session.generation === generation.current;
    const stale = () =>
      JSON.stringify(
        recorderToolFailure(
          new Error(
            "The conversation or saved note changed. Refresh context before using historical evidence.",
          ),
          "stale",
        ),
      );

    if (name === "get_form_context") {
      try {
        const result = await enqueue(session, async () => {
          const value = await request<FormResult>(
            `/api/notes/${session.note.id}`,
          );
          if (isCurrent()) saved(session, value.note);
          return value;
        });
        if (!isCurrent()) return stale();
        return JSON.stringify({
          ok: true,
          ...recorderFormResult(result),
          definitions: definitions.filter((field) =>
            [
              "participant",
              "shiftStart",
              "shiftEnd",
              "activities",
              "supportProvided",
              "participantResponse",
              "goalProgress",
            ].includes(field.key),
          ),
          currentLocalTime: new Date().toLocaleString("en-AU", {
            timeZone: result.note.timezone,
          }),
        });
      } catch (e) {
        return isCurrent() ? JSON.stringify(recorderToolFailure(e)) : stale();
      }
    }
    if (
      [
        "search_participant_records",
        "register_followup",
        "prepare_confirmation",
        "finalize_form",
      ].includes(name)
    ) {
      return JSON.stringify({
        ok: false,
        stage: "record",
        action:
          "Save the worker's account using update_and_check_form. This stage only records the shift. A silent risk check and confirmation happen after the worker ends the conversation and selects Review & confirm. Do not screen for incidents or ask for final confirmation here.",
      });
    }
    const result = await enqueue(session, async () => {
      try {
        if (name === "update_and_check_form") {
          // PATCH clears the note's confirmation in the same guarded write.
          // Recorder sessions cannot prepare a review, so no preflight is needed.
          const update = parseRecorderUpdate(params.fields_json);
          const result = await request<FormResult>(
            `/api/notes/${session.note.id}`,
            {
              revision: session.note.revision,
              ...update,
              voiceSessionId: session.id,
            },
            "PATCH",
          );
          formSaveError.current = null;
          saved(session, result.note);
          return JSON.stringify({
            ok: true,
            ...recorderFormResult(result),
          });
        }
        throw new Error("Unknown LegalMate tool.");
      } catch (e) {
        // Recovery reads can overlap Review. Keep a failed form write pending
        // until a later successful write, even if closing has not started yet.
        formSaveError.current =
          e instanceof Error
            ? e
            : new Error("The final recorder update could not be saved.");
        if (closing.current && !handoffError.current)
          handoffError.current =
            e instanceof Error
              ? e
              : new Error("The final recorder update could not be saved.");
        if (!isCurrent()) return stale();
        const message =
          e instanceof Error ? e.message : "Could not save the note.";
        // A lost PATCH response may still have saved. Refresh before another tool can write.
        try {
          const latestNote = await request<{ note: ShiftNote }>(
            `/api/notes/${session.note.id}`,
          );
          saved(session, latestNote.note);
        } catch {}
        await sessionRequest(session, { action: "invalidate" }).catch(() => {});
        setError(message);
        return JSON.stringify({
          ok: false,
          error: message,
          action:
            "Do not claim success. Refresh the saved draft and address the problem before continuing.",
        });
      }
    }).catch((e: unknown) =>
      isCurrent() ? JSON.stringify(recorderToolFailure(e)) : stale(),
    );
    return isCurrent() ? result : stale();
  }

  const conversation = useConversation({
    clientTools: {
      get_form_context: (params) => tool("get_form_context", params),
      search_participant_records: (params) =>
        tool("search_participant_records", params),
      register_followup: (params) => tool("register_followup", params),
      update_and_check_form: (params) => tool("update_and_check_form", params),
      prepare_confirmation: (params) => tool("prepare_confirmation", params),
      finalize_form: (params) => tool("finalize_form", params),
    },
    onConnect: ({ conversationId }) => {
      if (closing.current) return;
      const session = active.current;
      if (!session) {
        conversation.endSession();
        return;
      }
      if (conversationId !== session.conversationId) {
        fatal("The conversation could not be verified. Start again.");
        return;
      }
      clearTimer();
      setPhase("active");
    },
    onMessage: ({ role, message, event_id }) => {
      const session = active.current;
      if (!session || closing.current || (textOnly && role === "user")) return;
      if (role === "agent") setWaiting(false);
      void recordMessage(role, message, event_id).catch((e) => {
        if (active.current === session) fatal(e.message);
      });
    },
    onInterruption: () => invalidate(),
    onAgentResponseCorrection: () => invalidate(),
    onError: () => {
      if (!closing.current)
        fatal(
          "The conversation stopped. Your saved draft is safe; start again to continue.",
        );
    },
    onDisconnect: () => {
      void finish();
    },
  });

  useImperativeHandle(reviewControl, () => ({
    async finishForReview() {
      if (input.trim())
        throw new Error(
          "You have an unsent message. Send it or clear it before reviewing.",
        );
      const result = await finish();
      if (result.error) throw result.error;
      if (!result.note)
        throw new Error(
          "The conversation has ended. Select Review & confirm again to review the saved note.",
        );
      return result.note;
    },
  }));

  useEffect(
    () => () => {
      closing.current = true;
      clearTimer();
      const session = active.current;
      active.current = null;
      generation.current++;
      if (session)
        void queue.current
          .then(() => sessionRequest(session, { action: "close" }))
          .catch(() => {});
    },
    [],
  );

  function start() {
    if (locked.current || disabled || !signedIn) return;
    locked.current = true;
    closing.current = false;
    const run = ++generation.current;
    setPhase("starting");
    setError("");
    setMessages([]);
    history.current = [];
    setWaiting(false);
    latest.current.onActive(true);
    startup.current = Promise.resolve().then(async () => {
      try {
        // Permission is requested only after the worker presses Start voice note.
        if (!textOnly) {
          const permission = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          permission.getTracks().forEach((track) => track.stop());
        }
        if (run !== generation.current) return;
        const draft = await latest.current.prepareDraft();
        if (run !== generation.current) return;
        // Personalization must be available before the first message or tool call.
        const dynamicVariables = recorderDynamicVariables(draft);
        const data = await request<{
          sessionId: string;
          conversationId: string;
          conversationToken?: string;
          signedUrl?: string;
        }>("/api/voice/sessions", { noteId: draft.id, mode: selectedMode });
        if (run !== generation.current) {
          await request(`/api/voice/sessions/${data.sessionId}`, {
            action: "close",
          }).catch(() => {});
          return;
        }
        active.current = {
          id: data.sessionId,
          conversationId: data.conversationId,
          note: draft,
          sequence: 0,
          workerSequence: 0,
          interruptionGeneration: 0,
          generation: run,
        };
        queue.current = Promise.resolve();
        startupTimer.current = setTimeout(() => {
          if (generation.current === run)
            fatal("The conversation took too long. Please try again.");
        }, 25000);
        if (textOnly) {
          if (!data.signedUrl)
            throw new Error(
              "The text connection is unavailable. Please try again.",
            );
          conversation.startSession({
            signedUrl: data.signedUrl,
            connectionType: "websocket",
            textOnly: true,
            dynamicVariables,
          });
        } else {
          if (!data.conversationToken)
            throw new Error(
              "The voice connection is unavailable. Please try again.",
            );
          conversation.startSession({
            conversationToken: data.conversationToken,
            connectionType: "webrtc",
            dynamicVariables,
          });
        }
      } catch (e) {
        if (run === generation.current)
          fatal(
            e instanceof DOMException && e.name === "NotAllowedError"
              ? "Microphone access was denied. Allow microphone access for this site, then try again."
              : e instanceof Error
                ? e.message
                : "Could not start voice. Please try again.",
          );
      }
    });
  }
  return {
    signedIn,
    disabled,
    note,
    textOnly,
    available,
    phase,
    error,
    messages,
    input,
    setInput,
    sending,
    waiting,
    transcript,
    stop,
    sendText,
    conversation,
    start,
  };
}
