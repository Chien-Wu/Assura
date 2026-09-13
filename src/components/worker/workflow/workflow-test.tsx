"use client";
import {
  workflowFormDefinitions,
  workflowRiskTypes,
  workflowSharedFieldDefinitions,
  type WorkflowField,
  type WorkflowFieldState,
  type WorkflowRiskType,
} from "@/lib/workflow/case";
import { ConversationProvider } from "@elevenlabs/react";
import {
  ArrowLeft,
  AudioLines,
  Check,
  LoaderCircle,
  Mic,
  Pencil,
  Send,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useRiskConversation, type Props } from "./use-risk-conversation";
import styles from "./workflow-test.module.css";
const blank: WorkflowField = {
  value: null,
  state: "not_discussed",
  source_ids: [],
};
export default function WorkflowTest(props: Props) {
  return (
    <ConversationProvider>
      <RiskConversation {...props} />
    </ConversationProvider>
  );
}
function RiskConversation(props: Parameters<typeof useRiskConversation>[0]) {
  const {
    note,
    record,
    reviewed,
    phase,
    mode,
    setMode,
    messages,
    input,
    setInput,
    error,
    setError,
    pending,
    hasConnection,
    risk,
    setRisk,
    eventIndex,
    setEventIndex,
    showEmpty,
    setShowEmpty,
    edit,
    setEdit,
    node,
    connectionRef,
    transcriptEnd,
    conversation,
    stop,
    start,
    send,
    saveEdit,
    review,
  } = useRiskConversation(props);

  const event = record?.events[eventIndex] ?? record?.events[0];

  const form = event?.risk_forms[risk];

  const live = phase !== "ready";

  const count =
    record?.events.reduce(
      (total, item) => total + Object.keys(item.risk_forms).length,
      0,
    ) ?? 0;

  function fields(
    definitions: Record<string, string>,
    values: Record<string, WorkflowField> | undefined,
    shared: boolean,
  ) {
    const entries = Object.entries(definitions).filter(
      ([key]) =>
        showEmpty || (values?.[key] && values[key].state !== "not_discussed"),
    );
    return entries.length ? (
      <dl className={styles.fields}>
        {entries.map(([key, label]) => {
          const field = values?.[key] ?? blank;
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <span>
                  {field.value ??
                    (field.state === "unknown"
                      ? "Explicitly unknown"
                      : field.state === "not_applicable"
                        ? "Not applicable"
                        : "Not discussed")}
                </span>
                <button
                  aria-label={`Edit ${label}`}
                  disabled={
                    !event ||
                    pending > 0 ||
                    phase === "connecting" ||
                    phase === "stopping"
                  }
                  onClick={() =>
                    setEdit({
                      key,
                      label,
                      shared,
                      value: field.value ?? "",
                      state:
                        field.state === "not_discussed" ? "known" : field.state,
                      eventId: event!.id,
                      risk: shared
                        ? (Object.keys(
                            event!.risk_forms,
                          )[0] as WorkflowRiskType)
                        : risk,
                    })
                  }
                >
                  <Pencil size={14} />
                </button>
              </dd>
              {field.source_ids.length > 0 && (
                <details>
                  <summary>Worker evidence</summary>
                  {field.source_ids.map((id) => (
                    <p key={id}>
                      {record?.sources.find((source) => source.id === id)
                        ?.text ?? "Source unavailable"}
                    </p>
                  ))}
                </details>
              )}
            </div>
          );
        })}
      </dl>
    ) : (
      <p className={styles.empty}>
        Details will appear here as the conversation saves them.
      </p>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link
          href="/worker"
          onClick={(event) => {
            if (live || pending || connectionRef.current) {
              event.preventDefault();
              setError(
                "End the conversation and wait for saving before returning to your shift.",
              );
            }
          }}
        >
          <ArrowLeft size={17} /> Back to shift notes
        </Link>
        <span>
          <AudioLines size={19} /> LegalMate
        </span>
      </header>
      <main className={styles.main}>
        <div className={styles.title}>
          <div>
            <p className={styles.eyebrow}>RISK CONVERSATION · TEST</p>
            <h1>Talk it through. Keep the details.</h1>
            <p>
              {note.fields.participant || "Your participant"} · Use fictional
              details for this test.
            </p>
          </div>
          <span className={styles.badge}>
            {count} saved {count === 1 ? "form" : "forms"}
          </span>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button aria-label="Dismiss message" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <div className={styles.columns}>
          <section className={styles.conversation} aria-label="Conversation">
            <div className={styles.cardHeading}>
              <h2>Your conversation</h2>
              <span className={styles.status}>
                {phase === "connected"
                  ? conversation.isSpeaking
                    ? "Speaking"
                    : "Listening"
                  : phase === "connecting"
                    ? "Connecting…"
                    : phase === "stopping"
                      ? "Finishing…"
                      : "Ready"}
              </span>
            </div>
            <p className={styles.subtle}>
              One conversation, with focused questions when more detail is
              needed.
            </p>
            <div className={styles.modes}>
              <button
                aria-pressed={mode === "voice"}
                disabled={live}
                onClick={() => setMode("voice")}
              >
                <Mic size={16} /> Voice
              </button>
              <button
                aria-pressed={mode === "text"}
                disabled={live}
                onClick={() => setMode("text")}
              >
                Text
              </button>
            </div>
            <div className={styles.transcript} role="log" aria-live="polite">
              {messages.length === 0 && (
                <div className={styles.welcome}>
                  <AudioLines size={36} />
                  <h3>Start with what happened.</h3>
                  <p>You can pause, correct a detail, or ask to move on.</p>
                </div>
              )}
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? styles.workerMessage
                      : styles.agentMessage
                  }
                >
                  <strong>
                    {message.role === "user" ? "You" : "LegalMate"}
                  </strong>
                  <p>{message.text}</p>
                </div>
              ))}
              <div ref={transcriptEnd} />
            </div>
            <div className={styles.sessionMeta}>
              <span>{node === "Main" ? "Shift conversation" : node}</span>
              <span>
                {pending ? (
                  <>
                    <LoaderCircle size={13} className={styles.spin} /> Saving
                    details…
                  </>
                ) : record ? (
                  `Saved revision ${record.revision}`
                ) : (
                  "No details saved yet"
                )}
              </span>
            </div>
            {mode === "text" && (
              <form
                className={styles.composer}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <label className={styles.srOnly} htmlFor="workflow-message">
                  Your message
                </label>
                <textarea
                  id="workflow-message"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Tell LegalMate what happened…"
                  disabled={phase !== "connected"}
                  maxLength={12000}
                />
                <button
                  aria-label="Send message"
                  disabled={
                    phase !== "connected" || pending > 0 || !input.trim()
                  }
                >
                  <Send size={18} />
                </button>
              </form>
            )}
            <button
              className={styles.primary}
              disabled={phase === "stopping" || (!live && pending > 0)}
              onClick={() =>
                void (live || connectionRef.current ? stop() : start())
              }
            >
              {live || hasConnection ? (
                <>
                  <Square size={16} /> End conversation
                </>
              ) : (
                <>
                  <Mic size={17} /> Start {mode === "voice" ? "voice" : "text"}{" "}
                  conversation
                </>
              )}
            </button>
            <p className={styles.footnote}>
              Saved as risk form drafts. Review these details before using them
              in a record.
            </p>
          </section>
          <section className={styles.forms} aria-label="Risk form drafts">
            <div className={styles.cardHeading}>
              <h2>Risk form drafts</h2>
              <span className={styles.status}>
                {reviewed ? "Reviewed" : "For your review"}
              </span>
            </div>
            <div
              className={styles.risks}
              role="tablist"
              aria-label="Risk categories"
            >
              {workflowRiskTypes.map((type) => (
                <button
                  role="tab"
                  aria-selected={risk === type}
                  aria-controls="workflow-risk-fields"
                  id={`tab-${type}`}
                  key={type}
                  onClick={() => setRisk(type)}
                >
                  {workflowFormDefinitions[type].label}
                  {record?.events.some((item) => item.risk_forms[type]) && (
                    <Check size={13} />
                  )}
                </button>
              ))}
            </div>
            {(record?.events.length ?? 0) > 1 && (
              <label className={styles.eventSelect}>
                Event{" "}
                <select
                  value={eventIndex}
                  onChange={(event) =>
                    setEventIndex(Number(event.target.value))
                  }
                >
                  {record!.events.map((item, index) => (
                    <option key={item.id} value={index}>
                      Event {index + 1} —{" "}
                      {item.shared_fields.what_happened?.value?.slice(0, 55) ??
                        "Reported event"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={styles.formToolbar}>
              <h3>{workflowFormDefinitions[risk].label}</h3>
              <label>
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={(event) => setShowEmpty(event.target.checked)}
                />{" "}
                Show unasked fields
              </label>
            </div>
            <div
              id="workflow-risk-fields"
              role="tabpanel"
              aria-labelledby={`tab-${risk}`}
              className={styles.formBody}
            >
              {event ? (
                <>
                  <h4>Shared event details</h4>
                  {fields(
                    workflowSharedFieldDefinitions,
                    event.shared_fields,
                    true,
                  )}
                  <h4>Specific details</h4>
                  {fields(
                    workflowFormDefinitions[risk].fields,
                    form?.fields,
                    false,
                  )}
                </>
              ) : (
                <div className={styles.emptyState}>
                  <h3>The right form, when it’s needed.</h3>
                  <p>
                    Start a conversation. When a risk comes up, the relevant
                    draft appears here with the worker’s supporting words.
                  </p>
                </div>
              )}
            </div>
            <div className={styles.reviewBar}>
              <p>
                {form?.followup_status === "deferred"
                  ? "Further questions deferred at the worker’s request."
                  : "You can edit any saved detail using the pencil."}
              </p>
              <button
                disabled={
                  live || pending > 0 || !count || reviewed || hasConnection
                }
                onClick={() => void review()}
              >
                {reviewed ? (
                  <>
                    <Check size={16} /> Details reviewed
                  </>
                ) : (
                  "Mark risk details reviewed"
                )}
              </button>
              <small>
                This reviews the risk drafts only; your shift note remains a
                draft.
              </small>
            </div>
          </section>
        </div>
      </main>
      {edit && (
        <div className={styles.overlay}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <h2 id="edit-title">{edit.label}</h2>
            <label>
              Answer status
              <select
                value={edit.state}
                onChange={(event) =>
                  setEdit({
                    ...edit,
                    state: event.target.value as WorkflowFieldState,
                  })
                }
              >
                <option value="known">Known</option>
                <option value="unknown">Explicitly unknown</option>
                <option value="not_applicable">Not applicable</option>
              </select>
            </label>
            {edit.state === "known" && (
              <label>
                Your correction
                <textarea
                  autoFocus
                  value={edit.value}
                  maxLength={6000}
                  onChange={(event) =>
                    setEdit({ ...edit, value: event.target.value })
                  }
                />
              </label>
            )}
            <p>
              Your correction is saved with its source and shared with the
              conversation.
            </p>
            <div>
              <button disabled={pending > 0} onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button
                className={styles.primary}
                disabled={
                  pending > 0 || (edit.state === "known" && !edit.value.trim())
                }
                onClick={() => void saveEdit()}
              >
                Save correction
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
