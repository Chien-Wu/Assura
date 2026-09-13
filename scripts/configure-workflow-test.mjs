import { readFile, writeFile } from "node:fs/promises";
import { configureWorkflowAgent } from "./workflow/configure.mjs";

const origin = process.argv[2];
if (!origin) throw Error("Supply the HTTPS application origin");
const { manifest } = await configureWorkflowAgent(origin, {
  model: "gemini-2.5-flash",
});
const file = new URL("../.env.local", import.meta.url);
let contents = await readFile(file, "utf8");
for (const [key, value] of Object.entries({
  LEGALMATE_WORKFLOW_ENABLED: "true",
  ELEVENLABS_WORKFLOW_AGENT_ID: manifest.agentId,
  ELEVENLABS_WORKFLOW_VERSION_ID: manifest.versionId,
})) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  contents = pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}\n${line}\n`;
}
await writeFile(file, contents, { mode: 0o600 });
console.log(
  JSON.stringify({
    agentId: manifest.agentId,
    versionId: manifest.versionId,
    model: manifest.model,
    transport: manifest.transport,
  }),
);
