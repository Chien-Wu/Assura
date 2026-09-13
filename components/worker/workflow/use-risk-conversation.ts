"use client";
import type { ShiftNote } from "@/lib/notes/form";
import {
  workflowFormDefinitions,
  workflowRiskTypes,
  type WorkflowCase,
  type WorkflowFieldState,
  type WorkflowRiskType,
  type WorkflowSource,
} from "@/lib/workflow/case";
import { createWorkflowQueue } from "@/lib/workflow/queue";
import { useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";
type Snapshot = { case: WorkflowCase; context: unknown; reviewed?: boolean };
type Connection = {
  sessionId: string;
  caseId: string;
  conversationId: string;
  signedUrl?: string;
  conversationToken?: string;
  dynamicVariables: Record<string, string>;
};
type Message = { id: string; role: "user" | "agent"; text: string };
type Edit = {
  key: string;
  shared: boolean;
  label: string;
  value: string;
  state: WorkflowFieldState;
  eventId: string;
  risk: WorkflowRiskType;
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";
async function request<T>(
  url: string,
  body?: unknown,
  authorization?: string,
): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? "The request could not be completed.");
  return result as T;
}
export type Props = {
  note: ShiftNote;
  initialCase: WorkflowCase | null;
  initialReviewed: boolean;
};
export function useRiskConversation({
  note,
  initialCase,
  initialReviewed,
}: Props) {
  const [record, setRecord] = useState(initialCase);

  const [reviewed, setReviewed] = useState(initialReviewed);

  const [phase, setPhase] = useState<
    "ready" | "connecting" | "connected" | "stopping"
  >("ready");

  const [mode, setMode] = useState<"voice" | "text">("voice");

  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState("");

  const [error, setError] = useState("");

  const [pending, setPending] = useState(0);

  const [hasConnection, setHasConnection] = useState(false);

  const [risk, setRisk] = useState<WorkflowRiskType>("medication");

  const [eventIndex, setEventIndex] = useState(0);

  const [showEmpty, setShowEmpty] = useState(false);

  const [edit, setEdit] = useState<Edit | null>(null);

  const [node, setNode] = useState("Main");

  const recordRef = useRef(initialCase);

  const connectionRef = useRef<Connection | null>(null);

  const opening = useRef<Promise<Connection> | null>(null);

  const generation = useRef(0);

  const queue = useRef(createWorkflowQueue());

  const sourceFailure = useRef(false);

  const seen = useRef(new Set<string>());

  const transitions = useRef(0);

  const closing = useRef(false);

  const active = useRef(false);

  const modeRef = useRef(mode);

  const startup = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRef = useRef<() => Promise<void>>(async () => {});

  const conversationRef = useRef<ReturnType<typeof useConversation> | null>(
    null,
  );

  const transcriptEnd = useRef<HTMLDivElement>(null);

  const accept = useCallback((snapshot: Snapshot) => {
    if (
      !recordRef.current ||
      snapshot.case.revision >= recordRef.current.revision
    ) {
      recordRef.current = snapshot.case;
      setRecord(snapshot.case);
      setReviewed(snapshot.reviewed ?? false);
    }
    return snapshot;
  }, []);

  const refresh = useCallback(
    async (id: string) =>
      accept(await request<Snapshot>(`/api/workflow/cases/${id}`)),
    [accept],
  );

  function enqueue<T>(operation: () => Promise<T>) {
    setPending((value) => value + 1);
    return queue.current
      .run(operation)
      .finally(() => setPending((value) => value - 1));
  }

  function pushContext(context: unknown) {
    if (active.current)
      conversationRef.current?.sendContextualUpdate(
        `Current saved case (authoritative revision and worker evidence): ${JSON.stringify(context)}`,
        { contextId: "workflow_case" },
      );
  }

  async function addSource(source: WorkflowSource) {
    const current = recordRef.current;
    if (!current) throw new Error("Open a conversation before adding details.");
    // Refresh only on a concurrent edit, retaining the same immutable source ID.
    try {
      return accept(
        await request<Snapshot>(`/api/workflow/cases/${current.id}`, {
          action: "source",
          expected_revision: current.revision,
          source,
        }),
      );
    } catch (error) {
      const fresh = await refresh(current.id);
      if (fresh.case.revision === current.revision) throw error;
      return accept(
        await request<Snapshot>(`/api/workflow/cases/${current.id}`, {
          action: "source",
          expected_revision: fresh.case.revision,
          source,
        }),
      );
    }
  }

  function recordUtterance(text: string, id: string) {
    return enqueue(async () => {
      if (sourceFailure.current)
        throw new Error(
          "Some spoken details were not saved. End this conversation and review the transcript.",
        );
      const snapshot = await addSource({ id, kind: "worker_utterance", text });
      pushContext(snapshot.context);
    }).catch((error) => {
      sourceFailure.current = true;
      setError(
        `Your statement could not be saved: ${messageOf(error)} Copy the visible transcript before leaving.`,
      );
      void stopRef.current();
      throw error;
    });
  }

  async function bridge(kind: "context" | "save", parameters: unknown) {
    const connection = connectionRef.current;
    if (!connection)
      return JSON.stringify({
        ok: false,
        error: "Conversation ended. Do not claim a save.",
      });
    try {
      return await enqueue(async () => {
        if (sourceFailure.current)
          return JSON.stringify({
            ok: false,
            error:
              "Worker evidence could not be persisted. Ask the worker to review the visible transcript; do not claim saved.",
          });
        if (connectionRef.current?.sessionId !== connection.sessionId)
          return JSON.stringify({ ok: false, error: "Session changed." });
        const result = await request<{
          ok: boolean;
          context?: unknown;
          error?: string;
        }>(
          `/api/workflow/tools/${kind}`,
          kind === "save" ? parameters : undefined,
          connection.dynamicVariables.secret__workflow_token,
        );
        await refresh(connection.caseId);
        if (!result.ok)
          setError(
            result.error ??
              "A draft save needs correction. The conversation can retry with the current case.",
          );
        return JSON.stringify(result);
      });
    } catch (error) {
      setError(`The draft was not confirmed saved: ${messageOf(error)}`);
      return JSON.stringify({
        ok: false,
        error: messageOf(error),
        action:
          "Refresh current case once before retrying. Do not claim saved.",
      });
    }
  }

  const conversation = useConversation({
    clientTools: {
      get_case_context: () => bridge("context", undefined),
      save_risk_form: (parameters) => bridge("save", parameters),
    },
    onConnect: ({ conversationId }) => {
      if (startup.current) clearTimeout(startup.current);
      const expected = connectionRef.current?.conversationId;
      if (!expected || expected !== conversationId || closing.current) {
        setError(
          "The conversation identity could not be verified. Please reconnect.",
        );
        void stopRef.current();
        return;
      }
      active.current = true;
      setPhase("connected");
    },
    onDisconnect: () => {
      if (connectionRef.current) void stopRef.current();
    },
    onError: () => {
      setError(
        "The conversation connection was interrupted. End the conversation, check the saved drafts and reconnect.",
      );
      void stopRef.current();
    },
    onMessage: ({ role, message, event_id }) => {
      const connection = connectionRef.current;
      if (!connection || closing.current || !message.trim()) return;
      if (role === "user" && modeRef.current === "text") return;
      const id = `${connection.sessionId}:${role}:${event_id ?? crypto.randomUUID()}`;
      if (seen.current.has(id)) return;
      seen.current.add(id);
      setMessages((previous) => [...previous, { id, role, text: message }]);
      if (role === "user") {
        transitions.current = 0;
        void recordUtterance(message, id).catch(() => {});
      }
    },
    onAgentToolResponse: (response) => {
      if (
        response.tool_name !== "transfer_to_agent" ||
        !("full_tool_result" in response)
      )
        return;
      let value: { status?: string; to_node?: string };
      try {
        value =
          typeof response.full_tool_result === "string"
            ? JSON.parse(response.full_tool_result)
            : (response.full_tool_result as typeof value);
      } catch {
        return;
      }
      if (value?.status !== "success" || !value.to_node) return;
      const target = value.to_node;
      setNode(
        target === "main"
          ? "Main"
          : (workflowFormDefinitions[target as WorkflowRiskType]?.label ??
              "Risk conversation"),
      );
      if (workflowRiskTypes.includes(target as WorkflowRiskType))
        setRisk(target as WorkflowRiskType);
      if (++transitions.current > 8) {
        setError(
          "The conversation repeated a transition. Saved drafts are retained; please reconnect.",
        );
        void stopRef.current();
      }
    },
  });

  async function stop() {
    if (closing.current) return;
    closing.current = true;
    generation.current++;
    active.current = false;
    setPhase("stopping");
    if (startup.current) clearTimeout(startup.current);
    conversationRef.current?.endSession();
    await queue.current.drain();
    const lateConnection = await opening.current?.catch(() => null);
    const connection = connectionRef.current ?? lateConnection;
    try {
      if (connection) {
        await request(`/api/workflow/cases/${connection.caseId}`, {
          action: "close",
          sessionId: connection.sessionId,
        });
        connectionRef.current = null;
        setHasConnection(false);
        try {
          await refresh(connection.caseId);
        } catch {
          setError(
            "Conversation ended. This note may have moved to review; return to your shift notes to check it.",
          );
        }
      }
      connectionRef.current = null;
      setHasConnection(false);
    } catch (error) {
      setError(
        `Could not finish closing the session: ${messageOf(error)} Please press End conversation again.`,
      );
    } finally {
      closing.current = false;
      setPhase("ready");
    }
  }

  useEffect(() => {
    conversationRef.current = conversation;
    stopRef.current = stop;
  });

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (connectionRef.current || opening.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
      void stopRef.current();
    };
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [messages]);

  async function start() {
    if (
      phase !== "ready" ||
      pending ||
      connectionRef.current ||
      opening.current
    )
      return;
    const attempt = ++generation.current;
    setError("");
    setPhase("connecting");
    setNode("Main");
    setReviewed(false);
    sourceFailure.current = false;
    seen.current.clear();
    transitions.current = 0;
    modeRef.current = mode;
    try {
      opening.current = request<Connection>("/api/workflow/sessions", {
        noteId: note.id,
        mode,
      });
      const connection = await opening.current;
      if (attempt !== generation.current) return;
      connectionRef.current = connection;
      setHasConnection(true);
      await refresh(connection.caseId);
      if (attempt !== generation.current) return;
      startup.current = setTimeout(() => {
        setError(
          "Connecting took too long. Check microphone access and try again.",
        );
        void stopRef.current();
      }, 25000);
      if (mode === "text" && connection.signedUrl)
        conversation.startSession({
          signedUrl: connection.signedUrl,
          connectionType: "websocket",
          textOnly: true,
          dynamicVariables: connection.dynamicVariables,
        });
      else if (connection.conversationToken)
        conversation.startSession({
          conversationToken: connection.conversationToken,
          connectionType: "webrtc",
          dynamicVariables: connection.dynamicVariables,
        });
      else throw new Error("No conversation connection was provided.");
    } catch (error) {
      setError(messageOf(error));
      await stop();
    } finally {
      opening.current = null;
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || !active.current || pending || !connectionRef.current) return;
    const id = `${connectionRef.current.sessionId}:typed:${crypto.randomUUID()}`;
    setInput("");
    transitions.current = 0;
    setMessages((previous) => [...previous, { id, role: "user", text }]);
    try {
      await recordUtterance(text, id);
      if (active.current) conversation.sendUserMessage(text);
    } catch {
      /* The source failure remains visible and stops the session. */
    }
  }

  async function saveEdit() {
    if (!edit || pending) return;
    const chosen = edit;
    setError("");
    try {
      await enqueue(async () => {
        const sourceId = `edit:${crypto.randomUUID()}`;
        const snapshot = await addSource({
          id: sourceId,
          kind: "worker_form_edit",
          text:
            chosen.state === "known"
              ? chosen.value.trim()
              : chosen.state === "unknown"
                ? "Worker explicitly states this is unknown."
                : "Worker explicitly states this is not applicable.",
          field_path: `${chosen.shared ? "shared_fields" : chosen.risk}.${chosen.key}`,
        });
        const field = {
          value: chosen.state === "known" ? chosen.value.trim() : null,
          state: chosen.state,
          source_ids: [sourceId],
        };
        const saved = accept(
          await request<Snapshot>(`/api/workflow/cases/${snapshot.case.id}`, {
            action: "patch",
            expected_revision: snapshot.case.revision,
            patch: {
              risk_type: chosen.risk,
              event_id: chosen.eventId,
              expected_revision: snapshot.case.revision,
              fields_json: JSON.stringify({
                [chosen.shared ? "shared_fields" : "fields"]: {
                  [chosen.key]: field,
                },
              }),
            },
          }),
        );
        pushContext(saved.context);
        setEdit(null);
      });
    } catch (error) {
      setError(`The correction was not saved: ${messageOf(error)}`);
    }
  }

  async function review() {
    const current = recordRef.current;
    if (!current || phase !== "ready" || connectionRef.current || pending)
      return;
    try {
      await enqueue(async () =>
        accept(
          await request<Snapshot>(`/api/workflow/cases/${current.id}`, {
            action: "review",
            expected_revision: current.revision,
          }),
        ),
      );
    } catch (error) {
      setError(messageOf(error));
    }
  }
  return {
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
  };
}
