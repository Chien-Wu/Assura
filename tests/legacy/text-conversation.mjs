// Historical recorder protocol; see tests/legacy/README.md.
if (process.env.LEGALMATE_TEST_LEGACY_PROTOCOL !== "1")
  throw new Error(
    "Retired protocol: see tests/legacy/README.md before opting in.",
  );

// Optional live test: runs one real text conversation using fictional details.
// Requires the local preview and matching six-tool Agent configuration; uses
// Agent credits. Do not opt in until the local prompt/tool artifact is deployed.
import assert from "node:assert/strict";
import {
  loadAssignedTestShift,
  loadTestSession,
} from "../support/session-fixture.mjs";
import { randomUUID } from "node:crypto";
import { Conversation } from "@elevenlabs/client";
import {
  checkForm,
  definitions,
  incidentOptions,
  followUpOptions,
} from "../../lib/shift-form.ts";
import { hasConfirmationPrompt } from "../../lib/voice-state.ts";
import {
  agentFormResult,
  agentKnowledgeResult,
  agentNote,
  knowledgeFailure,
  parseAgentUpdate,
  toolSnapshotMatches,
} from "../../lib/agent-tools.ts";
if (process.env.LEGALMATE_TEST_MATCHING_AGENT_CONFIG !== "1")
  throw new Error(
    "Live Agent test not started. First apply the matching six-tool configuration and prompt, then explicitly set LEGALMATE_TEST_MATCHING_AGENT_CONFIG=1. This test makes real Agent calls and uses credits.",
  );
const origin = process.env.LEGALMATE_TEST_ORIGIN || "http://localhost:5173";
const cookie = await loadTestSession(origin);
const shift = await loadAssignedTestShift(origin, cookie, {
  environment: "LEGALMATE_TEST_TEXT_SHIFT_ID",
  participantName: "Sarah Doyle",
});
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(18000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
let note = (await api("/api/notes", { id: randomUUID(), shiftId: shift.id }))
  .note;
console.log(JSON.stringify({ testNoteId: note.id }));
assert.equal(note.fields.participant, "Sarah Doyle");
const session = await api("/api/voice/sessions", {
  noteId: note.id,
  mode: "text",
});
assert.equal(session.mode, "text");
assert.ok(session.signedUrl);
assert.equal(session.conversationToken, undefined);
const path = `/api/voice/sessions/${session.sessionId}`;
let queue = Promise.resolve(),
  sequence = 0,
  workerSequence = 0,
  interruptionGeneration = 0,
  active = true,
  review = null,
  stage = 0,
  toolCalls = 0,
  conversation,
  failed,
  lastActivity = Date.now();
const promptedStages = new Set();
let complete, fail;
const done = new Promise((resolve, reject) => {
  complete = resolve;
  fail = reject;
});
const deadline = setTimeout(
  () => fail(new Error("Text conversation timed out")),
  120000,
);
const followUp = setInterval(() => {
  if (
    conversation &&
    stage < 2 &&
    !review &&
    checkForm(note.fields).ready &&
    Date.now() - lastActivity > 12000 &&
    !promptedStages.has(stage)
  ) {
    promptedStages.add(stage);
    lastActivity = Date.now();
    console.log(
      JSON.stringify({
        followUp:
          "Requesting the review after the Agent stopped at announcing it",
      }),
    );
    void enqueue(() =>
      send(
        "Please prepare the current saved note for confirmation and show the full review now.",
      ),
    ).catch(() => {});
  }
}, 1000);
const enqueue = (job) => {
  const work = queue.then(job);
  queue = work.catch((error) => {
    failed = error;
    fail(error);
  });
  return work;
};
const record = async (kind, text) => {
  if (!active) throw new Error("This test conversation has ended.");
  const event = { sequence: ++sequence, kind, text };
  if (kind === "user") workerSequence = event.sequence;
  const result = await api(path, {
    action: "event",
    event,
  });
  if (result.note) note = result.note;
  conversation?.sendContextualUpdate(
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
};
const send = async (text) => {
  await record("user", text);
  conversation.sendUserMessage(text);
};
function tool(name, run) {
  return (params) =>
    enqueue(async () => {
      if (++toolCalls > 25) throw new Error("Tool budget exceeded");
      if (!active)
        return JSON.stringify(
          knowledgeFailure(
            new Error("This test conversation has ended."),
            "stale",
          ),
        );
      lastActivity = Date.now();
      console.log(JSON.stringify({ tool: name }));
      return JSON.stringify(await run(params));
    });
}
const snapshot = () => ({
  revision: note.revision,
  workerSequence,
  interruptionGeneration,
});
const staleHistory = () =>
  knowledgeFailure(
    new Error(
      "Worker account, note revision or session changed; refresh context before using history.",
    ),
    "stale",
  );
function historyTool(name, run) {
  return async (params) => {
    try {
      const bound = await enqueue(async () => {
        if (++toolCalls > 25) throw new Error("Tool budget exceeded");
        lastActivity = Date.now();
        console.log(JSON.stringify({ tool: name }));
        return snapshot();
      });
      if (!active) return JSON.stringify(staleHistory());
      // The lookup cannot hold up the persisted worker/assistant event queue.
      const result = await run(params, bound);
      return JSON.stringify(
        active && toolSnapshotMatches(bound, snapshot())
          ? result
          : staleHistory(),
      );
    } catch (error) {
      return JSON.stringify(active ? knowledgeFailure(error) : staleHistory());
    }
  };
}
const invalidate = () => {
  if (!active) return;
  interruptionGeneration++;
  review = null;
  void enqueue(() =>
    record("interrupt", "Readback interrupted or corrected"),
  ).catch(() => {});
};
try {
  conversation = await Conversation.startSession({
    signedUrl: session.signedUrl,
    connectionType: "websocket",
    textOnly: true,
    clientTools: {
      get_form_context: historyTool("get_form_context", async (_, bound) => {
        const result = await api(`/api/notes/${note.id}`);
        if (!active || !toolSnapshotMatches(bound, snapshot()))
          return staleHistory();
        note = result.note;
        let participantContext;
        try {
          participantContext = agentKnowledgeResult(
            await api(`/api/notes/${note.id}/knowledge/context`),
          );
        } catch (error) {
          participantContext = knowledgeFailure(error);
        }
        return {
          ok: true,
          ...agentFormResult(result),
          participantContext,
          definitions,
          incidentOptions,
          followUpOptions,
          validation: checkForm(note.fields),
          currentLocalTime: new Date().toLocaleString("en-AU", {
            timeZone: note.timezone,
          }),
        };
      }),
      search_participant_records: historyTool(
        "search_participant_records",
        async (params, bound) => {
          const result = await api(`/api/notes/${note.id}/knowledge/search`, {
            query: params.query,
            currentTurnQuote: params.current_turn_quote,
            revision: bound.revision,
            voiceSessionId: session.sessionId,
          });
          return {
            ok:
              ["ok", "partial", "no_match"].includes(result.status) &&
              result.ok !== false,
            ...agentKnowledgeResult(result),
          };
        },
      ),
      register_followup: historyTool(
        "register_followup",
        async (params, bound) => {
          const result = await api(
            `/api/notes/${note.id}/interview/questions`,
            {
              retrievalId: params.retrieval_id,
              sourceIds: params.source_ids,
              purposeKey: params.purpose_key,
              question: params.question,
              revision: bound.revision,
              voiceSessionId: session.sessionId,
            },
          );
          return { ok: result.ok !== false, ...agentKnowledgeResult(result) };
        },
      ),
      update_and_check_form: tool("update_and_check_form", async (params) => {
        review = null;
        await api(path, { action: "invalidate" });
        const update = parseAgentUpdate(params.fields_json);
        const result = await api(
          `/api/notes/${note.id}`,
          {
            revision: note.revision,
            ...update,
            voiceSessionId: session.sessionId,
          },
          "PATCH",
        );
        note = result.note;
        return {
          ok: true,
          ...agentFormResult(result),
          validation: checkForm(note.fields),
        };
      }),
      prepare_confirmation: tool("prepare_confirmation", async () => {
        review = await api(`/api/notes/${note.id}/review`, {
          revision: note.revision,
        });
        await api(path, {
          action: "prepare",
          revision: note.revision,
          confirmationId: review.confirmationId,
        });
        return {
          ok: true,
          ...agentFormResult(review),
          instruction:
            "Read back every saved field, uncertainty, restrictive practice and supervisor flag in the summary. Not yet reviewed is not an absence. Do not ask the worker to classify events. Finish by saying: To save this note, say I confirm this shift note, or tell me what to change. Wait for a new answer before calling finalize_form.",
        };
      }),
      finalize_form: tool("finalize_form", async (params) => {
        assert.equal(
          stage,
          2,
          "Must apply correction and receive new confirmation",
        );
        assert.equal(params.confirmationId, review.confirmationId);
        note = (
          await api(`/api/notes/${note.id}/confirm`, {
            revision: note.revision,
            confirmationId: params.confirmationId,
            confirmed: true,
            voiceSessionId: session.sessionId,
          })
        ).note;
        complete();
        return {
          ok: true,
          note: agentNote(note),
          message: "The confirmed note is saved.",
        };
      }),
    },
    onConnect: ({ conversationId }) =>
      assert.equal(conversationId, session.conversationId),
    onMessage: ({ role, message }) => {
      if (!active || role !== "agent") return;
      lastActivity = Date.now();
      console.log(JSON.stringify({ assistant: message }));
      void enqueue(async () => {
        await record("agent", message);
        if (review && hasConfirmationPrompt(message)) {
          await api(path, {
            action: "readback",
            confirmationId: review.confirmationId,
            sequence,
          });
          if (stage === 0) {
            stage = 1;
            await send(
              "Actually, the shift ended at 3:30 pm on 12 September 2026. Everything else is unchanged. Please save this correction and review the updated note.",
            );
          } else if (stage === 1) {
            assert.equal(note.fields.shiftEnd, "2026-09-12T15:30");
            stage = 2;
            await send("I confirm this shift note.");
          }
        }
      }).catch(() => {});
    },
    onError: () => fail(new Error("ElevenLabs text connection failed")),
    onInterruption: invalidate,
    onAgentResponseCorrection: invalidate,
  });
  await enqueue(() =>
    send(
      "This is a fictional test. On 12 September 2026 I supported Sarah Doyle from 9 am to 3 pm Melbourne time. We went grocery shopping. I provided verbal prompts at checkout. Sarah chose items independently and practised budgeting toward their independent shopping goal. There were no incidents and no follow-up actions needed. Please save these answers and review the note.",
    ),
  );
  await done;
  await queue;
  if (failed) throw failed;
  assert.equal(note.status, "complete");
  assert.equal(note.fields.shiftEnd, "2026-09-12T15:30");
  console.log(
    JSON.stringify({
      passed: true,
      mode: "text",
      toolCalls,
      correctedEndTime: note.fields.shiftEnd,
      status: note.status,
      testNoteId: note.id,
    }),
  );
} finally {
  active = false;
  interruptionGeneration++;
  clearTimeout(deadline);
  clearInterval(followUp);
  await conversation?.endSession();
  await queue.catch(() => {});
  await api(path, { action: "close" });
}
