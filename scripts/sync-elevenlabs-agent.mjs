// Default mode only inspects/backups the existing Agent. --apply is deliberately
// separate from app deployment; run it only once the matching app is online.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";

const agentId = "agent_8901m2a5v4rgeffbaaatcsgnhe38";
const mainBranchId = "agtbrch_0401m2a5v6szehna9ychmtnptxh8";
const args = process.argv.slice(2);
if (
  args.some((arg) => !["--check", "--apply"].includes(arg)) ||
  args.length > 1
)
  throw new Error(
    "Usage: node scripts/sync-elevenlabs-agent.mjs [--check|--apply]",
  );
const apply = args[0] === "--apply";
const config = parseEnv(
  await readFile(new URL("../.env.local", import.meta.url), "utf8"),
);
if (!config.ELEVENLABS_API_KEY)
  throw new Error("Missing local ElevenLabs key.");
if (config.ELEVENLABS_AGENT_ID && config.ELEVENLABS_AGENT_ID !== agentId)
  throw new Error("The local Agent ID does not match the intended deployment.");
const desiredPrompt = await readFile(
  new URL("../docs/elevenlabs-system-prompt.txt", import.meta.url),
  "utf8",
);
const desiredTools = JSON.parse(
  await readFile(
    new URL("../docs/elevenlabs-client-tools.json", import.meta.url),
    "utf8",
  ),
);
if (
  desiredTools.length !== 2 ||
  new Set(desiredTools.map((tool) => tool.name)).size !== 2 ||
  desiredTools.some(
    (tool) => tool.type !== "client" || tool.expects_response !== true,
  )
)
  throw new Error(
    "Expected two uniquely named recorder client tools that wait for responses.",
  );
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDirectory = new URL(
  `../.secrets/elevenlabs-sync/${stamp}/`,
  import.meta.url,
);
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
async function backup(name, value) {
  await writeFile(
    new URL(name, backupDirectory),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}
async function api(method, path, body) {
  if (method !== "GET" && !apply)
    throw new Error("Read-only mode cannot mutate the Agent.");
  const response = await fetch(`https://api.elevenlabs.io/v1${path}`, {
    method,
    redirect: "error",
    headers: {
      "xi-api-key": config.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { unparsedResponse: text };
  }
  if (!response.ok) {
    await backup(`api-error-${Date.now()}.json`, {
      method,
      path,
      status: response.status,
      result,
    });
    throw new Error(
      `ElevenLabs ${method} ${path} returned HTTP ${response.status}; private details are in the backup directory.`,
    );
  }
  return result;
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function matches(actual, desired, key = "") {
  if (Array.isArray(desired))
    return (
      Array.isArray(actual) &&
      desired.length === actual.length &&
      desired.every((value, index) => matches(actual[index], value))
    );
  if (desired && typeof desired === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual))
      return false;
    // Vendor-added schema defaults are harmless; extra model-selectable
    // properties are not. Compare property names exactly.
    if (
      key === "properties" &&
      digest(Object.keys(actual).sort()) !== digest(Object.keys(desired).sort())
    )
      return false;
    return Object.entries(desired).every(([child, value]) =>
      matches(actual[child], value, child),
    );
  }
  return actual === desired;
}
async function pages(path) {
  const values = [];
  let cursor;
  for (let index = 0; index < 20; index++) {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("cursor", cursor);
    const page = await api(
      "GET",
      `${path}${path.includes("?") ? "&" : "?"}${params}`,
    );
    values.push(page);
    if (!page.has_more) return values;
    if (!page.next_cursor || page.next_cursor === cursor)
      throw new Error("Invalid API pagination; no safe complete inventory.");
    cursor = page.next_cursor;
  }
  throw new Error("Tool inventory exceeded the inspection limit.");
}
function unrelatedConfig(value) {
  const copy = structuredClone(value);
  delete copy.conversation_config.agent.prompt.prompt;
  delete copy.conversation_config.agent.prompt.tool_ids;
  delete copy.conversation_config.agent.prompt.tools;
  return {
    name: copy.name,
    conversation_config: copy.conversation_config,
    platform_settings: copy.platform_settings,
    workflow: copy.workflow,
    tags: copy.tags,
    procedures: copy.procedures,
  };
}
const agent = await api("GET", `/convai/agents/${agentId}`);
await backup("agent-before.json", agent);
await backup("desired-tools.json", desiredTools);
await backup("desired-prompt.json", { prompt: desiredPrompt });
const prompt = agent.conversation_config?.agent?.prompt;
if (!prompt || typeof prompt.prompt !== "string")
  throw new Error(
    "Agent response does not contain the expected prompt configuration.",
  );
if (agent.branch_id !== mainBranchId || agent.main_branch_id !== mainBranchId)
  throw new Error(
    "The default Agent response is not the expected main branch.",
  );
const attachedIds = prompt.tool_ids ?? [];
if (new Set(attachedIds).size !== attachedIds.length)
  throw new Error("Duplicate attached tool IDs need review.");
const attached = await Promise.all(
  attachedIds.map(async (id) => {
    const value = await api("GET", `/convai/tools/${encodeURIComponent(id)}`);
    await backup(`tool-before-${id}.json`, value);
    return value;
  }),
);
const planned = await Promise.all(
  desiredTools.map(async (desired) => {
    const linked = attached.filter(
      (tool) => tool.tool_config?.name === desired.name,
    );
    if (linked.length > 1)
      throw new Error(`Multiple attached tools named ${desired.name}.`);
    let current = linked[0];
    if (!current) {
      const inventory = (
        await pages(
          `/convai/tools?search=${encodeURIComponent(desired.name)}&types=client`,
        )
      ).flatMap((page) => page.tools ?? []);
      const candidates = inventory.filter(
        (tool) => tool.tool_config?.name === desired.name,
      );
      if (candidates.length > 1)
        throw new Error(
          `Multiple existing tools named ${desired.name}; refusing to guess or create a duplicate.`,
        );
      if (candidates[0]) {
        current = await api(
          "GET",
          `/convai/tools/${encodeURIComponent(candidates[0].id)}`,
        );
        await backup(`tool-before-${current.id}.json`, current);
      }
    }
    if (current && current.tool_config.type !== "client")
      throw new Error(`Existing ${desired.name} is not a client tool.`);
    const changed = !current || !matches(current.tool_config, desired);
    if (current && changed) {
      const dependencies = await pages(
        `/convai/tools/${encodeURIComponent(current.id)}/dependent-agents`,
      );
      await backup(`dependencies-${current.id}.json`, dependencies);
      if (
        dependencies.some(
          (page) =>
            (page.agents ?? []).some((item) => item.id !== agentId) ||
            (page.branches ?? []).some(
              (item) =>
                item.agent_id !== agentId || item.branch_id !== mainBranchId,
            ),
        )
      )
        throw new Error(
          `${desired.name} is used by another Agent or branch; update requires an isolated copy, not a shared-tool mutation.`,
        );
    }
    return {
      desired,
      current,
      action: !current ? "create" : changed ? "update" : "reuse",
      attach: !current || !attachedIds.includes(current.id),
    };
  }),
);
const retiredRecorderTools = new Set([
  "search_participant_records",
  "register_followup",
  "prepare_confirmation",
  "finalize_form",
]);
const unrelatedIds = attached
  .filter(
    (tool) =>
      !desiredTools.some((desired) => desired.name === tool.tool_config.name) &&
      !retiredRecorderTools.has(tool.tool_config.name),
  )
  .map((tool) => tool.id);
const report = {
  mode: apply ? "apply" : "check",
  agentId,
  branchId: agent.branch_id,
  versionId: agent.version_id,
  name: agent.name,
  backupDirectory: fileURLToPath(backupDirectory),
  tools: planned.map(({ desired, current, action, attach }) => ({
    name: desired.name,
    action,
    attach,
    id: current?.id ?? null,
    changedFields: current
      ? Object.keys(desired).filter(
          (key) => !matches(current.tool_config[key], desired[key], key),
        )
      : Object.keys(desired),
    beforeTimeout: current?.tool_config.response_timeout_secs ?? null,
    afterTimeout: desired.response_timeout_secs,
  })),
  unrelatedToolIdsPreserved: unrelatedIds,
  retiredToolsDetached: attached
    .filter((tool) => retiredRecorderTools.has(tool.tool_config.name))
    .map((tool) => ({ id: tool.id, name: tool.tool_config.name })),
  promptChanged: prompt.prompt !== desiredPrompt,
  beforePromptHash: digest(prompt.prompt),
  desiredPromptHash: digest(desiredPrompt),
};
await backup("plan.json", report);
console.log(JSON.stringify(report, null, 2));
if (apply) {
  const fresh = await api("GET", `/convai/agents/${agentId}`);
  if (
    fresh.version_id !== agent.version_id ||
    digest(fresh.conversation_config) !== digest(agent.conversation_config)
  )
    throw new Error(
      "Agent changed during inspection; rerun the check before applying.",
    );
  const progress = { completedTools: [], agentUpdated: false };
  for (const item of planned) {
    if (item.action === "reuse") continue;
    if (item.current) {
      const freshTool = await api(
        "GET",
        `/convai/tools/${encodeURIComponent(item.current.id)}`,
      );
      if (digest(freshTool.tool_config) !== digest(item.current.tool_config))
        throw new Error(
          `${item.desired.name} changed during inspection; no overwrite performed.`,
        );
    }
    const body = {
      tool_config: { ...(item.current?.tool_config ?? {}), ...item.desired },
    };
    if (item.current?.response_mocks !== undefined)
      body.response_mocks = item.current.response_mocks;
    const result = await api(
      item.current ? "PATCH" : "POST",
      item.current
        ? `/convai/tools/${encodeURIComponent(item.current.id)}`
        : "/convai/tools",
      body,
    );
    if (!result.id || !matches(result.tool_config, item.desired))
      throw new Error(
        `Returned ${item.desired.name} configuration differs from the requested contract; inspect private backup before continuing.`,
      );
    item.current = result;
    progress.completedTools.push({
      id: result.id,
      name: item.desired.name,
      action: item.action,
    });
    await backup(`tool-after-${result.id}.json`, result);
    await backup("apply-progress.json", progress);
  }
  const toolIds = [...planned.map((item) => item.current.id), ...unrelatedIds];
  const needsAgentUpdate =
    prompt.prompt !== desiredPrompt || digest(attachedIds) !== digest(toolIds);
  if (needsAgentUpdate) {
    const beforePublish = await api("GET", `/convai/agents/${agentId}`);
    if (
      beforePublish.version_id !== agent.version_id ||
      digest(unrelatedConfig(beforePublish)) !== digest(unrelatedConfig(agent))
    )
      throw new Error(
        "Agent changed while tools were prepared; refusing to overwrite its newer configuration.",
      );
    // PATCH only the two intended nested fields; leave voice, LLM, credentials,
    // recording, retention, first message, events, and workflow untouched.
    const patch = {
      conversation_config: {
        agent: { prompt: { prompt: desiredPrompt, tool_ids: toolIds } },
      },
    };
    await backup("agent-patch.json", patch);
    const published = await api(
      "PATCH",
      `/convai/agents/${agentId}?branch_id=${encodeURIComponent(mainBranchId)}`,
      patch,
    );
    await backup("agent-patch-response.json", published);
    progress.agentUpdated = true;
    await backup("apply-progress.json", progress);
  }
  const after = await api("GET", `/convai/agents/${agentId}`);
  await backup("agent-after.json", after);
  if (
    after.conversation_config.agent.prompt.prompt !== desiredPrompt ||
    digest(after.conversation_config.agent.prompt.tool_ids) !== digest(toolIds)
  )
    throw new Error(
      "Post-update Agent verification failed; inspect the private backup.",
    );
  if (digest(unrelatedConfig(after)) !== digest(unrelatedConfig(agent)))
    throw new Error(
      "An unrelated Agent setting changed; inspect the before/after backups.",
    );
  const finalTools = await Promise.all(
    toolIds.map((id) => api("GET", `/convai/tools/${encodeURIComponent(id)}`)),
  );
  for (const desired of desiredTools) {
    const actual = finalTools.find(
      (tool) => tool.tool_config.name === desired.name,
    );
    if (!actual || !matches(actual.tool_config, desired))
      throw new Error(`Post-update verification failed for ${desired.name}.`);
  }
  console.log(
    JSON.stringify(
      {
        applied: needsAgentUpdate || progress.completedTools.length > 0,
        verified: true,
        agentId,
        branchId: after.branch_id,
        versionId: after.version_id,
        toolCount: toolIds.length,
        unrelatedSettingsPreserved: true,
        backupDirectory: fileURLToPath(backupDirectory),
      },
      null,
      2,
    ),
  );
}
