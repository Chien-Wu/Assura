import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createScheduledShiftQuery } from "../lib/shifts.ts";
import { importHistory, readHistory } from "./seed-patient-history.mjs";

const release = fileURLToPath(new URL("../", import.meta.url));
const persistence = "/var/lib/legalmate/state/v3/d1";
const args = process.argv.slice(2);
assert.ok(
  args.length <= 1 &&
    (!args[0] || ["--check", "--import", "--verify"].includes(args[0])),
  "Use --check (default), --import or --verify. Custom targets are not supported.",
);
const mode = args[0] ?? "--check";
const fixture = await readHistory();
const shift = {
  id: "2dfe74b8-8f5e-4b62-af4b-18e46a5cb5d4",
  provider_id: fixture.providerId,
  participant_id: fixture.participant.id,
  worker_id: fixture.workerId,
  worker_name: fixture.workerName,
  expected_start: "2026-09-13T10:00",
  expected_end: "2026-09-13T12:00",
  timezone: fixture.timezone,
  created_by: "synthetic_fixture:sarah-doyle-rag-demo-v1",
};

if (mode === "--check") {
  console.log(
    JSON.stringify(
      {
        mode: "fixture_check",
        synthetic: true,
        shift,
        databaseOpened: false,
        noteCreated: false,
      },
      null,
      2,
    ),
  );
} else {
  assert.equal(process.platform, "linux", "Run on the existing Linux VM.");
  assert.ok(process.getuid() > 0, "Run as legalmate, not root.");
  assert.equal(
    execFileSync("/usr/bin/id", ["-un"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim(),
    "legalmate",
    "Run as the legalmate service account.",
  );
  assert.equal(
    execFileSync(
      "/usr/bin/systemctl",
      ["show", "legalmate.service", "--property=ActiveState", "--value"],
      { encoding: "utf8", timeout: 5000 },
    ).trim(),
    "inactive",
    "Stop legalmate.service inside the backed-up maintenance window first.",
  );
  assert.equal(
    (await stat(persistence)).isDirectory(),
    true,
    "Existing VM persistence is required.",
  );
  assert.ok(
    (await realpath(release)).startsWith("/opt/legalmate/releases/"),
    "Run from a deployed release.",
  );
  async function databaseIdentity(directory) {
    const config = JSON.parse(
      await readFile(resolve(directory, "dist/server/wrangler.json"), "utf8"),
    );
    const bindings = config.d1_databases?.filter(
      (binding) => binding.binding === "DB",
    );
    assert.equal(bindings?.length, 1, "Exactly one DB binding is required.");
    const id = bindings[0].preview_database_id ?? bindings[0].database_id;
    assert.ok(
      typeof id === "string" && id.length > 0,
      "DB identity is missing.",
    );
    return id;
  }
  const databaseId = await databaseIdentity(release);
  assert.equal(
    databaseId,
    await databaseIdentity("/opt/legalmate/current"),
    "Use the active deployment's DB identity.",
  );
  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({
    modules: true,
    script:
      "export default { fetch() { return new Response('Synthetic RAG demo preparation'); } };",
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
    // Reuse the strict fixture/account preflight, while forbidding its writes.
    await importHistory(
      {
        prepare: db.prepare.bind(db),
        batch: async () => {
          throw new Error(
            "Import and verify the ten source notes first; this script never creates history or accounts.",
          );
        },
      },
      fixture,
    );
    const columns = Object.keys(shift).join(",");
    const existing = await db
      .prepare(`SELECT ${columns} FROM scheduled_shifts WHERE id=?`)
      .bind(shift.id)
      .first();
    let inserted = 0;
    if (existing) {
      assert.deepEqual(
        existing,
        shift,
        "Demo shift ID conflicts with an existing record; nothing was changed.",
      );
    } else {
      assert.equal(
        mode,
        "--import",
        "Demo shift is absent; --verify never creates records.",
      );
      const result = await db
        .prepare(createScheduledShiftQuery)
        .bind(
          shift.id,
          shift.provider_id,
          shift.expected_start,
          shift.expected_end,
          shift.timezone,
          shift.created_by,
          new Date().toISOString(),
          shift.participant_id,
          shift.provider_id,
          shift.worker_id,
          fixture.managerId,
        )
        .run();
      assert.equal(
        result.meta.changes,
        1,
        "Active worker, participant or manager scope changed; no demo shift was inserted.",
      );
      inserted = 1;
    }
    const saved = await db
      .prepare(`SELECT ${columns} FROM scheduled_shifts WHERE id=?`)
      .bind(shift.id)
      .first();
    assert.deepEqual(
      saved,
      shift,
      "Saved demo shift differs from the reviewed fixture.",
    );
    const notes = await db
      .prepare(
        "SELECT COUNT(*) AS existingNotes FROM shift_notes WHERE shift_id=?",
      )
      .bind(shift.id)
      .first();
    console.log(
      JSON.stringify(
        {
          mode: mode.slice(2),
          synthetic: true,
          shiftId: shift.id,
          expectedStart: shift.expected_start,
          expectedEnd: shift.expected_end,
          timezone: shift.timezone,
          inserted,
          verified: true,
          existingNotes: notes.existingNotes,
          noteCreated: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await mf.dispose();
  }
}
