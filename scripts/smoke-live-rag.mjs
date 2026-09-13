// One opt-in, real ElevenLabs text conversation against the deployed app.
// Uses only the explicitly synthetic Sarah dataset and leaves its new note as a
// draft. Authentication must be supplied by the user; never extract credentials
// from a server runtime or browser to run this test.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Conversation } from "@elevenlabs/client";
import {
  checkForm,
  definitions,
  incidentOptions,
  followUpOptions,
} from "../lib/shift-form.ts";
import {
  agentFormResult,
  agentKnowledgeResult,
  agentNote,
  knowledgeFailure,
  parseAgentUpdate,
  toolSnapshotMatches,
} from "../lib/agent-tools.ts";
import {
  hasConfirmationPrompt,
  isVoiceConfirmation,
} from "../lib/voice-state.ts";
import { melbourneLocal } from "../lib/knowledge.ts";
import { normalizeQuestion } from "../lib/interview.ts";

const origin = "https://legalmate.callfoods.com";
const participantId = "829d744b-71e8-4c82-9ca4-3c999004982c";
const participantName = "Sarah Doyle (fictional demo)";
const providerId = "testprovider";
const workerId = "auth_test_worker";
const lastHistoryId = "f802d718-9b9c-4dab-9104-c5dcd0886766";
const durationLimit = 150_000;
const maximumToolCalls = 20;
const suppliedSecrets = [];
const proof = {
  origin,
  participantId,
  synthetic: true,
  mode: "text",
  tools: [],
  messages: [],
};

function safeError(error) {
  let text = error instanceof Error ? error.message : "Live smoke test failed";
  for (const secret of suppliedSecrets)
    if (secret) text = text.split(secret).join("[redacted]");
  return text
    .replace(/(?:https?|wss?):\/\/\S+/g, "[URL redacted]")
    .slice(0, 400);
}
async function privateLine(path, label) {
  if (!path)
    throw new Error(
      `Supply ${label}; the script does not discover credentials.`,
    );
  const value = (await readFile(path, "utf8")).trim();
  if (!value || /[\r\n]/.test(value))
    throw new Error(`${label} must contain one nonempty line.`);
  suppliedSecrets.push(value);
  return value;
}
async function api(
  path,
  { cookie, body, method = body === undefined ? "GET" : "POST" } = {},
) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Application returned non-JSON HTTP ${response.status}.`);
  }
  if (!response.ok)
    throw new Error(
      `Application HTTP ${response.status}: ${data.error ?? "Request failed"}`,
    );
  return { data, response };
}
async function login(alias, password) {
  const { response } = await api("/api/auth/sign-in/test-account", {
    body: { email: alias, password },
  });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie, "The login must issue an ordinary signed session");
  suppliedSecrets.push(cookie);
  return cookie;
}

async function main() {
  if (process.env.LEGALMATE_LIVE_RAG_READY !== "1")
    throw new Error(
      "No live conversation started. Confirm the deployed six-tool Agent and set LEGALMATE_LIVE_RAG_READY=1. This opt-in uses real ElevenLabs credits.",
    );
  let workerCookie,
    managerCookie,
    signedInHere = false;
  let conversation,
    sessionPath,
    queue = Promise.resolve(),
    active = false;
  let deadline, nudgeTimer;
  const originalConsoleError = console.error;
  // The SDK logs its error context before invoking onError. Omit object
  // contexts and redact URL strings so connection credentials cannot reach logs.
  console.error = (...values) =>
    originalConsoleError(
      ...values.map((value) =>
        typeof value === "string"
          ? safeError(new Error(value))
          : value instanceof Error
            ? safeError(value)
            : "[SDK context omitted]",
      ),
    );
  const started = Date.now();
  const proofFile = resolve(
    process.env.LEGALMATE_LIVE_RAG_PROOF_FILE ||
      `outputs/rag-live-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  try {
    if (process.env.LEGALMATE_TEST_COOKIE_FILE) {
      workerCookie = (
        await privateLine(
          process.env.LEGALMATE_TEST_COOKIE_FILE,
          "LEGALMATE_TEST_COOKIE_FILE",
        )
      ).replace(/^Cookie:\s*/i, "");
      suppliedSecrets.push(workerCookie);
    } else if (process.env.LEGALMATE_LIVE_RAG_PASSWORD_FILE) {
      const password = await privateLine(
        process.env.LEGALMATE_LIVE_RAG_PASSWORD_FILE,
        "a user-provided private password file",
      );
      signedInHere = true;
      workerCookie = await login("workertest@gmail.com", password);
      managerCookie = await login("managertest@gmail.com", password);
    } else
      throw new Error(
        "Provide an authorized worker cookie file and an unused shift ID, or a user-provided private password file. No credentials were read.",
      );
    const workerApi = async (path, body, method) =>
      (await api(path, { cookie: workerCookie, body, method })).data;
    const onboarding = await workerApi("/api/onboarding");
    assert.equal(onboarding.user.userId, workerId);
    assert.equal(onboarding.profile.providerId, providerId);
    const fixture = JSON.parse(
      await readFile(
        new URL("../fixtures/sarah-doyle-history.json", import.meta.url),
        "utf8",
      ),
    );
    const expectedIds = new Set(fixture.notes.map((note) => note.id));
    const { notes: savedNotes } = await workerApi("/api/notes");
    const history = savedNotes.filter((note) => expectedIds.has(note.id));
    assert.equal(
      history.length,
      10,
      "Deploy the ten synthetic historical notes before running the conversation",
    );
    for (const note of history) {
      assert.equal(note.status, "complete");
      assert.equal(note.participantId, participantId);
      assert.equal(note.providerId, providerId);
      assert.equal(note.fields.participant, participantName);
      assert.equal(note.safety.syntheticFixture?.synthetic, true);
    }
    proof.historyNotesVerified = history.length;

    let shift;
    if (process.env.LEGALMATE_LIVE_RAG_SHIFT_ID) {
      shift = (await workerApi("/api/shifts")).shifts.find(
        (item) => item.id === process.env.LEGALMATE_LIVE_RAG_SHIFT_ID,
      );
      assert.ok(
        shift,
        "The supplied shift must be assigned to Test Support Worker",
      );
      assert.equal(shift.participantId, participantId);
      assert.equal(shift.participantName, participantName);
      assert.ok(
        !shift.noteId,
        "Use a fresh assignment; this test never edits an existing note",
      );
    } else {
      assert.ok(
        managerCookie,
        "A cookie-only run also requires LEGALMATE_LIVE_RAG_SHIFT_ID, prepared through the manager",
      );
      const profile = (
        await api(`/api/participants?providerId=${providerId}`, {
          cookie: managerCookie,
        })
      ).data.participants.find((item) => item.id === participantId);
      assert.equal(profile?.name, participantName);
      const expectedStart = melbourneLocal(Date.now() - 90 * 60_000);
      const expectedEnd = melbourneLocal(Date.now() - 30 * 60_000);
      assert.ok(
        expectedStart > "2026-09-12T15:00",
        "The smoke shift must follow all ten historical notes",
      );
      shift = (
        await api(`/api/shifts?providerId=${providerId}`, {
          cookie: managerCookie,
          body: {
            participantId,
            workerId,
            expectedStart,
            expectedEnd,
            timezone: "Australia/Melbourne",
          },
        })
      ).data.shift;
    }
    assert.ok(shift.expectedStart > "2026-09-12T15:00");
    assert.ok(
      shift.expectedEnd <= melbourneLocal(Date.now()),
      "Use an already-ended fictional shift",
    );
    let note = (
      await workerApi("/api/notes", { id: randomUUID(), shiftId: shift.id })
    ).note;
    // The harness acts as the fictional worker and supplies actual times. They
    // match the explicit worker message below; they are not inferred by the AI.
    note = (
      await workerApi(
        `/api/notes/${note.id}`,
        {
          revision: note.revision,
          fields: {
            shiftStart: shift.expectedStart,
            shiftEnd: shift.expectedEnd,
          },
        },
        "PATCH",
      )
    ).note;
    proof.noteId = note.id;
    proof.shiftId = shift.id;
    proof.appUrl = origin + "/worker";
    const preflight = await workerApi(
      `/api/notes/${note.id}/knowledge/context`,
    );
    assert.ok(
      preflight.sources.some((source) => source.noteId === lastHistoryId),
      "Latest synthetic craft-group history must be eligible",
    );
    assert.equal(note.fields.activities, "");
    console.log(
      JSON.stringify({
        event: "preflight_passed",
        historyNotes: history.length,
        noteId: note.id,
        synthetic: true,
      }),
    );

    const session = await workerApi("/api/voice/sessions", {
      noteId: note.id,
      mode: "text",
    });
    assert.equal(session.mode, "text");
    assert.ok(session.signedUrl);
    suppliedSecrets.push(session.signedUrl);
    proof.conversationId = session.conversationId;
    sessionPath = `/api/voice/sessions/${session.sessionId}`;
    active = true;
    let sequence = 0,
      workerSequence = 0,
      interruptionGeneration = 0,
      toolCalls = 0;
    let review = null,
      lastWorkerText = "",
      lastActivity = Date.now(),
      failure = null;
    let resolveDone, rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    void done.catch(() => {});
    const fail = (error) => {
      failure = error;
      rejectDone(error);
    };
    const enqueue = (job) => {
      const work = queue.then(job);
      queue = work.catch(fail);
      return work;
    };
    const snapshot = () => ({
      revision: note.revision,
      workerSequence,
      interruptionGeneration,
    });
    const record = async (kind, text) => {
      if (!active) throw new Error("This live smoke conversation has ended.");
      const event = { sequence: ++sequence, kind, text };
      if (kind === "user") {
        workerSequence = sequence;
        lastWorkerText = text;
      }
      const result = await workerApi(sessionPath, { action: "event", event });
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
      proof.messages.push({ role: "worker", text });
      await record("user", text);
      conversation.sendUserMessage(text);
    };
    const trace = (name, result) => {
      const context =
        name === "get_form_context" ? result.participantContext : result;
      proof.tools.push({
        name,
        ok: result.ok,
        status: context?.status,
        retrievalId: context?.retrievalId,
        sourceIds: context?.sources?.map((source) => source.sourceId),
        questionId: result.question?.id,
        canAsk: result.canAsk,
      });
      console.log(
        JSON.stringify({
          event: "agent_tool",
          name,
          ok: result.ok,
          status: context?.status,
        }),
      );
      return result;
    };
    const tool =
      (name, run, historyRead = false) =>
      async (params) => {
        try {
          const bound = await enqueue(async () => {
            if (++toolCalls > maximumToolCalls)
              throw new Error("Live smoke tool budget exceeded");
            lastActivity = Date.now();
            return snapshot();
          });
          if (!active)
            return JSON.stringify(
              knowledgeFailure(new Error("Conversation ended"), "stale"),
            );
          const result = historyRead
            ? await run(params, bound)
            : await enqueue(async () => {
                try {
                  return await run(params, bound);
                } catch (error) {
                  return knowledgeFailure(new Error(safeError(error)));
                }
              });
          if (
            historyRead &&
            (!active || !toolSnapshotMatches(bound, snapshot()))
          )
            return JSON.stringify(
              trace(
                name,
                knowledgeFailure(
                  new Error(
                    "Current worker turn or saved note changed; refresh context.",
                  ),
                  "stale",
                ),
              ),
            );
          return JSON.stringify(trace(name, result));
        } catch (error) {
          return JSON.stringify(
            trace(name, knowledgeFailure(new Error(safeError(error)))),
          );
        }
      };
    const clientTools = {
      get_form_context: tool(
        "get_form_context",
        async () => {
          const result = await workerApi(`/api/notes/${note.id}`);
          note = result.note;
          const participantContext = agentKnowledgeResult(
            await workerApi(`/api/notes/${note.id}/knowledge/context`),
          );
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
        },
        true,
      ),
      search_participant_records: tool(
        "search_participant_records",
        async (params, bound) => {
          const result = await workerApi(
            `/api/notes/${note.id}/knowledge/search`,
            {
              query: params.query,
              currentTurnQuote: params.current_turn_quote,
              revision: bound.revision,
              voiceSessionId: session.sessionId,
            },
          );
          return {
            ok: ["ok", "partial", "no_match"].includes(result.status),
            ...agentKnowledgeResult(result),
          };
        },
        true,
      ),
      register_followup: tool(
        "register_followup",
        async (params, bound) => {
          const result = await workerApi(
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
          return { ok: true, ...agentKnowledgeResult(result) };
        },
        true,
      ),
      update_and_check_form: tool("update_and_check_form", async (params) => {
        review = null;
        await workerApi(sessionPath, { action: "invalidate" });
        const result = await workerApi(
          `/api/notes/${note.id}`,
          {
            revision: note.revision,
            ...parseAgentUpdate(params.fields_json),
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
        review = await workerApi(`/api/notes/${note.id}/review`, {
          revision: note.revision,
        });
        await workerApi(sessionPath, {
          action: "prepare",
          revision: note.revision,
          confirmationId: review.confirmationId,
        });
        return {
          ok: true,
          ...agentFormResult(review),
          instruction:
            "Read the saved summary and request a new explicit confirmation. This draft has not been confirmed.",
        };
      }),
      finalize_form: tool("finalize_form", async (params) => {
        if (
          !review ||
          params.confirmationId !== review.confirmationId ||
          !isVoiceConfirmation(lastWorkerText)
        )
          throw new Error(
            "A new explicit worker confirmation has not been supplied. Leave this note as a draft.",
          );
        const result = await workerApi(`/api/notes/${note.id}/confirm`, {
          revision: note.revision,
          confirmationId: params.confirmationId,
          confirmed: true,
          voiceSessionId: session.sessionId,
        });
        note = result.note;
        return { ok: true, note: agentNote(note) };
      }),
    };
    const inspectEmission = async (message) => {
      const audit = await workerApi(
        `/api/notes/${note.id}/interview/questions`,
      );
      const question = audit.questions.find(
        (item) =>
          item.status === "emitted" &&
          item.citations.some(
            (source) =>
              source.noteId === lastHistoryId && source.accessible === true,
          ) &&
          normalizeQuestion(message).includes(
            normalizeQuestion(item.question),
          ) &&
          /craft|group/i.test(item.question) &&
          /coordinator|repl|response|heard|update|time|material|cost|trial/i.test(
            item.question,
          ),
      );
      if (!question) return;
      const names = proof.tools
        .filter(
          (entry) =>
            entry.ok &&
            (entry.name !== "register_followup" || entry.canAsk === true),
        )
        .map((entry) => entry.name);
      const contextAt = names.indexOf("get_form_context");
      const searchAt = names.indexOf(
        "search_participant_records",
        contextAt + 1,
      );
      const registerAt = names.indexOf("register_followup", searchAt + 1);
      assert.ok(
        contextAt >= 0 && searchAt > contextAt && registerAt > searchAt,
        "The actual Agent must call context, search and register before the emitted question",
      );
      proof.question = {
        id: question.id,
        text: question.question,
        status: question.status,
        sourceIds: question.sourceIds,
        citations: question.citations.map((source) => ({
          noteId: source.noteId,
          sourceId: source.sourceId,
          shiftStart: source.shiftStart,
          accessible: source.accessible,
        })),
      };
      resolveDone();
    };
    deadline = setTimeout(
      () =>
        fail(
          new Error(
            "Live Agent did not emit the registered, source-specific craft follow-up within 150 seconds",
          ),
        ),
      durationLimit,
    );
    let assisted = false;
    nudgeTimer = setInterval(() => {
      if (
        conversation &&
        active &&
        !assisted &&
        Date.now() - lastActivity > 15_000
      ) {
        assisted = true;
        proof.assisted = true;
        lastActivity = Date.now();
        void enqueue(() =>
          send(
            "Please check Sarah's recent notes about the craft group before asking the next question. I have not yet told you whether there was a coordinator response during this shift.",
          ),
        ).catch(() => {});
      }
    }, 1000);
    conversation = await Conversation.startSession({
      signedUrl: session.signedUrl,
      connectionType: "websocket",
      textOnly: true,
      clientTools,
      onConnect: ({ conversationId }) =>
        assert.equal(conversationId, session.conversationId),
      onMessage: ({ role, message }) => {
        if (!active || role !== "agent") return;
        lastActivity = Date.now();
        proof.messages.push({ role: "agent", text: message });
        console.log(JSON.stringify({ event: "agent_message", text: message }));
        void enqueue(async () => {
          await record("agent", message);
          if (review && hasConfirmationPrompt(message))
            await workerApi(sessionPath, {
              action: "readback",
              confirmationId: review.confirmationId,
              sequence,
            });
          await inspectEmission(message);
        }).catch(() => {});
      },
      onError: () => fail(new Error("ElevenLabs text connection failed")),
      onInterruption: () => {
        interruptionGeneration++;
      },
      onAgentResponseCorrection: () => {
        interruptionGeneration++;
      },
    });
    await enqueue(() =>
      send(
        `This is a fictional live RAG smoke test. I supported Sarah Doyle from ${shift.expectedStart} to ${shift.expectedEnd}, Australia/Melbourne time. Those are the actual times. We went to the library and then walked to the park for twenty minutes. Sarah brought the craft-group leaflet and talked about trying the group. I gave directions when she asked, and she borrowed a book herself. She chatted comfortably with the librarian. There were no incidents. Please save these current observations and use her recent history to identify the one useful detail still worth clarifying.`,
      ),
    );
    await done;
    await queue;
    if (failure) throw failure;
    const saved = (await workerApi(`/api/notes/${note.id}`)).note;
    assert.equal(
      saved.status,
      "draft",
      "A smoke test must not invent worker confirmation",
    );
    proof.passed = true;
    proof.noteStatus = saved.status;
    proof.assisted ??= false;
    proof.durationMs = Date.now() - started;
  } catch (error) {
    proof.passed = false;
    proof.error = safeError(error);
    proof.durationMs = Date.now() - started;
    throw error;
  } finally {
    active = false;
    clearTimeout(deadline);
    clearInterval(nudgeTimer);
    await conversation?.endSession().catch(() => {});
    await queue.catch(() => {});
    if (sessionPath && workerCookie)
      await api(sessionPath, {
        cookie: workerCookie,
        body: { action: "close" },
      }).catch(() => {});
    if (signedInHere)
      for (const cookie of [workerCookie, managerCookie])
        if (cookie)
          await api("/api/auth/sign-out", { cookie, body: {} }).catch(() => {});
    console.error = originalConsoleError;
    await mkdir(dirname(proofFile), { recursive: true, mode: 0o700 });
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        passed: proof.passed,
        appUrl: proof.appUrl,
        noteId: proof.noteId,
        question: proof.question?.text,
        sourceIds: proof.question?.sourceIds,
        assisted: proof.assisted,
        proofFile,
      }),
    );
  }
}

await main().catch((error) => {
  console.error(JSON.stringify({ passed: false, error: safeError(error) }));
  process.exitCode = 1;
});
