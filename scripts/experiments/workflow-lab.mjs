// Isolated ElevenLabs workflow experiment. Uses synthetic data and a dedicated
// private agent; never modifies the application's configured agent or tools.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildWorkflow,
  toolDefinitions,
  basePrompt,
  experimentVersion,
} from "./workflow-lab-config.mjs";

const root = new URL("../../", import.meta.url);
const privateDir = new URL(".secrets/workflow-lab/", root);
const manifestPath = new URL("manifest.json", privateDir);
const env = parseEnv(await readFile(new URL(".env.local", root), "utf8"));
const [command, strategy = "push", ...flags] = process.argv.slice(2);
if (
  !["setup", "run", "inspect", "collect"].includes(command) ||
  !["conversation", "push", "pull"].includes(strategy)
)
  throw Error(
    "Usage: node scripts/experiments/workflow-lab.mjs setup|run|inspect|collect [conversation|push|pull] [--audio]",
  );
const audio = flags.includes("--audio");
if (flags.some((flag) => flag !== "--audio")) throw Error("Unknown option");
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const privateWrite = (name, value) =>
  writeFile(new URL(name, privateDir), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  manifest = { tools: {}, runs: [] };
}
const saveManifest = () => privateWrite("manifest.json", manifest);
async function api(method, path, body) {
  if (method !== "GET" && path.includes(env.ELEVENLABS_AGENT_ID))
    throw Error("Production agent mutation prohibited");
  const response = await fetch(`https://api.elevenlabs.io/v1${path}`, {
    method,
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
    redirect: "error",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await privateWrite(`api-error-${Date.now()}.json`, {
      method,
      path,
      status: response.status,
      data,
    });
    throw Error(
      `ElevenLabs ${method} ${path} HTTP ${response.status}; details saved privately`,
    );
  }
  return data;
}

if (command === "setup") {
  if (manifest.agentId) {
    console.log(JSON.stringify({ alreadyCreated: manifest.agentId }));
    process.exit(0);
  }
  const source = await api("GET", `/convai/agents/${env.ELEVENLABS_AGENT_ID}`);
  await privateWrite("source-agent.json", source);
  for (const tool of Object.values(toolDefinitions)) {
    if (manifest.tools[tool.name]) continue;
    const created = await api("POST", "/convai/tools", { tool_config: tool });
    manifest.tools[tool.name] = created.id;
    await saveManifest();
  }
  const payload = {
    name: "LegalMate — Isolated workflow latency lab",
    tags: ["legalmate-workflow-lab", "synthetic-only"],
    conversation_config: {
      tts: source.conversation_config.tts,
      turn: { turn_timeout: 15, silence_end_call_timeout: 120 },
      conversation: {
        text_only: false,
        max_duration_seconds: 240,
        client_events: [
          "agent_response",
          "agent_response_complete",
          "audio",
          "user_transcript",
          "interruption",
          "agent_tool_response_full_payload",
          "agent_tool_request",
        ],
      },
      agent: {
        first_message: "Tell me about this fictional shift.",
        language: "en",
        dynamic_variables: {
          dynamic_variable_placeholders: {
            case_context:
              "Synthetic case context supplied by the authenticated test client.",
          },
        },
        prompt: {
          prompt: basePrompt,
          llm: source.conversation_config.agent.prompt.llm,
          temperature: 0,
          max_tokens: 650,
          tool_ids: [],
          knowledge_base: [],
          rag: { enabled: false },
          timezone: "Australia/Melbourne",
        },
      },
    },
    platform_settings: {
      auth: { enable_auth: true },
      call_limits: {
        agent_concurrency_limit: 1,
        daily_limit: 12,
        bursting_enabled: false,
      },
      privacy: {
        record_voice: false,
        retention_days: 7,
        delete_audio: true,
        delete_transcript_and_pii: true,
      },
      overrides: {
        conversation_config_override: { conversation: { text_only: true } },
      },
    },
    workflow: buildWorkflow({
      strategy,
      contextToolId: manifest.tools.lab_get_case_context,
      saveToolId: manifest.tools.lab_save_medication_form,
    }),
  };
  await privateWrite("create-payload.json", payload);
  const created = await api("POST", "/convai/agents/create", payload);
  manifest.agentId = created.agent_id;
  manifest.sourceAgentId = source.agent_id;
  manifest.model = source.conversation_config.agent.prompt.llm;
  manifest.createdAt = new Date().toISOString();
  await saveManifest();
  console.log(
    JSON.stringify({
      created: manifest.agentId,
      model: manifest.model,
      productionAgentUnchanged: true,
    }),
  );
  process.exit(0);
}
if (!manifest.agentId || manifest.agentId === env.ELEVENLABS_AGENT_ID)
  throw Error("Run isolated setup first");
const current = await api("GET", `/convai/agents/${manifest.agentId}`);
if (
  current.name !== "LegalMate — Isolated workflow latency lab" ||
  !current.tags?.includes("synthetic-only")
)
  throw Error("Unexpected agent identity");
if (command === "inspect") {
  console.log(
    JSON.stringify(
      {
        agentId: manifest.agentId,
        model: manifest.model,
        nodes: current.workflow?.nodes,
        runs: manifest.runs,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (command === "collect") {
  for (const run of manifest.runs.filter((r) => r.conversationId)) {
    const saved = JSON.parse(await readFile(run.resultPath, "utf8"));
    const conversation = await api(
      "GET",
      `/convai/conversations/${run.conversationId}`,
    );
    const providerPath = run.resultPath.replace(
      /result\.json$/,
      "provider-conversation.json",
    );
    await writeFile(providerPath, JSON.stringify(conversation, null, 2), {
      mode: 0o600,
    });
    saved.providerStatus = conversation.status;
    saved.providerMetadata = conversation.metadata;
    saved.nodeTrace = (conversation.transcript ?? [])
      .filter((t) => t.role === "agent")
      .map((t) => ({
        node: t.agent_metadata?.workflow_node_id,
        message: t.message,
        metrics: t.conversation_turn_metrics,
        tools: t.tool_results,
      }));
    await writeFile(run.resultPath, JSON.stringify(saved, null, 2), {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        runId: run.runId,
        status: conversation.status,
        nodes: saved.nodeTrace.map((t) => t.node),
        cost: conversation.metadata?.cost,
        costFiat: conversation.metadata?.cost_fiat,
      }),
    );
  }
  process.exit(0);
}
if (manifest.runs.length >= 10)
  throw Error(
    "Experiment call limit reached; review results before more calls",
  );
await api("PATCH", `/convai/agents/${manifest.agentId}`, {
  workflow: buildWorkflow({
    strategy,
    contextToolId: manifest.tools.lab_get_case_context,
    saveToolId: manifest.tools.lab_save_medication_form,
  }),
});
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${strategy}${audio ? "-audio" : ""}`;
const outputDir = new URL(`test-results/workflow-lab/${runId}/`, root);
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const resultPath = new URL("result.json", outputDir);
const audioByTurn = new Map();
const sources = [];
const shared = {
  schema_version: 1,
  revision: 0,
  synthetic: true,
  participant: {
    id: "synthetic-jordan",
    name: "Jordan Test",
    communication: "Uses short spoken sentences.",
  },
  background: [
    {
      id: "history-2026-09-01",
      date: "2026-09-01",
      text: "On an earlier shift Jordan reported nausea. This is historical, not evidence of symptoms today.",
    },
  ],
  general_note: {},
  medication_form: {},
  medication_status: "not_started",
};
const result = {
  runId,
  strategy,
  audio,
  scenario: "missing-details-v2",
  experimentVersion,
  model: manifest.model,
  startedAt: new Date().toISOString(),
  scope:
    "Real provider workflow; local synthetic JSON shared-store adapter; no production D1/API or microphone integration.",
  events: [],
  turns: [],
  toolCalls: [],
  shared,
};
const persist = () =>
  writeFile(resultPath, JSON.stringify(result, null, 2), { mode: 0o600 });
manifest.runs.push({
  runId,
  resultPath: fileURLToPath(resultPath),
  status: "started",
});
await saveManifest();
const signed = await api(
  "GET",
  `/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(manifest.agentId)}&include_conversation_id=true`,
);
const ws = new WebSocket(signed.signed_url);
let activeTurn = null,
  lastActivity = Date.now(),
  fatalError,
  metadata;
const send = (event) => ws.send(JSON.stringify(event));
const context = () => ({
  ...structuredClone(shared),
  sources: structuredClone(sources),
  guidance:
    "Current worker facts and explicit saved corrections take precedence over historical background. Unknown is an answer. Do not diagnose or prescribe.",
});
const contextUpdate = () =>
  send({
    type: "contextual_update",
    text: JSON.stringify({ case_context: context() }),
    context_id: `case-revision-${shared.revision}`,
  });
const allowedFields = new Set([
  "medication_name",
  "scheduled_time",
  "variance",
  "actual_administered",
  "current_symptoms",
  "advice",
  "follow_up",
]);
let toolQueue = Promise.resolve();
let repeatedFailure = null;
let repeatedFailureCount = 0;
ws.addEventListener("message", ({ data }) => {
  const event = JSON.parse(String(data));
  const now = Date.now();
  if (event.type === "ping") {
    send({ type: "pong", event_id: event.ping_event.event_id });
    return;
  }
  lastActivity = now;
  if (event.type !== "audio") result.events.push({ at: now, ...event });
  if (event.type === "conversation_initiation_metadata") {
    metadata = event.conversation_initiation_metadata_event;
    result.conversationId = metadata.conversation_id;
  }
  if (event.type === "agent_response") {
    const text = event.agent_response_event.agent_response;
    console.log(
      JSON.stringify({
        strategy,
        assistant: text,
        elapsedMs: activeTurn ? now - activeTurn.sentAt : null,
      }),
    );
    if (activeTurn) {
      activeTurn.firstResponseMs ??= now - activeTurn.sentAt;
      activeTurn.responses.push(text);
    }
  }
  if (event.type === "audio" && activeTurn) {
    activeTurn.firstAudioMs ??= now - activeTurn.sentAt;
    activeTurn.audioChunks = (activeTurn.audioChunks ?? 0) + 1;
    const chunks = audioByTurn.get(activeTurn.index) ?? [];
    chunks.push(Buffer.from(event.audio_event.audio_base_64, "base64"));
    audioByTurn.set(activeTurn.index, chunks);
  }
  if (event.type === "agent_response_complete" && activeTurn)
    activeTurn.completeAt = now;
  if (event.type === "error")
    fatalError = new Error(`Provider socket error: ${JSON.stringify(event)}`);
  if (event.type === "client_tool_call") {
    toolQueue = toolQueue
      .then(async () => {
        const call = event.client_tool_call;
        if (result.toolCalls.length >= 16)
          throw Error("Experiment tool-call limit reached");
        let value;
        try {
          if (call.tool_name === "lab_get_case_context")
            value = { ok: true, case_context: context() };
          else if (call.tool_name === "lab_save_medication_form") {
            const patch = JSON.parse(call.parameters.fields_json);
            if (call.parameters.revision !== shared.revision) {
              value = {
                ok: false,
                error: "stale_revision",
                case_context: context(),
              };
            } else {
              for (const [key, field] of Object.entries(patch)) {
                if (
                  !allowedFields.has(key) ||
                  typeof field.value !== "string" ||
                  typeof field.source_quote !== "string" ||
                  !field.source_quote.trim() ||
                  !sources.some((s) => s.text.includes(field.source_quote))
                )
                  throw Error(
                    `Unsupported field or unverifiable current worker quote: ${key}`,
                  );
              }
              Object.assign(shared.medication_form, patch);
              shared.revision++;
              shared.medication_status = "documented";
              value = {
                ok: true,
                case_context: context(),
                instruction:
                  "Saved. Return to the main shift conversation without repeating answered medication questions. This is a factual draft, not clinical clearance.",
              };
              await persist();
            }
          } else throw Error("Unknown lab tool");
        } catch (error) {
          value = { ok: false, error: error.message, case_context: context() };
        }
        result.toolCalls.push({
          at: now,
          name: call.tool_name,
          params: call.parameters,
          result: value,
        });
        if (!value.ok) {
          value.next_action =
            "Read the exact supplied worker sources and correct the rejected patch. Do not repeat identical arguments. No save occurred.";
          const fingerprint = JSON.stringify({
            params: call.parameters,
            error: value.error,
          });
          repeatedFailureCount =
            fingerprint === repeatedFailure ? repeatedFailureCount + 1 : 1;
          repeatedFailure = fingerprint;
        } else {
          repeatedFailure = null;
          repeatedFailureCount = 0;
        }
        console.log(
          JSON.stringify({
            tool: call.tool_name,
            ok: value.ok,
            error: value.error,
            revision: shared.revision,
          }),
        );
        send({
          type: "client_tool_result",
          tool_call_id: call.tool_call_id,
          result: JSON.stringify(value),
          // The client function executed successfully. Validation rejections
          // are explicit application results (ok:false), not transport errors
          // for the provider's automatic tool retry handler.
          is_error: false,
        });
        await persist();
        if (repeatedFailureCount >= 2)
          throw Error(
            "Repeated unchanged invalid save stopped; saved draft retained",
          );
        if (
          strategy === "push" &&
          value.ok &&
          call.tool_name === "lab_save_medication_form"
        )
          contextUpdate();
      })
      .catch((error) => {
        fatalError = error;
      });
  }
});
ws.addEventListener("error", () => {
  fatalError = new Error("WebSocket transport error");
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (fatalError) throw fatalError;
    if (Date.now() > deadline)
      throw Error("Timed out waiting for workflow response");
    await pause(100);
  }
}
try {
  await waitUntil(() => ws.readyState === WebSocket.OPEN, 15000);
  send({
    type: "conversation_initiation_client_data",
    conversation_config_override: { conversation: { text_only: !audio } },
    dynamic_variables: { case_context: JSON.stringify(context()) },
  });
  await waitUntil(
    () => metadata && result.events.some((e) => e.type === "agent_response"),
  );
  if (audio) await waitUntil(() => Date.now() - lastActivity > 2200, 30000);
  const messages = [
    "I supported Jordan Test today from 9 am to 3 pm. We went to the library. Jordan chose a book independently and I helped with transport.",
    "There was a medication issue at lunch. The pack was empty, so I did not administer the scheduled dose. I do not know the medication name or dose.",
    "Jordan said he felt normal, and I observed no symptoms. I phoned manager Alex at 12:10, who said they would arrange a replacement. The replacement had not arrived when I left. I had written noon for the scheduled dose earlier. That is everything I know about the medication event.",
    "Correction: the scheduled dose was 1 pm, and I called Alex at 1:10 pm, not noon and 12:10. Everything else is unchanged. Please save that correction; that is all I know about medication.",
    "Let's return to the rest of the shift. Jordan chose a book independently at the library. Please briefly summarize the shift, including the corrected medication time and what remains unknown.",
  ];
  for (let index = 0; index < messages.length; index++) {
    const text = messages[index];
    // A synthetic worker edit in the form UI happens before specialist entry.
    // It is deliberately outside the spoken transcript: push/pull should expose
    // it; conversation-only cannot know it and is the control condition.
    if (index === 1) {
      const source = {
        id: "synthetic-ui-correction",
        origin: "worker_form_edit",
        text: "Correction to my written note: the scheduled dose was 1 pm.",
      };
      sources.push(source);
      shared.medication_form.scheduled_time = {
        value: "1 pm",
        source_quote: source.text,
      };
      shared.revision++;
    }
    sources.push({
      id: `worker-turn-${index + 1}`,
      origin: "worker_text",
      text,
    });
    if (strategy === "push") contextUpdate();
    activeTurn = { index: index + 1, text, sentAt: Date.now(), responses: [] };
    result.turns.push(activeTurn);
    send({ type: "user_message", text });
    await waitUntil(() => activeTurn.responses.length > 0 || fatalError, 45000);
    await waitUntil(
      () => Date.now() - lastActivity > (audio ? 2200 : 1300),
      45000,
    );
    await toolQueue;
    await persist();
  }
  result.status = "completed";
} catch (error) {
  result.status = "failed";
  result.error = error.message;
  console.error(JSON.stringify({ runId, error: error.message }));
} finally {
  if (ws.readyState === WebSocket.OPEN) ws.close();
  await toolQueue;
  if (
    audioByTurn.has(2) &&
    metadata?.agent_output_audio_format === "pcm_16000"
  ) {
    const pcm = Buffer.concat(audioByTurn.get(2));
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(pcm.length + 36, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    const wav = new URL("specialist-question.wav", outputDir);
    await writeFile(wav, Buffer.concat([header, pcm]), { mode: 0o600 });
    result.specialistAudioPath = fileURLToPath(wav);
  }
  await persist();
  const run = manifest.runs.find((r) => r.runId === runId);
  run.status = result.status;
  run.conversationId = result.conversationId;
  await saveManifest();
}
if (result.conversationId) {
  // One immediate evidence read; a later inspect can fetch completed metrics.
  try {
    const conversation = await api(
      "GET",
      `/convai/conversations/${result.conversationId}`,
    );
    await writeFile(
      new URL("provider-conversation.json", outputDir),
      JSON.stringify(conversation, null, 2),
      { mode: 0o600 },
    );
    result.providerStatus = conversation.status;
    result.nodeTrace = (conversation.transcript ?? [])
      .filter((t) => t.role === "agent")
      .map((t) => ({
        node: t.agent_metadata?.workflow_node_id,
        message: t.message,
        metrics: t.conversation_turn_metrics,
      }));
    await persist();
  } catch (error) {
    result.evidenceError = error.message;
    await persist();
  }
}
console.log(
  JSON.stringify(
    {
      runId,
      status: result.status,
      resultPath: fileURLToPath(resultPath),
      turns: result.turns.map(({ index, firstResponseMs, firstAudioMs }) => ({
        index,
        firstResponseMs,
        firstAudioMs,
      })),
      form: shared.medication_form,
      nodeTrace: result.nodeTrace?.map((t) => t.node),
    },
    null,
    2,
  ),
);
if (result.status !== "completed") process.exitCode = 1;
