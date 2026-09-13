# Participant history RAG — implemented first version

> Historical scope: see the [current flows](../README.md) and [archive notes](README.md) before using configuration or commands below.

Deployed to https://legalmate.callfoods.com on 2026-09-13, application revision `ef6508b6eac54d8b448b481821f30f89cf037653`. This version retrieves confirmed shift notes for the current worker's assigned participant, attaches citations to interview questions, and records the worker's answers. It uses the existing ElevenLabs interviewer and D1 with English FTS5. No embedding model or second question-generating model is used.

## Runtime flow

1. `VoicePanel.sendText` saves the worker's transcript event before sending text to ElevenLabs. Ordinary transcript capture and form saves do not wait behind a history search.
2. `get_form_context` returns the current form plus a minimized profile and up to two recent eligible notes. The model DTO excludes NDIS number, date of birth and full profile snapshots. Background effective dates remain unverified.
3. The Agent saves worker-reported fields through `update_and_check_form`. When a history-related gap is relevant, it calls `search_participant_records(query,current_turn_quote)`.
4. The browser binds the request to the active note/session. The backend validates ownership, active assignment/membership, actual Melbourne shift start, the note revision and latest saved worker quote. Missing/ambiguous dates return an explicit unavailable-history state.
5. FTS5 searches only eligible source notes. It combines relevance and recent matching updates, returning at most four whole source records, 12,000 characters per source and 24,000 characters total. Oversized or omitted records produce partial coverage; clauses are not silently truncated. Query operators are treated as literal words. Unsupported queries return an explicit response.
6. The same Agent proposes a necessary question through `register_followup`. The backend validates the retrieval, source IDs, current revision/cursor and remaining question budget atomically. It returns `canAsk`; repeated registrations do not grant permission to ask again.
7. A matching actual Agent transcript marks the proposal emitted. The worker's later exact quote can mark it answered or unknown through `question_updates` in the existing form PATCH. Both note and question writes commit together or roll back together.
8. The worker and manager can expand **Why these questions were asked** to see the question, its state, the answer quote and authorized historical source fields. The existing audit export includes the same question history.

## Source and time rules

- Source identity is `noteId@revision`. The source retains authored fields, date, author and synthetic provenance. Fixture `topics` and `continuity` are never indexed or returned as evidence.
- Only complete, confirmed notes from the same worker, provider and participant are live-searchable. Existing coworker notes are not newly shared by this feature. The current note is excluded.
- Source actual end and confirmation time must both precede the current shift start. Backfilled notes cannot silently use later observations or later-confirmed records. Melbourne DST gaps and overlaps fail closed because the existing wall-time schema lacks an explicit offset.
- Opening context may use the planned start provisionally, marked as such. A search for a follow-up requires the worker's saved actual start. No source is evidence that care happened in the current shift.
- `toNote` preserves the existing distinction between explicit absence and unknown evidence. Family reports and participant quotes remain in the authored text.
- Historical `followUp=needed` describes that source note's handover. This implementation does not establish a current care-task lifecycle or automatically close a task from a later `none` value.

## Storage and migrations

- `0006_participant_knowledge.sql`: `knowledge_fts`, confirmed-note backfill and synchronization triggers, plus `retrieval_runs`.
- `0007_interview_questions.sql`: `interview_questions`, append-only `interview_question_events`, source-scope validation and uniqueness constraints.
- Index updates occur within the source note's database write, including confirmation. Reopening or deleting a source removes it from the live index. Retrieval/registration recheck source versions and access.
- Retrieval results and question references are stored in the same protected database. They are not sent to general application logs or a hosted knowledge-base corpus.

Use the normal migration runner for a deployment with an existing migration ledger. The Mac development database was originally initialized without `d1_migrations`; after a SQLite backup, only the two new migrations were applied directly. Earlier migrations were not rerun or falsely marked as applied. Do not blindly rerun these migration files against an already migrated database.

## Agent publication

The browser registers six tools. Their vendor configuration objects are in [elevenlabs-client-tools.json](../../config/agents/main/client-tools.json); the prompt is [elevenlabs-system-prompt.txt](../../config/agents/main/system-prompt.txt). Each tool waits for a response using `expects_response: true`.

The matching prompt and six tools were published on 2026-09-13 at 07:56:15 UTC as Agent version `agtvrsn_8101m2cw8mevfnwrz1nmefvgxpys`. Fresh API reads verified every tool contract, the prompt and preservation of unrelated voice/model/authentication settings. The VM deployment applied migrations 0006/0007 through its normal stopped-service backup and migration process; public `/api/health` returned HTTP 200.

The VM now contains the ten explicitly synthetic Sarah source notes, with all ten confirmed, correctly scoped and indexed. An additional empty scheduled shift for 13 September, 10:00–12:00 Melbourne is assigned to Test Worker for browser testing (`2dfe74b8-8f5e-4b62-af4b-18e46a5cb5d4`). History and demo-shift imports were verified idempotently in one stopped-service maintenance window, with a pre-import backup at `/var/lib/legalmate/backups/20260913T075952Z-rag-demo`. No authentication records were created or changed. The automatic deployment timer was restored afterward.

The hosted Agent is instructed to wait, use sources and register questions. The app cannot intercept every generated audio sentence. Actual microphone behavior and end-to-end model adherence still require a live acceptance run against matching remote configuration. The optional text harness requires `LEGALMATE_TEST_MATCHING_AGENT_CONFIG=1` and an authenticated test session before it will run.

## Verification and limits

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:knowledge
npm run test:onboarding
```

The two API suites use disposable Miniflare databases, real signed test sessions, the built application and blocked external network calls. Knowledge tests cover source isolation, no-match/unknown semantics, temporal cutoff, FTS synchronization, stale references, source forgery, emitted/answered/unknown/cancelled question states, question budget, close/resume and database-injected failure rollback.

Question emission uses normalized literal transcript matching. Exact quote validation proves the quote exists after the question; it does not prove the model's semantic classification of an answer is correct. Deduplication uses stable purpose keys and normalized wording, supplemented by the Agent's conversation context. Purpose keys should distinguish separate events while remaining stable for the same information gap. The shared clarification budget includes the existing transcript question-mark count and outstanding proposals; it is not a semantic count of every possible spoken question.

This is an English lexical retrieval MVP. Related updates must share query terms to be found; synonyms and broad clinical concepts may be missed. The result never claims exhaustive coverage. Documents/OCR, embeddings, cross-worker sharing, clinical fact verification and care-task management remain outside this first implementation.
