// Paid, synthetic-only native workflow + real webhook + isolated D1 exercise.
// No production agent/database edits. Gateway and tunnel close at the end.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  startHarness,
  startGateway,
} from "../../tests/support/workflow-harness.mjs";
import { configureWorkflowBackend } from "../workflow/workflow-backend-setup.mjs";

const args = process.argv.slice(2),
  requested = args[0] ?? "medication",
  audio = args.includes("--audio");
const model = args.find((arg) => arg.startsWith("--model="))?.slice(8);
const scenarios = {
  medication: [
    "During this shift, Jordan's scheduled medication was not given because the medication pack was empty. I don't know the medicine name or dose.",
    "Jordan had no symptoms and seemed their usual self. I called supervisor Alex at 1:10 pm; Alex arranged a replacement pack and will contact the pharmacist. I did not receive clinical instructions. No medication was administered. That's everything I know; please save these details and continue.",
    "Correction: I called Alex at 1:20 pm, not 1:10 pm. Please update that existing record.",
    "There was a separate medication event at 3 pm later in the shift: Jordan declined a different scheduled medicine and said they did not want it. This is separate from the earlier empty pack. I don't know this medicine's name or dose.",
    "Jordan had no symptoms. I told supervisor Alex at 3:05 pm and recorded the refusal on the medication chart. I don't know any further details. Please save this separate event and move on.",
  ],
  incident_safeguarding: [
    "At 10 am Jordan tripped on a loose rug in the living room and fell onto their left knee. I saw a small graze. I removed the rug and called supervisor Alex. Jordan said their knee hurt and was sitting safely when I left.",
    "I don't know any more details. Please save what I reported and move on.",
  ],
  health_wellbeing: [
    "Jordan ate much less lunch than usual today and told me they felt tired. I first noticed at 12:30. They were awake and speaking normally. This is a new change from the usual lunch routine.",
    "I told supervisor Alex at 1 pm, and Alex said they would follow up. I don't know the cause or any other details. Please save that and move on.",
  ],
  behaviour_abc: [
    "At 11 am, while waiting for the bus, Jordan shouted and stamped their feet for about two minutes. I offered a quiet place to wait and they sat down. No restrictive measures were used and nobody was hurt.",
    "I don't know whether it is in the behaviour plan. Jordan was calm afterwards. That's everything I can report; please save it and move on.",
  ],
  restrictive_practice: [
    "At 2 pm I observed another worker holding Jordan's forearms to stop them moving for about thirty seconds. I don't know whether that intervention was in the plan or authorised. I reported it to supervisor Alex.",
    "Jordan pulled away and said let go. No injury was visible. I don't know any more about alternatives or the plan. Please save my observations and move on.",
  ],
  service_exception: [
    "The planned community transport did not arrive at 10 am, so Jordan missed the library visit. I stayed with Jordan at home until my usual finish time. I called the coordinator and offered an activity at home, which Jordan agreed to.",
    "Jordan was safe and no medication or essential personal care was missed. I do not know why the transport failed. Please save what I reported and move on.",
  ],
};
const selected =
  requested === "all" ? Object.keys(scenarios) : requested.split(",");
if (
  selected.some((type) => !scenarios[type]) ||
  args.some((x, i) => i > 0 && x !== "--audio" && !x.startsWith("--model="))
)
  throw Error(
    "Usage: node scripts/experiments/workflow-backend-live.mjs [medication|all|risk_type] [--audio]",
  );
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = new URL(
  `../../test-results/workflow-backend/${stamp}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true, mode: 0o700 });
const save = (name, value) =>
  writeFile(new URL(name, output), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let harness, gateway, tunnel, backend, activeSocket;
const results = [];
try {
  gateway = await startGateway(() => harness);
  tunnel = spawn(
    "ngrok",
    [
      "http",
      `http://127.0.0.1:${gateway.port}`,
      "--inspect=false",
      "--log=stdout",
      "--log-format=json",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  tunnel.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  tunnel.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  let publicUrl;
  for (let i = 0; i < 40; i++) {
    // Only read the local tunnel control API; never print its raw response.
    try {
      const state = await (
        await fetch("http://127.0.0.1:4040/api/tunnels", {
          signal: AbortSignal.timeout(1000),
        })
      ).json();
      publicUrl = state.tunnels?.find(
        (t) =>
          t.config?.addr === `http://127.0.0.1:${gateway.port}` &&
          t.public_url?.startsWith("https://"),
      )?.public_url;
    } catch {}
    if (publicUrl) break;
    if (tunnel.exitCode !== null) break;
    await pause(500);
  }
  if (!publicUrl) {
    await writeFile(new URL("tunnel-error.txt", output), logs, { mode: 0o600 });
    throw Error(
      "The isolated webhook tunnel could not start; private log saved",
    );
  }
  // Verify arbitrary app routes are unreachable before registering this endpoint.
  assert.equal(
    (
      await fetch(publicUrl + "/api/workflow/sessions", {
        headers: { "ngrok-skip-browser-warning": "true" },
      })
    ).status,
    404,
  );
  backend = await configureWorkflowBackend(publicUrl, { model });
  if (backend.manifest.runs.length + selected.length > 20)
    throw Error("Live workflow experiment run cap reached");
  harness = await startHarness({
    provider: {
      key: backend.key,
      agentId: backend.manifest.agentId,
      versionId: backend.manifest.versionId,
    },
    persistDirectory: fileURLToPath(new URL("d1/", output)),
  });
  console.log(
    JSON.stringify({
      phase: "configured",
      agentId: backend.manifest.agentId,
      versionId: backend.manifest.versionId,
      specialists: 6,
      model: backend.manifest.model,
      storage: "isolated D1",
      tools: "webhook",
    }),
  );
  const user = await harness.account();
  const api = async (path, body) => {
    const value = await harness.request(path, { session: user, body });
    assert.equal(value.status, 200, JSON.stringify(value.data));
    return value.data;
  };
  for (const riskType of selected) {
    const run = {
      riskType,
      audio,
      model: backend.manifest.model,
      status: "running",
      turns: [],
      workflowEvents: [],
    };
    results.push(run);
    const noteId = await harness.note(user),
      connection = await api("/api/workflow/sessions", {
        noteId,
        mode: "text",
      });
    run.caseId = connection.caseId;
    run.conversationId = connection.conversationId;
    run.versionId = connection.versionId;
    const path = `/api/workflow/cases/${connection.caseId}`;
    await backend.recordRun({
      at: stamp,
      riskType,
      conversationId: run.conversationId,
      status: "started",
    });
    let snapshot = connection.context,
      currentTurn,
      lastActivity = Date.now(),
      greeted = false,
      currentNode = "main",
      error;
    const ws = new WebSocket(connection.signedUrl);
    activeSocket = ws;
    const send = (value) => ws.send(JSON.stringify(value));
    const chunks = [],
      pendingTools = new Set();
    ws.addEventListener("message", ({ data }) => {
      const event = JSON.parse(String(data));
      if (event.type === "ping") {
        send({ type: "pong", event_id: event.ping_event.event_id });
        return;
      }
      lastActivity = Date.now();
      if (event.type === "error") {
        error = Error("Provider emitted a conversation error");
        return;
      }
      if (event.type === "client_tool_call") {
        error = Error(
          "Unexpected client tool: this test requires server webhooks",
        );
        return;
      }
      if (event.type === "agent_response") {
        greeted = true;
        if (currentTurn) {
          currentTurn.lastResponseNode = currentNode;
          currentTurn.completeTextMs ??= Date.now() - currentTurn.started;
          currentTurn.responses.push(event.agent_response_event.agent_response);
        }
      }
      if (event.type === "agent_response_complete" && currentTurn)
        currentTurn.responseComplete = true;
      if (event.type === "agent_tool_request")
        pendingTools.add(event.agent_tool_request.tool_call_id);
      if (event.type === "audio" && currentTurn) {
        currentTurn.firstAudioMs ??= Date.now() - currentTurn.started;
        if (riskType === "medication" && currentTurn.index === 0)
          chunks.push(Buffer.from(event.audio_event.audio_base_64, "base64"));
      }
      if (event.type === "agent_tool_response_full_payload") {
        // Retain only routing results. Webhook request/response audits come from
        // our allowlisted gateway, which intentionally never records headers.
        const payload =
          event.agent_tool_response_full_payload ??
          event.agent_tool_response_full_payload_event ??
          event.agent_tool_response;
        if (payload?.tool_call_id) pendingTools.delete(payload.tool_call_id);
        const text = JSON.stringify(payload ?? event);
        if (payload?.tool_name === "transfer_to_agent") {
          try {
            const transfer = JSON.parse(payload.full_tool_result);
            if (transfer.status === "success" && transfer.to_node)
              currentNode = transfer.to_node;
          } catch {}
        }
        if (currentTurn && payload?.tool_name === "transfer_to_agent") {
          currentTurn.transfers = (currentTurn.transfers ?? 0) + 1;
          if (currentTurn.transfers > 8)
            error = Error(
              "Workflow exceeded eight transitions in one worker turn",
            );
        }
        if (
          text.includes("to_node") ||
          text.includes("notify_condition") ||
          text.includes("target_node_id")
        )
          run.workflowEvents.push(
            JSON.parse(text.replace(/Bearer [a-f0-9]{64}/g, "[redacted]")),
          );
      }
    });
    await once(ws, "open", { signal: AbortSignal.timeout(20000) });
    send({
      type: "conversation_initiation_client_data",
      conversation_config_override: { conversation: { text_only: !audio } },
      dynamic_variables: connection.dynamicVariables,
    });
    const opening = Date.now();
    while (!greeted && Date.now() - opening < 20000) {
      if (error) throw error;
      await pause(100);
    }
    assert(greeted, "Provider greeting did not arrive");
    while (Date.now() - lastActivity < 600) await pause(100);
    const messages = scenarios[riskType];
    for (const [index, message] of messages.entries()) {
      const source = await api(path, {
        action: "source",
        expected_revision: snapshot.revision,
        source: {
          id: `worker:${index + 1}`,
          kind: "worker_utterance",
          text: message,
        },
      });
      snapshot = source.context;
      // A separate saved form fact arrives before Medication's first response.
      if (riskType === "medication" && index === 0) {
        const edit = await api(path, {
          action: "source",
          expected_revision: snapshot.revision,
          source: {
            id: "form:scheduled",
            kind: "worker_form_edit",
            text: "The worker has checked and saved the scheduled medication time as 1 pm.",
            field_path: "medication.scheduled_time",
          },
        });
        snapshot = edit.context;
        // Persist the actual form field too; a text source alone is not a saved
        // form value. The specialist must reuse this existing event and answer.
        snapshot = (
          await api(path, {
            action: "patch",
            expected_revision: snapshot.revision,
            patch: {
              risk_type: "medication",
              expected_revision: snapshot.revision,
              fields_json: JSON.stringify({
                fields: {
                  scheduled_time: {
                    value: "1 pm",
                    state: "known",
                    source_ids: ["form:scheduled"],
                  },
                },
              }),
            },
          })
        ).context;
        run.initialMedicationEventId = snapshot.events[0].id;
      }
      send({
        type: "contextual_update",
        text: JSON.stringify({ case_context: snapshot }),
      });
      currentTurn = {
        index,
        input: message,
        started: Date.now(),
        responses: [],
      };
      run.turns.push(currentTurn);
      const requestIndex = gateway.requests.length;
      const expectsSave = /please (?:save|update)|correction:/i.test(message);
      send({ type: "user_message", text: message });
      let settled = false;
      while (Date.now() - currentTurn.started < 55000) {
        if (error) throw error;
        if (
          currentTurn.responses.length &&
          pendingTools.size === 0 &&
          (!expectsSave ||
            (currentNode === "main" &&
              currentTurn.lastResponseNode === "main" &&
              gateway.requests
                .slice(requestIndex)
                .some(
                  (entry) => entry.path.endsWith("/save") && entry.result.ok,
                ))) &&
          Date.now() - lastActivity >
            (currentTurn.responseComplete ? 800 : 1800)
        ) {
          settled = true;
          break;
        }
        if (ws.readyState !== WebSocket.OPEN)
          throw Error("Conversation disconnected before turn completed");
        await pause(100);
      }
      currentTurn.pendingToolCount = pendingTools.size;
      assert(
        settled && currentTurn.responses.length,
        "Turn or pending tool did not finish before deadline",
      );
      currentTurn.finishedMs = Date.now() - currentTurn.started;
      currentTurn.webhookRequests = gateway.requests.slice(requestIndex);
      snapshot = (await api(path)).context;
      console.log(
        JSON.stringify({
          riskType,
          turn: index + 1,
          completeTextMs: currentTurn.completeTextMs,
          firstAudioMs: currentTurn.firstAudioMs,
          saves: currentTurn.webhookRequests.filter(
            (x) => x.path.endsWith("/save") && x.result.ok,
          ).length,
          responses: currentTurn.responses,
        }),
      );
    }
    await api(path, { action: "close" });
    ws.close();
    activeSocket = null;
    run.saved = await api(path);
    run.review = await api(path, {
      action: "review",
      expected_revision: run.saved.case.revision,
    });
    run.assertions = {
      formSaved: run.saved.case.events.some(
        (event) => event.risk_forms[riskType],
      ),
      sourcesFromWorker: run.saved.case.events.every((event) =>
        [
          ...Object.values(event.shared_fields),
          ...Object.values(event.risk_forms).flatMap((form) =>
            Object.values(form.fields),
          ),
        ].every(
          (field) =>
            field.state === "not_discussed" ||
            (field.source_ids.length > 0 &&
              field.source_ids.every((id) =>
                run.saved.case.sources.some(
                  (source) => source.id === id && source.kind !== "background",
                ),
              )),
        ),
      ),
      formFinished: run.saved.case.events
        .filter((event) => event.risk_forms[riskType])
        .every((event) =>
          ["handled", "deferred"].includes(
            event.risk_forms[riskType].followup_status,
          ),
        ),
    };
    if (riskType === "medication") {
      const event = run.saved.case.events.find((e) => e.risk_forms.medication);
      const fields = event?.risk_forms.medication.fields;
      run.assertions.unknownRecorded =
        fields?.medication_name.state === "unknown";
      run.assertions.correctedSchedule = /1\s*(?:pm|p\.m\.)|13:00/i.test(
        fields?.scheduled_time.value ?? "",
      );
      run.assertions.scheduleNotEventTime =
        event?.shared_fields.occurred_at.state === "not_discussed";
      run.assertions.correctedContact = /1:20|13:20/i.test(
        event?.shared_fields.notifications.value ?? "",
      );
      run.assertions.correctionKeptEvent =
        event?.id === run.initialMedicationEventId;
      run.assertions.separateEventSaved =
        run.saved.case.events.filter((e) => e.risk_forms.medication).length ===
        2;
    }
    if (chunks.length) {
      const pcm = Buffer.concat(chunks),
        wav = Buffer.alloc(44);
      wav.write("RIFF", 0);
      wav.writeUInt32LE(36 + pcm.length, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(16000, 24);
      wav.writeUInt32LE(32000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(pcm.length, 40);
      await writeFile(
        new URL(`${riskType}-question.wav`, output),
        Buffer.concat([wav, pcm]),
        { mode: 0o600 },
      );
    }
    await save(`${riskType}.json`, run);

    // Provider transcript is read after the connection closes. The runner never
    // infers which node spoke merely from the words in its response.
    let record;
    for (let i = 0; i < 30; i++) {
      await pause(1000);
      record = await backend.api(
        "GET",
        `/convai/conversations/${run.conversationId}`,
      );
      if (record.status === "done") break;
    }
    run.nodeTranscript = (record.transcript ?? []).map((t) => ({
      role: t.role,
      message: t.message,
      node: t.agent_metadata?.workflow_node_id,
    }));
    run.assertions.specialistSpoke = run.nodeTranscript.some(
      (t) => t.role === "agent" && t.node === riskType,
    );
    run.assertions.returnedToMain =
      currentNode === "main" &&
      run.workflowEvents.some((entry) => {
        if (entry.tool_name !== "transfer_to_agent") return false;
        try {
          return JSON.parse(entry.full_tool_result).to_node === "main";
        } catch {
          return false;
        }
      });
    if (riskType === "medication") {
      const reopenedAt = run.nodeTranscript.findIndex(
        (t) =>
          t.role === "user" &&
          t.message?.startsWith("There was a separate medication event"),
      );
      run.assertions.specialistReentered =
        reopenedAt >= 0 &&
        run.nodeTranscript
          .slice(reopenedAt + 1)
          .some(
            (t) =>
              t.role === "agent" &&
              t.node === "medication" &&
              Boolean(t.message),
          );
    }
    run.status = Object.values(run.assertions).every(Boolean)
      ? "passed"
      : "failed";
    await save(`${riskType}.json`, run);
    await backend.recordRun({
      at: stamp,
      riskType,
      conversationId: run.conversationId,
      status: run.status,
    });
    console.log(
      JSON.stringify({
        riskType,
        status: run.status,
        assertions: run.assertions,
      }),
    );
  }
  await save("summary.json", {
    agentId: backend.manifest.agentId,
    versionId: backend.manifest.versionId,
    results: results.map((r) => ({
      riskType: r.riskType,
      status: r.status,
      assertions: r.assertions,
    })),
  });
  if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
} catch (error) {
  for (const run of results.filter((item) => item.status === "running")) {
    run.status = "failed";
    if (backend && run.conversationId)
      await backend.recordRun({
        at: stamp,
        riskType: run.riskType,
        conversationId: run.conversationId,
        status: "failed",
      });
  }
  await save("failure.json", {
    message: error.message,
    results,
    webhookRequests: gateway?.requests ?? [],
  });
  console.error(JSON.stringify({ status: "failed", error: error.message }));
  process.exitCode = 1;
} finally {
  if (activeSocket) activeSocket.close();
  if (gateway) await gateway.close();
  if (harness) {
    await harness.db
      .prepare(
        "UPDATE workflow_sessions SET closed_at=? WHERE closed_at IS NULL",
      )
      .bind(new Date().toISOString())
      .run();
    await harness.close();
  }
  if (tunnel && tunnel.exitCode === null) tunnel.kill("SIGTERM");
  console.log(
    JSON.stringify({ output: fileURLToPath(output), gatewayClosed: true }),
  );
}
