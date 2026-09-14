import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function provisioningStatements(
  { id, name, managerEmail },
  now = new Date().toISOString(),
) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error(
      "Provider ID must contain 1 to 80 letters, numbers, hyphens or underscores.",
    );
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 160
  )
    throw new Error(
      "Provide a service provider name using 2 to 160 characters.",
    );
  const email =
    typeof managerEmail === "string" ? managerEmail.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("Provide the first manager's email address.");
  return [
    {
      sql: `INSERT INTO providers (id,name,active,created_at) VALUES (?,?,1,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=1`,
      params: [id, name.trim(), now],
    },
    {
      sql: `INSERT INTO provider_manager_grants (id,provider_id,email,active,created_at) VALUES (?,?,?,1,?)
        ON CONFLICT(provider_id,email) DO UPDATE SET active=1`,
      params: [randomUUID(), id, email, now],
    },
  ];
}

// Wrangler's SQL-file interface has no separate bindings field. Encode each
// already-validated parameter as a SQLite UTF-8 hex literal, never shell text.
export function boundSql(statement) {
  let index = 0;
  const sql = statement.sql.replace(/\?/g, () => {
    if (index >= statement.params.length)
      throw new Error("Missing SQL parameter.");
    return `CAST(X'${Buffer.from(String(statement.params[index++]), "utf8").toString("hex")}' AS TEXT)`;
  });
  if (index !== statement.params.length)
    throw new Error("Unused SQL parameter.");
  return sql + ";";
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: node scripts/provision-provider.mjs --name NAME --manager-email EMAIL [--id ID] [--local --config PATH]\nWithout --local, prints parameterized statements only. --local runs Wrangler against this project's local D1 state. No remote option is supported.",
    );
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--local") options.local = true;
    else if (["--name", "--manager-email", "--id", "--config"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  const id = options.id ?? randomUUID();
  const statements = provisioningStatements({
    id,
    name: options.name,
    managerEmail: options["manager-email"],
  });
  if (!options.local) {
    console.log(JSON.stringify({ providerId: id, statements }, null, 2));
    return;
  }
  if (!options.config)
    throw new Error(
      "--local requires --config pointing to the project's generated Wrangler config.",
    );
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temporary = mkdtempSync(join(tmpdir(), "assura-provider-"));
  try {
    const sqlFile = join(temporary, "provision.sql");
    writeFileSync(sqlFile, statements.map(boundSql).join("\n"), {
      mode: 0o600,
    });
    const result = spawnSync(
      process.execPath,
      [
        join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
        "d1",
        "execute",
        "DB",
        "--local",
        "--config",
        resolve(projectRoot, options.config),
        "--persist-to",
        join(projectRoot, ".wrangler/state"),
        "--file",
        sqlFile,
      ],
      {
        cwd: projectRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: "false",
          WRANGLER_WRITE_LOGS: "false",
          WRANGLER_LOG_PATH: join(projectRoot, ".wrangler/logs"),
          WRANGLER_REGISTRY_PATH: join(projectRoot, ".wrangler/dev-registry"),
        },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        "Local provisioning failed. Verify that migrations have been applied.",
      );
    console.log(
      `Provisioned service provider ${id}. The manager must sign in and verify ${options["manager-email"]}.`,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Provider setup failed.",
    );
    process.exitCode = 1;
  }
}
