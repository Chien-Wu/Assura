"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  LoaderCircle,
  Check,
  MessageSquare,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  checkForm,
  definitions,
  incidentOptions,
  followUpOptions,
  type ShiftNote,
} from "@/lib/shift-form";
import {
  hasConfirmationPrompt,
  isVoiceConfirmation,
  type VoiceEvent,
  type ConversationMode,
} from "@/lib/voice-state";
import {
  agentFormResult,
  agentKnowledgeResult,
  agentNote,
  knowledgeFailure,
  parseAgentUpdate,
  toolSnapshotMatches,
} from "@/lib/agent-tools";

type Props = {
  signedIn: boolean;
  disabled: boolean;
  note: ShiftNote | null;
  prepareDraft: () => Promise<ShiftNote>;
  onSaved: (note: ShiftNote) => void;
  onActive: (active: boolean) => void;
};
type Session = {
  id: string;
  conversationId: string;
  note: ShiftNote;
  sequence: number;
  workerSequence: number;
  interruptionGeneration: number;
  generation: number;
};
type Pending = {
  confirmationId: string;
  revision: number;
  promptSequence: number | null;
  sawSpeaking: boolean;
  ready: boolean;
  confirmedSequence: number | null;
};
type ApiReview = { note: ShiftNote; confirmationId: string; summary: string };
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

export default function VoicePanel(props: Props) {
  const [attempt, setAttempt] = useState({
    key: 0,
    error: "",
    messages: [] as VoiceEvent[],
  });
  const [selectedMode, setSelectedMode] = useState<ConversationMode>("text");
  const [running, setRunning] = useState(false);
  return (
    <>
      <div
        className="conversation-mode"
        role="group"
        aria-label="Conversation mode"
      >
        <Button
          variant="ghost"
          disabled={running}
          aria-pressed={selectedMode === "text"}
          onClick={() => setSelectedMode("text")}
        >
          <MessageSquare size={16} />
          Text · Test mode
        </Button>
        <Button
          variant="ghost"
          disabled={running}
          aria-pressed={selectedMode === "voice"}
          onClick={() => setSelectedMode("voice")}
        >
          <Mic size={16} />
          Voice
        </Button>
      </div>
      <ConversationProvider key={attempt.key}>
        <VoiceControls
          {...props}
          selectedMode={selectedMode}
          initialError={attempt.error}
          initialMessages={attempt.messages}
          onActive={(value) => {
            setRunning(value);
            props.onActive(value);
          }}
          onReset={(error, messages) =>
            setAttempt((old) =>
              old.key === attempt.key
                ? { key: old.key + 1, error, messages }
                : old,
            )
          }
        />
      </ConversationProvider>
    </>
  );
}
function VoiceControls({
  signedIn,
  disabled,
  note,
  prepareDraft,
  onSaved,
  onActive,
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
  const [confirmReady, setConfirmReady] = useState(false);
  const [promptReceived, setPromptReceived] = useState(false);
  const active = useRef<Session | null>(null);
  const pending = useRef<Pending | null>(null);
  const generation = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ onSaved, onActive, prepareDraft });
  const locked = useRef(false);
  const closing = useRef(false);
  const startup = useRef<Promise<void>>(Promise.resolve());
  const mode = useRef("listening");
  const readinessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    queue.current = work.catch(() => {});
    return work;
  }
  function saved(session: Session, value: ShiftNote) {
    session.note = value;
    if (active.current === session) latest.current.onSaved(value);
  }
  function clearPending() {
    pending.current = null;
    setConfirmReady(false);
    setPromptReceived(false);
    if (readinessTimer.current) {
      clearTimeout(readinessTimer.current);
      readinessTimer.current = null;
    }
  }
  function clearTimer() {
    if (startupTimer.current) {
      clearTimeout(startupTimer.current);
      startupTimer.current = null;
    }
  }
  function finish(message = "") {
    if (closing.current || !locked.current) return;
    closing.current = true;
    generation.current++;
    clearTimer();
    clearPending();
    setPhase("stopping");
    conversation.endSession();
    // Drain admitted saves and startup before remounting the SDK provider. Its old
    // pending connections/callbacks must never be shared with the next attempt.
    void (async () => {
      await startup.current.catch(() => {});
      await queue.current.catch(() => {});
      const session = active.current;
      if (session) {
        await sessionRequest(session, { action: "close" }).catch(() => {});
        try {
          const result = await request<{ note: ShiftNote }>(
            `/api/notes/${session.note.id}`,
          );
          saved(session, result.note);
        } catch {}
      }
      active.current = null;
      latest.current.onActive(false);
      onReset(message, history.current);
    })();
  }
  function stop() {
    finish();
  }
  function fatal(message: string) {
    setError(message);
    finish(message);
  }
  function invalidate() {
    const session = active.current;
    if (!session || closing.current) return;
    session.interruptionGeneration++;
    clearPending();
    const event: VoiceEvent = {
      sequence: ++session.sequence,
      kind: "interrupt",
      text: "Readback interrupted or corrected",
    };
    void enqueue(session, () =>
      sessionRequest(session, { action: "event", event }),
    ).catch((e) => {
      if (active.current === session) fatal(e.message);
    });
  }
  function markReady() {
    const session = active.current;
    const review = pending.current;
    if (
      closing.current ||
      !session ||
      !review ||
      review.ready ||
      (!textOnly && !review.sawSpeaking) ||
      !review.promptSequence
    )
      return;
    review.ready = true;
    void enqueue(session, () =>
      sessionRequest(session, {
        action: "readback",
        confirmationId: review.confirmationId,
        sequence: review.promptSequence,
      }),
    )
      .then(() => {
        if (active.current === session && pending.current === review)
          setConfirmReady(true);
      })
      .catch(() => {
        if (active.current === session) {
          clearPending();
          setError(
            "The review was interrupted. Ask the assistant to read it again, or end the call and confirm on screen.",
          );
        }
      });
  }
  function scheduleReady() {
    if (readinessTimer.current) clearTimeout(readinessTimer.current);
    readinessTimer.current = setTimeout(() => {
      if (mode.current === "listening") markReady();
    }, 650);
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
    const review = pending.current;
    if (role === "agent" && review && hasConfirmationPrompt(message)) {
      review.promptSequence = event.sequence;
      setPromptReceived(true);
    }
    if (role === "user" && review) {
      if (review.ready && isVoiceConfirmation(message))
        review.confirmedSequence = event.sequence;
      else clearPending();
    }
    return enqueue(session, async () => {
      const result = await sessionRequest<{
        note?: ShiftNote;
        remainingClarifications?: number;
        riskFlags?: unknown;
        escalation?: unknown;
        coverage?: unknown;
        questions?: unknown;
      }>(session, { action: "event", event });
      if (result.note) saved(session, result.note);
      if (active.current === session && !closing.current)
        conversation.sendContextualUpdate(
          JSON.stringify({
            captureSafety: {
              remainingClarifications: result.remainingClarifications,
              riskFlags: result.riskFlags,
              escalation: result.escalation,
              coverage: result.coverage,
              questions: result.questions,
            },
          }),
        );
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
      note?.status === "complete" ||
      (pending.current?.promptSequence && !confirmReady)
    )
      return;
    sendLock.current = true;
    setSending(true);
    setError("");
    try {
      // Typed turns are not echoed locally by the SDK. Persist once before the
      // Agent can act on them, including an explicit confirmation or correction.
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
        knowledgeFailure(new Error("This conversation has ended."), "stale"),
      );
    const isCurrent = () =>
      active.current === session &&
      !closing.current &&
      session.generation === generation.current;
    const snapshot = () => ({
      revision: session.note.revision,
      workerSequence: session.workerSequence,
      interruptionGeneration: session.interruptionGeneration,
    });
    const stale = () =>
      JSON.stringify(
        knowledgeFailure(
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
        const bound = snapshot();
        let participantContext: unknown;
        try {
          // Historical reads must not occupy the transcript/save queue. A new
          // worker turn can persist while this request is in flight.
          participantContext = agentKnowledgeResult(
            await request<Record<string, unknown>>(
              `/api/notes/${session.note.id}/knowledge/context`,
            ),
          );
        } catch (e) {
          participantContext = knowledgeFailure(e);
        }
        if (!isCurrent() || !toolSnapshotMatches(bound, snapshot()))
          return stale();
        return JSON.stringify({
          ok: true,
          ...agentFormResult(result),
          participantContext,
          definitions,
          incidentOptions,
          followUpOptions,
          validation: checkForm(result.note.fields),
          currentLocalTime: new Date().toLocaleString("en-AU", {
            timeZone: result.note.timezone,
          }),
        });
      } catch (e) {
        return isCurrent() ? JSON.stringify(knowledgeFailure(e)) : stale();
      }
    }
    if (name === "search_participant_records" || name === "register_followup") {
      try {
        // The barrier includes all previously admitted transcript/form saves;
        // the slower lookup runs outside that serial queue.
        const bound = await enqueue(session, async () => snapshot());
        if (!isCurrent()) return stale();
        const result = await request<Record<string, unknown>>(
          name === "search_participant_records"
            ? `/api/notes/${session.note.id}/knowledge/search`
            : `/api/notes/${session.note.id}/interview/questions`,
          name === "search_participant_records"
            ? {
                query: params.query,
                currentTurnQuote: params.current_turn_quote,
                revision: bound.revision,
                voiceSessionId: session.id,
              }
            : {
                retrievalId: params.retrieval_id,
                sourceIds: params.source_ids,
                purposeKey: params.purpose_key,
                question: params.question,
                revision: bound.revision,
                voiceSessionId: session.id,
              },
        );
        if (!isCurrent() || !toolSnapshotMatches(bound, snapshot()))
          return stale();
        return JSON.stringify({
          ok:
            (name === "register_followup" ||
              ["ok", "partial", "no_match"].includes(String(result.status))) &&
            result.ok !== false,
          ...agentKnowledgeResult(result),
        });
      } catch (e) {
        // Retrieval errors do not invalidate a readback or discard saved work.
        return isCurrent() ? JSON.stringify(knowledgeFailure(e)) : stale();
      }
    }
    const result = await enqueue(session, async () => {
      try {
        if (name === "update_and_check_form") {
          clearPending();
          await sessionRequest(session, { action: "invalidate" });
          const update = parseAgentUpdate(params.fields_json);
          const result = await request<FormResult>(
            `/api/notes/${session.note.id}`,
            {
              revision: session.note.revision,
              ...update,
              voiceSessionId: session.id,
            },
            "PATCH",
          );
          saved(session, result.note);
          return JSON.stringify({
            ok: true,
            ...agentFormResult(result),
            validation: checkForm(result.note.fields),
          });
        }
        if (name === "prepare_confirmation") {
          clearPending();
          const result = await request<ApiReview>(
            `/api/notes/${session.note.id}/review`,
            { revision: session.note.revision },
          );
          await sessionRequest(session, {
            action: "prepare",
            confirmationId: result.confirmationId,
            revision: result.note.revision,
          });
          saved(session, result.note);
          pending.current = {
            confirmationId: result.confirmationId,
            revision: result.note.revision,
            promptSequence: null,
            sawSpeaking: false,
            ready: false,
            confirmedSequence: null,
          };
          return JSON.stringify({
            ok: true,
            ...agentFormResult(result),
            instruction:
              "Read back every saved field, uncertainty, restrictive practice and supervisor flag in the summary. Not yet reviewed is not an absence. Do not ask the worker to classify events. Finish by saying: To save this note, say I confirm this shift note, or tell me what to change. Wait for a new answer before calling finalize_form.",
          });
        }
        if (name === "finalize_form") {
          const review = pending.current;
          if (
            !review ||
            !review.ready ||
            !review.confirmedSequence ||
            params.confirmationId !== review.confirmationId ||
            review.revision !== session.note.revision
          )
            throw new Error(
              "No new explicit confirmation after the current review. Read the saved note again and ask the worker to say: I confirm this shift note.",
            );
          const result = await request<{ note: ShiftNote }>(
            `/api/notes/${session.note.id}/confirm`,
            {
              revision: review.revision,
              confirmationId: review.confirmationId,
              confirmed: true,
              voiceSessionId: session.id,
            },
          );
          saved(session, result.note);
          clearPending();
          return JSON.stringify({
            ok: true,
            note: agentNote(result.note),
            message:
              "The confirmed note is saved. Tell the worker it is complete; they can end this call.",
          });
        }
        throw new Error("Unknown LegalMate tool.");
      } catch (e) {
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
        clearPending();
        await sessionRequest(session, { action: "invalidate" }).catch(() => {});
        setError(message);
        return JSON.stringify({
          ok: false,
          error: message,
          action:
            "Do not claim success. Address the problem, then prepare a fresh review before confirmation.",
        });
      }
    }).catch((e: unknown) =>
      isCurrent() ? JSON.stringify(knowledgeFailure(e)) : stale(),
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
      const persisted = recordMessage(role, message, event_id);
      void persisted
        .then(() => {
          if (active.current !== session || closing.current) return;
          if (textOnly && role === "agent") markReady();
          else if (role === "agent" && mode.current === "listening")
            scheduleReady();
        })
        .catch((e) => {
          if (active.current === session) fatal(e.message);
        });
    },
    onModeChange: ({ mode: value }) => {
      if (closing.current || textOnly) return;
      mode.current = value;
      const review = pending.current;
      if (value === "speaking") {
        if (readinessTimer.current) clearTimeout(readinessTimer.current);
        if (review) review.sawSpeaking = true;
      } else scheduleReady();
    },
    onInterruption: () => invalidate(),
    onAgentResponseCorrection: () => invalidate(),
    onError: () => {
      if (!closing.current)
        fatal(
          "The conversation stopped. Your saved draft is safe; start again to continue.",
        );
    },
    onDisconnect: () => finish(),
  });
  useEffect(
    () => () => {
      closing.current = true;
      clearTimer();
      if (readinessTimer.current) clearTimeout(readinessTimer.current);
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
    clearPending();
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
          });
        } else {
          if (!data.conversationToken)
            throw new Error(
              "The voice connection is unavailable. Please try again.",
            );
          conversation.startSession({
            conversationToken: data.conversationToken,
            connectionType: "webrtc",
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
  return (
    <div className={`voice-intro voice-live ${textOnly ? "text-mode" : ""}`}>
      <div
        className={`mic-symbol ${note?.status === "complete" ? "done" : ""}`}
        data-phase={note?.status === "complete" ? "done" : phase}
      >
        {note?.status === "complete" ? (
          <Check size={35} />
        ) : textOnly ? (
          <MessageSquare size={32} />
        ) : (
          <Mic size={35} />
        )}
      </div>
      <h2>
        {phase === "starting"
          ? "Connecting…"
          : note?.status === "complete"
            ? "Your note is saved."
            : textOnly
              ? "Type through your shift."
              : phase === "active"
                ? conversation.isSpeaking
                  ? "Your assistant is speaking"
                  : "Tell me about your shift"
                : "Let’s talk through your shift."}
      </h2>
      <p>
        {note?.status === "complete"
          ? "Your confirmed note is ready in Review notes."
          : textOnly
            ? "Your messages and the assistant’s questions are recorded and retained with your note. The original transcript protects what you disclosed, even if the note is edited."
            : phase === "active"
              ? "Your answers are saved into the form as you speak."
              : "This conversation’s transcript is recorded and retained with your note, protecting what you disclosed if the note is edited. Audio is sent to ElevenLabs. Use fictional details."}
      </p>
      {phase === "idle" ? (
        <Button
          className="voice-button"
          disabled={
            !available || !signedIn || disabled || note?.status === "complete"
          }
          onClick={start}
        >
          {textOnly ? <MessageSquare size={18} /> : <Mic size={18} />}{" "}
          {textOnly ? "Start text note" : "Start voice note"}
        </Button>
      ) : (
        <div className="call-buttons">
          <Button
            className="voice-button"
            disabled={phase === "stopping"}
            onClick={stop}
          >
            <PhoneOff size={17} />
            {phase === "stopping"
              ? "Ending…"
              : textOnly
                ? "End conversation"
                : "End call"}
          </Button>
          {!textOnly && phase === "active" && (
            <Button
              variant="outline"
              className="voice-button"
              onClick={() => conversation.setMuted(!conversation.isMuted)}
              aria-label={
                conversation.isMuted ? "Unmute microphone" : "Mute microphone"
              }
            >
              {conversation.isMuted ? <MicOff size={17} /> : <Mic size={17} />}
            </Button>
          )}
        </div>
      )}
      <p className="voice-caption" aria-live="polite">
        {phase === "starting" ? (
          <>
            <LoaderCircle className="spin inline" size={14} /> Connecting
            securely
          </>
        ) : phase === "stopping" ? (
          "Finishing saved updates…"
        ) : phase === "active" ? (
          confirmReady ? (
            `Review the note, then ${textOnly ? "type" : "say"}: I confirm this shift note.`
          ) : textOnly ? (
            waiting ? (
              "Waiting for the assistant…"
            ) : (
              "Connected · Type below"
            )
          ) : conversation.isMuted ? (
            "Microphone muted"
          ) : (
            "Call connected"
          )
        ) : available === null ? (
          "Checking connection…"
        ) : !available ? (
          "Conversation setup pending"
        ) : !signedIn ? (
          "Sign in to start"
        ) : textOnly ? (
          "English · No microphone needed · Use fictional details"
        ) : (
          "English · Up to 10 minutes per call"
        )}
      </p>
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
      {messages.length > 0 && (
        <div
          className="voice-transcript"
          ref={transcript}
          role="log"
          aria-label="Conversation transcript"
          aria-live="polite"
        >
          {messages.map((message) => (
            <p key={message.sequence} data-kind={message.kind}>
              <strong>{message.kind === "user" ? "You" : "Assistant"}</strong>
              {message.text}
            </p>
          ))}
        </div>
      )}
      {textOnly && phase === "active" && note?.status !== "complete" && (
        <form
          className="text-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendText();
          }}
        >
          <label htmlFor="conversation-message">Your message</label>
          <Textarea
            id="conversation-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={6000}
            rows={3}
            disabled={sending}
            placeholder="Tell me about your shift…"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void sendText();
              }
            }}
          />
          <div>
            <span>Enter to send · Shift + Enter for a new line</span>
            <Button
              type="submit"
              className="voice-button"
              disabled={
                sending ||
                waiting ||
                !input.trim() ||
                (promptReceived && !confirmReady)
              }
            >
              {sending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
