import { readFile, readdir } from "node:fs/promises";

// New migrations delimit complete SQL statements explicitly. Older migrations
// only contain CREATE/ALTER statements, including triggers with internal ';'.
export function migrationStatements(sql) {
  const chunks = sql.includes("--> statement-breakpoint")
    ? sql.split("--> statement-breakpoint")
    : sql.replace(/--[^\n]*/g, "").split(/;\s*(?=(?:CREATE|ALTER)\b)/i);
  return chunks.map((statement) => statement.trim()).filter(Boolean);
}

export async function applyMigrations(db, { from, before } = {}) {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory))
    .filter(
      (name) =>
        name.endsWith(".sql") &&
        (!from || name >= from) &&
        (!before || name < before),
    )
    .sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    await db.batch(
      migrationStatements(sql).map((statement) => db.prepare(statement)),
    );
  }
  return files;
}
