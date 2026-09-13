// One paid synthetic smoke: native specialist + awaitable client tool + real D1.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { startHarness } from "./workflow-backend-harness.mjs";
import { createWorkflowQueue } from "../../lib/workflow-queue.ts";
const env = parseEnv(
  await readFile(new URL("../../.env.local", import.meta.url), "utf8"),
);
const manifest = JSON.parse(
  await readFile(
    new URL("../../.secrets/workflow-app/manifest.json", import.meta.url),
    "utf8",
  ),
);
const h = await startHarness({
  provider: {
    key: env.ELEVENLABS_API_KEY,
    agentId: manifest.agentId,
    versionId: manifest.versionId,
  },
});
let ws, connection;
const queue = createWorkflowQueue();
const run = {
  model: manifest.model,
  versionId: manifest.versionId,
  responses: [],
  tools: [],
  transitions: [],
  passed: false,
};
try {
  const user = await h.account();
  const noteId = await h.note(user);
  async function api(path, body, authorization) {
    const result = await h.request(path, {
      session: authorization ? undefined : user,
      body,
      authorization,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  }
  connection = await api("/api/workflow/sessions", { noteId, mode: "text" });
  run.conversationId = connection.conversationId;
  const path = `/api/workflow/cases/${connection.caseId}`;
  let snapshot = connection.context,
    error,
    lastActivity = Date.now();
  ws = new WebSocket(connection.signedUrl);
  const send = (value) => ws.send(JSON.stringify(value));
  ws.addEventListener("message", ({ data }) => {
    const event = JSON.parse(String(data));
    if (event.type === "ping") {
      send({ type: "pong", event_id: event.ping_event.event_id });
      return;
    }
    lastActivity = Date.now();
    if (event.type === "error")
      error = Error("Provider returned a conversation error");
    if (event.type === "agent_response")
      run.responses.push(event.agent_response_event.agent_response);
    if (event.type === "client_tool_call") {
      const call = event.client_tool_call;
      void queue
        .run(async () => {
          const kind =
            call.tool_name === "get_case_context"
              ? "context"
              : call.tool_name === "save_risk_form"
                ? "save"
                : null;
          assert(kind, "Only configured client tools may execute");
          const started = Date.now();
          const result = await api(
            `/api/workflow/tools/${kind}`,
            kind === "save" ? call.parameters : undefined,
            connection.dynamicVariables.secret__workflow_token,
          );
          run.tools.push({
            name: call.tool_name,
            ms: Date.now() - started,
            ok: result.ok,
            code: result.code,
          });
          snapshot = (await api(path)).context;
          send({
            type: "client_tool_result",
            tool_call_id: call.tool_call_id,
            result: JSON.stringify(result),
            is_error: false,
          });
        })
        .catch((e) => {
          error = e;
        });
    }
    if (event.type === "agent_tool_response_full_payload") {
      const payload =
        event.agent_tool_response_full_payload ??
        event.agent_tool_response_full_payload_event ??
        event.agent_tool_response;
      if (payload?.tool_name === "transfer_to_agent") {
        try {
          run.transitions.push(JSON.parse(payload.full_tool_result));
        } catch {}
      }
    }
  });
  await once(ws, "open", { signal: AbortSignal.timeout(20000) });
  send({
    type: "conversation_initiation_client_data",
    conversation_config_override: { conversation: { text_only: true } },
    dynamic_variables: connection.dynamicVariables,
  });
  async function until(condition, timeout = 45000) {
    const start = Date.now();
    while (!condition()) {
      if (error) throw error;
      if (Date.now() - start > timeout)
        throw Error("Conversation smoke timed out");
      await pause(100);
    }
  }
  await until(() => run.responses.length > 0, 20000);
  const inputs = [
    "Jordan's scheduled 1 pm medication was missing from the pack. I do not know the medication name or dose. Jordan was alert and had no symptoms. I called supervisor Alex at 1:10 pm and recorded the missing dose. No clinical instructions were given.",
    "I have no other details. Please save what I reported and move on.",
  ];
  for (const [index, text] of inputs.entries()) {
    const before = run.responses.length;
    await queue.run(async () => {
      const source = await api(path, {
        action: "source",
        expected_revision: snapshot.revision,
        source: { id: `worker:${index + 1}`, kind: "worker_utterance", text },
      });
      snapshot = source.context;
      send({
        type: "contextual_update",
        text: `Current authoritative saved case: ${JSON.stringify(snapshot)}`,
        context_id: "workflow_case",
      });
      send({ type: "user_message", text });
    });
    await until(
      () => run.responses.length > before && Date.now() - lastActivity > 1600,
    );
    await queue.drain();
    snapshot = (await api(path)).context;
  }
  await until(() =>
    run.tools.some((tool) => tool.name === "save_risk_form" && tool.ok),
  );
  await queue.drain();
  const saved = await api(path);
  assert(
    saved.case.events.some((event) => event.risk_forms.medication),
    "Medication form persisted",
  );
  assert(saved.case.sources.some((source) => source.id === "worker:1"));
  await api(path, { action: "close", sessionId: connection.sessionId });
  const reviewed = await api(path, {
    action: "review",
    expected_revision: saved.case.revision,
  });
  assert.equal(reviewed.reviewed, true);
  assert.equal(reviewed.noteConfirmed, false);
  run.passed = true;
  run.savedRevision = saved.case.revision;
  run.savedForms = saved.case.events.map((event) =>
    Object.keys(event.risk_forms),
  );
  const voice = await api("/api/workflow/sessions", { noteId, mode: "voice" });
  assert(
    voice.conversationToken && voice.conversationId,
    "WebRTC connection is issued with identity",
  );
  await api(path, { action: "close", sessionId: voice.sessionId });
  run.voiceTokenIssued = true;
} catch (error) {
  run.error = error.message;
  process.exitCode = 1;
} finally {
  ws?.close();
  await queue.drain();
  await h.close();
  const output = new URL("../../test-results/workflow-app/", import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL("smoke.json", output), JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run));
}
