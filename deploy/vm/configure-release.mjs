import fs from "node:fs";
import path from "node:path";

const release = process.cwd();
const configPath = path.join(release, "dist/server/wrangler.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
for (const database of config.d1_databases ?? []) {
  database.migrations_dir = path.join(release, "database", "migrations");
}
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
