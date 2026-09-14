import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importHistory, readHistory } from "./seed-patient-history.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length <= 1 &&
    (!args[0] ||
      ["--check", "--import", "--verify", "--help"].includes(args[0])),
  "Use --check, --import, --verify or --help. No custom target or remote D1 option is accepted.",
);
const mode = args[0] ?? "--check";
const dataset = await readHistory();
if (mode === "--help") {
  console.log(
    "Usage: node --experimental-strip-types scripts/seed-vm-patient-history.mjs [--check|--import|--verify]\n--check (default): validate the fixed synthetic fixture only; no database access.\n--import: insert or verify exactly this fixture in the existing VM D1 database.\n--verify: verify the exact existing fixture without allowing inserts.\nVM operations require Linux, an unprivileged user, a stopped Assura application service, existing persistence, active-release DB identity, migrations 0006/0007 and existing verified TestProvider worker/manager accounts. Use the deployment maintenance window and an existing stopped-service backup. No auth, schema, unrelated records or runtime environment are modified.",
  );
} else if (mode === "--check") {
  console.log(
    JSON.stringify(
      {
        mode: "fixture_check",
        synthetic: true,
        datasetId: dataset.datasetId,
        participants: 1,
        shifts: dataset.notes.length,
        notes: dataset.notes.length,
        databaseOpened: false,
      },
      null,
      2,
    ),
  );
} else {
  assert.equal(
    process.platform,
    "linux",
    "VM import runs only on the Linux deployment host.",
  );
  assert.ok(
    process.getuid() > 0,
    "Run as the unprivileged application service account, not root.",
  );
  // The fixed deployment layouts preserve existing persistence after rebranding;
  // callers cannot redirect this operator tool to an arbitrary database.
  const releaseRoot = await realpath(root);
  const deployment = ["assura", "legalmate"].find((name) =>
    releaseRoot.startsWith(`/opt/${name}/releases/`),
  );
  assert.ok(deployment, "Run this script from a deployed Assura release.");
  const deploymentRoot = `/opt/${deployment}`;
  const persistence = `/var/lib/${deployment}/state/v3/d1`;
  const username = execFileSync("/usr/bin/id", ["-un"], {
    encoding: "utf8",
    timeout: 5000,
  }).trim();
  assert.ok(
    ["assura", "legalmate"].includes(username),
    "Only an Assura application service account may open VM persistence.",
  );
  let matchingServices = 0;
  for (const service of ["assura.service", "legalmate.service"]) {
    const serviceQuery = spawnSync(
      "/usr/bin/systemctl",
      [
        "show",
        service,
        "--property=LoadState,ActiveState,User,WorkingDirectory",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.ifError(serviceQuery.error);
    const properties = Object.fromEntries(
      serviceQuery.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    if (properties.LoadState === "not-found") continue;
    assert.equal(serviceQuery.status, 0, `Could not inspect ${service}.`);
    if (
      properties.LoadState !== "loaded" ||
      properties.WorkingDirectory !== `${deploymentRoot}/current`
    ) {
      continue;
    }
    matchingServices += 1;
    assert.equal(
      properties.User,
      username,
      `Run as the service account configured for ${service}.`,
    );
    assert.equal(
      properties.ActiveState,
      "inactive",
      `Stop ${service} inside the maintenance window before opening persistent D1.`,
    );
  }
  assert.ok(
    matchingServices > 0,
    "No application service matches this deployment; no database was opened.",
  );
  assert.equal(
    (await stat(persistence)).isDirectory(),
    true,
    "Existing VM D1 persistence is required; no directory is provisioned.",
  );
  async function databaseIdentity(release) {
    const config = JSON.parse(
      await readFile(resolve(release, "dist/server/wrangler.json"), "utf8"),
    );
    const bindings = config.d1_databases?.filter(
      (binding) => binding.binding === "DB",
    );
    assert.equal(
      bindings?.length,
      1,
      "The build must define exactly one DB binding.",
    );
    const id = bindings[0].preview_database_id ?? bindings[0].database_id;
    assert.ok(
      typeof id === "string" && id.length > 0,
      "The built DB identity is missing.",
    );
    return id;
  }
  const databaseId = await databaseIdentity(root);
  assert.equal(
    databaseId,
    await databaseIdentity(`${deploymentRoot}/current`),
    "Candidate DB identity differs from the active release; no database was opened.",
  );
  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({
    modules: true,
    script:
      "export default { fetch() { return new Response('Synthetic fixture maintenance'); } };",
    compatibilityDate: "2026-05-15",
    host: "127.0.0.1",
    port: 0,
    cf: false,
    outboundService: () =>
      new Response("Network access disabled", { status: 403 }),
    d1Databases: { DB: databaseId },
    d1Persist: persistence,
  });
  try {
    const db = await mf.getD1Database("DB");
    const schema = await db
      .prepare(
        "SELECT count(*) AS total FROM sqlite_master WHERE name IN ('knowledge_fts','retrieval_runs','interview_questions','interview_question_events','knowledge_note_insert','knowledge_note_update','knowledge_note_delete')",
      )
      .first();
    assert.equal(
      schema.total,
      7,
      "Apply the reviewed RAG migrations before importing history.",
    );
    const readonly = {
      prepare: db.prepare.bind(db),
      batch: async () => {
        throw new Error(
          "The fixture is absent; --verify never inserts records. Run the reviewed --import procedure.",
        );
      },
    };
    const imported = await importHistory(
      mode === "--import" ? db : readonly,
      dataset,
    );
    const verified = await importHistory(readonly, dataset);
    assert.equal(verified.inserted, 0);
    const placeholders = dataset.notes.map(() => "?").join(",");
    const ids = dataset.notes.map((note) => note.id);
    const counts = await db
      .prepare(
        `SELECT COUNT(*) AS confirmedNotes,
      SUM(CASE WHEN source.owner_id=? AND source.provider_id=? AND source.participant_id=?
        AND assigned.worker_id=source.owner_id AND assigned.provider_id=source.provider_id
        AND assigned.participant_id=source.participant_id THEN 1 ELSE 0 END) AS correctlyScoped,
      SUM(CASE WHEN json_extract(source.confirmation_evidence,'$.synthetic')=1 THEN 1 ELSE 0 END) AS syntheticNotes
      FROM shift_notes source JOIN scheduled_shifts assigned ON assigned.id=source.shift_id
      WHERE source.id IN (${placeholders}) AND source.status='complete' AND source.confirmed_at IS NOT NULL`,
      )
      .bind(
        dataset.workerId,
        dataset.providerId,
        dataset.participant.id,
        ...ids,
      )
      .first();
    const indexed = await db
      .prepare(
        `SELECT COUNT(*) AS indexedNotes FROM knowledge_fts
      JOIN shift_notes source ON source.id=knowledge_fts.note_id AND source.revision=knowledge_fts.revision
      WHERE source.id IN (${placeholders})`,
      )
      .bind(...ids)
      .first();
    for (const count of [...Object.values(counts), indexed.indexedNotes])
      assert.equal(count, 10, "Fixture scope or FTS verification failed.");
    console.log(
      JSON.stringify(
        {
          mode: mode.slice(2),
          synthetic: true,
          datasetId: dataset.datasetId,
          inserted: imported.inserted,
          verified: true,
          ...counts,
          ...indexed,
          idempotentVerification: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await mf.dispose();
  }
}
