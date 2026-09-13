# Participant history retrieval diagnostic

Reproduce with `node --experimental-strip-types scripts/evaluate-patient-history.mjs --write-doc` from `web`. The command prints deterministic JSON and regenerates this report. It creates an isolated in-memory SQLite database, applies the repository migrations, and inserts the ten fictional Sarah Doyle notes. It does not access a running database or any external service.

The six cases below use a current shift start of **13 September 2026, 10:00 Australia/Melbourne**. Expected dates are hand-authored evaluation labels, not indexed text. FTS indexes authored note fields only; fixture topics and continuity metadata are excluded. Selection mirrors the runtime relevance/recency order and whole-source bounds without changing its query or adding synonyms.

| Query                   | Expected note dates | FTS returned dates         | All-notes recall | FTS recall | All-notes characters | FTS characters |
| ----------------------- | ------------------- | -------------------------- | ---------------- | ---------- | -------------------- | -------------- |
| craft trial group       | 09-12               | 09-12, 09-05, 09-09, 09-07 | 1/1              | 1/1        | 19137                | 7530           |
| walking group cancelled | 09-07, 09-08        | 09-07, 09-08, 09-12, 09-10 | 2/2              | 2/2        | 19137                | 8308           |
| cafe noise              | 09-03, 09-04        | 09-03, 09-04, 09-02        | 2/2              | 2/2        | 19137                | 5645           |
| sandwich tired          | 09-08, 09-09        | 09-08, 09-09, 09-12, 09-10 | 2/2              | 2/2        | 19137                | 8070           |
| transport bus delay     | 09-10               | 09-10, 09-12               | 1/1              | 1/1        | 19137                | 3558           |
| appetite                | 09-03, 09-08        | none                       | 2/2              | 0/2        | 19137                | 2              |

Recall counts expected source notes retrieved, not correct answers or useful questions. Dates in the table are month-day in 2026. Characters are the length of the serialized source DTO array, including metadata and JSON punctuation; they are not tokens. The all-notes comparison always supplies all ten eligible sources, without the production context limits, so its full recall follows from including the expected records.

Across these fixed cases, FTS retrieved **8/10 expected sources (80%)**, compared with **10/10** for all notes. Total serialized characters across the six requests were **33113** for FTS and **114822** for all notes. These totals do not establish latency, operating cost or LLM quality.

The unchanged paraphrase query **appetite** retrieved no notes, although the expected records describe reduced food intake. This exposes the lexical recall limitation. No match must not be presented as absence of a historical concern; semantic retrieval or separately tested query expansion remains a future comparison.

A retrospective query of **sandwich tired** with an actual shift start of **8 September 2026, 10:00 Australia/Melbourne** returned **09-01, 09-03, 09-07, 09-04**. The 9 September update was excluded, and every returned source ended before or at the cutoff. Source confirmations are also restricted to that cutoff by the same eligibility predicate and time helper used in runtime.

This is a small retrieval diagnostic using one synthetic participant and labels selected with knowledge of the fixture. It does not independently validate clinical facts, permission handling, session races, generated questions, answer attribution, or whether an LLM respects uncertainty. Those concerns require their separate API tests and interview evaluations.
