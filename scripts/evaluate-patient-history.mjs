import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { format } from "prettier";
import {
  boundedKnowledgeSources,
  eligibleKnowledgeSql,
  knowledgeCutoff,
  KNOWLEDGE_CANDIDATE_LIMIT,
  KNOWLEDGE_SOURCE_LIMIT,
  literalKnowledgeQuery,
  sourceIsHistorical,
} from "../lib/knowledge.ts";
import { readSafety } from "../lib/safety.ts";
import { buildHistoryRows, readHistory } from "./seed-patient-history.mjs";
import { testAccountStatements } from "./provision-test-accounts.mjs";

if (process.argv.slice(2).some((arg) => arg !== "--write-doc"))
  throw new Error(
    "Usage: node --experimental-strip-types scripts/evaluate-patient-history.mjs [--write-doc]",
  );
const fixture = await readHistory();
const fixedInstant = "2026-09-14T00:00:00.000Z";
const cases = [
  ["craft trial/group", "craft trial group", ["2026-09-12"]],
  [
    "walking group cancelled",
    "walking group cancelled",
    ["2026-09-07", "2026-09-08"],
  ],
  ["cafe noise", "cafe noise", ["2026-09-03", "2026-09-04"]],
  ["sandwich tired", "sandwich tired", ["2026-09-08", "2026-09-09"]],
  ["transport bus delay", "transport bus delay", ["2026-09-10"]],
  ["appetite paraphrase", "appetite", ["2026-09-03", "2026-09-08"]],
];
const db = new DatabaseSync(":memory:");
function insert(table, row) {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...Object.values(row));
}
function sourceDto(row) {
  const authored = JSON.parse(row.fields_json);
  const safety = readSafety(row.safety_json);
  const fields = Object.fromEntries(
    [
      "shiftStart",
      "shiftEnd",
      "activities",
      "supportProvided",
      "participantResponse",
      "goalProgress",
      "incidents",
      "incidentDetails",
      "followUp",
      "followUpDetails",
    ].map((key) => [key, authored[key]]),
  );
  for (const key of ["incidents", "followUp"])
    if (
      ["no", "none"].includes(fields[key]) &&
      safety.fieldStates[key] !== "stated_negative"
    )
      fields[key] = "unknown";
  return {
    sourceId: `${row.id}@${row.revision}`,
    noteId: row.id,
    revision: row.revision,
    shiftStart: fields.shiftStart,
    shiftEnd: fields.shiftEnd,
    confirmedAt: row.confirmed_at,
    workerName: row.worker_name,
    fields,
    isSynthetic: JSON.parse(row.confirmation_evidence).synthetic === true,
  };
}
function retrieve(query, actualStart = "2026-09-13T10:00") {
  const { cutoff } = knowledgeCutoff(
    actualStart,
    null,
    fixture.timezone,
    false,
    Date.parse(fixedInstant),
  );
  assert.ok(cutoff);
  const scope = [
    fixture.workerId,
    fixture.providerId,
    fixture.participant.id,
    "evaluation-current-note",
    cutoff.local,
    cutoff.utc,
  ];
  const convert = (rows) =>
    rows.map(sourceDto).filter((source) => sourceIsHistorical(source, cutoff));
  const baseline = convert(
    db
      .prepare(
        `SELECT source.* FROM shift_notes source WHERE ${eligibleKnowledgeSql} ORDER BY json_extract(source.fields_json,'$.shiftStart'),source.id`,
      )
      .all(...scope),
  );
  const sql = `SELECT source.*,bm25(knowledge_fts) AS match_rank FROM knowledge_fts
    JOIN shift_notes source ON source.id=knowledge_fts.note_id AND source.revision=knowledge_fts.revision
    WHERE knowledge_fts MATCH ? AND ${eligibleKnowledgeSql}`;
  const params = [
    literalKnowledgeQuery(query).match,
    ...scope,
    KNOWLEDGE_CANDIDATE_LIMIT + 1,
  ];
  const ranked = convert(
    db.prepare(sql + " ORDER BY match_rank,source.id LIMIT ?").all(...params),
  );
  const recent = convert(
    db
      .prepare(
        sql +
          " ORDER BY json_extract(source.fields_json,'$.shiftStart') DESC,source.id LIMIT ?",
      )
      .all(...params),
  );
  // Mirror runtime order exactly; do not add synonyms or use expected labels.
  const ordered = [
    ...ranked.slice(0, 2),
    ...recent.slice(0, 2),
    ...ranked,
    ...recent,
  ].filter(
    (source, index, all) =>
      all.findIndex((item) => item.sourceId === source.sourceId) === index,
  );
  return {
    baseline,
    fts: boundedKnowledgeSources(ordered, KNOWLEDGE_SOURCE_LIMIT).sources,
    cutoff,
  };
}
function metrics(sources, expected) {
  const dates = sources.map((source) => source.shiftStart.slice(0, 10));
  const hits = expected.filter((date) => dates.includes(date)).length;
  return {
    dates,
    sourceCount: sources.length,
    expectedHits: hits,
    expectedTotal: expected.length,
    recall: hits / expected.length,
    serializedSourceCharacters: JSON.stringify(sources).length,
  };
}

let report;
try {
  db.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort())
    db.exec(readFileSync(new URL(name, migrations), "utf8"));
  for (const statement of testAccountStatements(fixedInstant))
    db.prepare(statement.sql).run(...statement.params);
  const rows = buildHistoryRows(fixture, fixedInstant);
  insert("provider_participants", rows.participant);
  for (const shift of rows.shifts) insert("scheduled_shifts", shift);
  for (const note of rows.notes) insert("shift_notes", note);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM knowledge_fts").get().count,
    10,
  );
  const results = cases.map(([name, query, expectedDates]) => {
    const { baseline, fts } = retrieve(query);
    assert.equal(baseline.length, 10);
    return {
      name,
      query,
      expectedDates,
      baseline: metrics(baseline, expectedDates),
      fts: metrics(fts, expectedDates),
    };
  });
  const retrospective = retrieve("sandwich tired", "2026-09-08T10:00");
  assert.ok(
    [...retrospective.baseline, ...retrospective.fts].every(
      (source) => source.shiftEnd <= retrospective.cutoff.local,
    ),
  );
  const excludedSeptember9 = !retrospective.fts.some((source) =>
    source.shiftStart.startsWith("2026-09-09"),
  );
  assert.equal(excludedSeptember9, true);
  report = {
    datasetId: fixture.datasetId,
    synthetic: true,
    cutoff: "2026-09-13T10:00 Australia/Melbourne",
    baseline:
      "All 10 eligible whole-source DTOs; diagnostic comparison, not production context loading.",
    algorithm:
      "Porter FTS5 literal OR terms; top 2 relevance, top 2 recency, then relevance/recency fill; max 4 whole sources and runtime character bounds.",
    results,
    aggregate: Object.fromEntries(
      ["baseline", "fts"].map((method) => {
        const hits = results.reduce(
          (total, result) => total + result[method].expectedHits,
          0,
        );
        const expected = results.reduce(
          (total, result) => total + result[method].expectedTotal,
          0,
        );
        return [
          method,
          {
            expectedHits: hits,
            expectedTotal: expected,
            recall: hits / expected,
            serializedSourceCharacters: results.reduce(
              (total, result) =>
                total + result[method].serializedSourceCharacters,
              0,
            ),
          },
        ];
      }),
    ),
    retrospective: {
      query: "sandwich tired",
      cutoff: retrospective.cutoff,
      returnedDates: retrospective.fts.map((source) =>
        source.shiftStart.slice(0, 10),
      ),
      excludedSeptember9,
    },
  };
} finally {
  db.close();
}

if (process.argv.includes("--write-doc")) {
  const short = (dates) =>
    dates.map((date) => date.slice(5)).join(", ") || "none";
  const lines = report.results.map(
    (result) =>
      `| ${result.query} | ${short(result.expectedDates)} | ${short(result.fts.dates)} | ${result.baseline.expectedHits}/${result.baseline.expectedTotal} | ${result.fts.expectedHits}/${result.fts.expectedTotal} | ${result.baseline.serializedSourceCharacters} | ${result.fts.serializedSourceCharacters} |`,
  );
  const doc = `# Participant history retrieval diagnostic

Reproduce with \`node --experimental-strip-types scripts/evaluate-patient-history.mjs --write-doc\` from \`web\`. The command prints deterministic JSON and regenerates this report. It creates an isolated in-memory SQLite database, applies the repository migrations, and inserts the ten fictional Sarah Doyle notes. It does not access a running database or any external service.

The six cases below use a current shift start of **13 September 2026, 10:00 Australia/Melbourne**. Expected dates are hand-authored evaluation labels, not indexed text. FTS indexes authored note fields only; fixture topics and continuity metadata are excluded. Selection mirrors the runtime relevance/recency order and whole-source bounds without changing its query or adding synonyms.

| Query | Expected note dates | FTS returned dates | All-notes recall | FTS recall | All-notes characters | FTS characters |
| --- | --- | --- | --- | --- | --- | --- |
${lines.join("\n")}

Recall counts expected source notes retrieved, not correct answers or useful questions. Dates in the table are month-day in 2026. Characters are the length of the serialized source DTO array, including metadata and JSON punctuation; they are not tokens. The all-notes comparison always supplies all ten eligible sources, without the production context limits, so its full recall follows from including the expected records.

Across these fixed cases, FTS retrieved **${report.aggregate.fts.expectedHits}/${report.aggregate.fts.expectedTotal} expected sources (${Math.round(report.aggregate.fts.recall * 100)}%)**, compared with **${report.aggregate.baseline.expectedHits}/${report.aggregate.baseline.expectedTotal}** for all notes. Total serialized characters across the six requests were **${report.aggregate.fts.serializedSourceCharacters}** for FTS and **${report.aggregate.baseline.serializedSourceCharacters}** for all notes. These totals do not establish latency, operating cost or LLM quality.

The unchanged paraphrase query **appetite** ${report.results[5].fts.expectedHits ? "did not retrieve every expected note" : "retrieved no notes"}, although the expected records describe reduced food intake. This exposes the lexical recall limitation. No match must not be presented as absence of a historical concern; semantic retrieval or separately tested query expansion remains a future comparison.

A retrospective query of **sandwich tired** with an actual shift start of **8 September 2026, 10:00 Australia/Melbourne** returned **${short(report.retrospective.returnedDates)}**. The 9 September update was excluded, and every returned source ended before or at the cutoff. Source confirmations are also restricted to that cutoff by the same eligibility predicate and time helper used in runtime.

This is a small retrieval diagnostic using one synthetic participant and labels selected with knowledge of the fixture. It does not independently validate clinical facts, permission handling, session races, generated questions, answer attribution, or whether an LLM respects uncertainty. Those concerns require their separate API tests and interview evaluations.
`;
  writeFileSync(
    new URL("../docs/archive/participant-rag-evaluation.md", import.meta.url),
    await format(doc, { parser: "markdown" }),
  );
}
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
