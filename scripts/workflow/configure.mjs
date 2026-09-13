import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import {
  buildWorkflow,
  buildClientToolDefinitions,
  basePrompt,
  configurationVersion,
} from "../../config/agents/workflow.mjs";

const root = new URL("../../", import.meta.url);
export async function configureWorkflowAgent(baseUrl, { model } = {}) {
  const directory = new URL(".secrets/workflow-app/", root);
  const tag = "legalmate-workflow-app-test";
  if (
    model &&
    !["gpt-4.1-mini", "gemini-2.5-flash", "qwen35-397b-a17b"].includes(model)
  )
    throw Error("Choose a verified workflow comparison model");
  const origin = new URL(baseUrl);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw Error("Provide a plain HTTPS application origin");
  const env = parseEnv(await readFile(new URL(".env.local", root), "utf8"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifestFile = new URL("manifest.json", directory);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    manifest = { tools: {}, configurationVersion };
  }
  const persist = () =>
    writeFile(manifestFile, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  async function api(method, path, body) {
    if (method !== "GET" && path.includes(env.ELEVENLABS_AGENT_ID))
      throw Error(
        "Configured production agent cannot be mutated by workflow setup",
      );
    const response = await fetch(`https://api.elevenlabs.io/v1${path}`, {
      method,
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    const value = await response.json();
    if (!response.ok) {
      await writeFile(
        new URL(`api-error-${Date.now()}.json`, directory),
        JSON.stringify({ method, path, status: response.status, value }),
        { mode: 0o600 },
      );
      throw Error(
        `ElevenLabs ${method} ${path}: ${response.status}; details saved privately`,
      );
    }
    return value;
  }
  const source = await api("GET", `/convai/agents/${env.ELEVENLABS_AGENT_ID}`);
  if (manifest.agentId) {
    const existing = await api("GET", `/convai/agents/${manifest.agentId}`);
    if (!existing.tags?.includes(tag))
      throw Error("Refusing to update an agent not owned by workflow setup");
  }
  const definitions = buildClientToolDefinitions();
  for (const [kind, tool_config] of Object.entries(definitions)) {
    if (manifest.tools[kind]) {
      const current = await api("GET", `/convai/tools/${manifest.tools[kind]}`);
      if (current.tool_config.name !== tool_config.name)
        throw Error("Workflow tool identity mismatch");
      const deps = await api(
        "GET",
        `/convai/tools/${manifest.tools[kind]}/dependent-agents?page_size=100`,
      );
      if (
        deps.has_more ||
        (deps.agents ?? []).some((item) => item.id !== manifest.agentId) ||
        (deps.branches ?? []).some((item) => item.agent_id !== manifest.agentId)
      )
        throw Error(
          "Workflow tool has dependencies outside its isolated agent",
        );
      await api("PATCH", `/convai/tools/${manifest.tools[kind]}`, {
        tool_config,
      });
    } else {
      const created = await api("POST", "/convai/tools", { tool_config });
      manifest.tools[kind] = created.id;
      await persist();
    }
  }
  const configuration = {
    conversation_config: {
      tts: {
        ...source.conversation_config.tts,
        agent_output_audio_format: "pcm_16000",
      },
      turn: { turn_timeout: 15, silence_end_call_timeout: 120 },
      conversation: {
        text_only: false,
        max_duration_seconds: 600,
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
              "Synthetic case supplied by the authenticated application.",
          },
        },
        prompt: {
          prompt: basePrompt,
          llm:
            model ??
            manifest.model ??
            source.conversation_config.agent.prompt.llm,
          reasoning_effort: null,
          thinking_budget: model === "gemini-2.5-flash" ? 0 : null,
          enable_reasoning_summary: false,
          temperature: 0,
          max_tokens: 2200,
          tool_ids: Object.values(manifest.tools),
          knowledge_base: [],
          rag: { enabled: false },
          timezone: "Australia/Melbourne",
        },
      },
    },
    workflow: buildWorkflow({
      contextToolId: manifest.tools.context,
      saveToolId: manifest.tools.save,
    }),
    name: "LegalMate — Risk conversation test",
    tags: [tag, "synthetic-only"],
    platform_settings: {
      auth: { enable_auth: true },
      call_limits: {
        agent_concurrency_limit: 1,
        daily_limit: 24,
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
  };
  if (manifest.agentId)
    await api("PATCH", `/convai/agents/${manifest.agentId}`, configuration);
  else {
    const created = await api("POST", "/convai/agents/create", configuration);
    manifest.agentId = created.agent_id;
    await persist();
  }
  const actual = await api("GET", `/convai/agents/${manifest.agentId}`);
  if (
    Object.keys(actual.workflow.nodes).length !== 8 ||
    Object.keys(actual.workflow.edges).length !== 7
  )
    throw Error("Persisted workflow graph does not match all six specialists");
  manifest.versionId = actual.version_id;
  manifest.branchId = actual.branch_id;
  manifest.configurationVersion = configurationVersion;
  manifest.model = actual.conversation_config.agent.prompt.llm;
  manifest.transport = "client";
  manifest.baseUrl = origin.origin;
  manifest.updatedAt = new Date().toISOString();
  await persist();
  await writeFile(
    new URL("configured-agent.json", directory),
    JSON.stringify(actual, null, 2),
    { mode: 0o600 },
  );
  return { manifest };
}
