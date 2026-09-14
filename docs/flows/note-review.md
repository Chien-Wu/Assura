# Silent shift risk checks

The worker records a shift and chooses **End conversation & review** while the recorder is connected, or **Review & confirm** after it has ended. The connected path stops the recorder, finishes admitted transcript/form saves, closes the session and reads the latest saved note before review. A failed save keeps review closed and leaves the draft available for recovery. Unsent text must be sent or cleared first. The saved note opens immediately in a review dialog on the same page. AI2 checks the final saved form and captured shift transcript, with limited background from the note's saved participant snapshot when available. It returns up to five risk types with priority and evidence, plus one short summary. It never asks questions or speaks. A second request is needed only if the note changed or a failed check is retried.

The types are incident/safeguarding, health/medication, behaviour/restrictive practice, complaint, and service exception. Each detected type has a P1–P4 priority; an empty risk list means **P0 Routine: no risk detected in the supplied account**, not proof nothing happened. The highest finding level is the overall shift priority. Uncertainty stays in the summary. AI2 cannot determine official reportability or send notifications.

The worker reviews the saved account and AI result, then explicitly confirms. A server binding fixes the exact note revision and assessment revision being confirmed. Editing the account invalidates the previous check. Failed or incomplete checks remain unfinished with a retry button, never a successful P0.

## Background supplied to AI2

New checks include `participantBackground` containing only conditions, known risks, communication and support setting from this note's saved participant snapshot. Provenance records the source kind `saved_note_participant_snapshot`, note and participant IDs, and the note creation date as `capturedAt`. The snapshot does not preserve a profile update or effective date, so `profileUpdatedAt` is `null`; the capture date does not establish that the profile was current for the shift.

AI2 does not look up the live profile or earlier shifts. A missing, unusable or mismatched snapshot means no background is supplied; there is no demo-profile fallback. Medications, care plans, goals, NDIS number and date of birth are excluded. Editing the profile affects subsequently created notes; existing notes retain their saved snapshot. Completed assessments remain unchanged, and this addition does not trigger a replacement check for an already assessed revision.

The prompt treats background as untrusted context, never instructions or proof of an event during this shift. Background is not added to the citeable evidence sources. Every risk still requires a quote supported by the current-shift account, including any retained legacy AI2 answers for this same shift. Exact quote validation cannot establish whether the model's interpretation or clinical judgment is correct.

## Database

- `shift_notes` and append-only `transcript_events` retain the worker’s source record.
- `shift_assessments` saves a schema-version 2 result for an exact note revision: risk JSON, summary, source snapshot, state and timestamps. A unique note/revision/schema key and lease prevent duplicate successful checks and concurrent publication.
- `assessment_runs` retains model name, input, output, status and timing for each attempt. Source and result are server-owned; model text cannot change identity or confirmation.
- `assessment_findings` stores one immutable AI type/level/evidence row per detected type. AI publication and finding creation are atomic. P0 creates no finding.
- The same finding row holds separate manager status, optional manager priority and a review revision. `assessment_manager_actions` is an append-only decision history with actor, timestamp, comment and idempotency key. Manager review does not change the original AI judgment or worker statement.
- `assessment_reviews` binds the worker’s confirmation to the exact successful check. Historical schema-version 1 JSON and `assessment_messages` remain available in audit exports; new AI2 answer and transcription requests return 410.

## Manager use

The management board shows a dedicated risk queue with participant, worker, AI priority, review status, summary and draft/confirmed status. Open a finding to inspect the source quotes and complete note/transcript audit. Mark it **In review**, change manager priority if needed, or mark it **Closed**. Closing or changing priority requires a reason. Conflicting edits ask the manager to load the latest decision while keeping their draft comment.

Open findings remain visible across later note edits and are labelled as earlier note versions. A later routine result does not silently close them. Closed findings and every action remain retrievable. Provider membership is checked for reads and again when writing; workers cannot record manager decisions. Existing legacy captured-event review and official reporting fields remain separate.

## Setup and validation

Apply `database/migrations/0008_shift_assessments.sql` and `database/migrations/0009_silent_risk_findings.sql` in sequence to the intended database. Back up local data before migration. Set server-only `OPENAI_API_KEY`; `ASSURA_AI2_MODEL` optionally overrides the existing default `gpt-5.6-terra`.

The model uses strict structured output, low reasoning, a compact output budget, `store:false`, and no external tools. `store:false` does not promise zero provider retention. Only the limited saved participant background described above accompanies the current-shift sources; no live profile or historical records are fetched for a check. Exact evidence quotes are validated against supplied current-shift sources. Oversized input fails visibly rather than silently omitting events.

The canonical recorder prompt and three-tool configuration are in [`config/agents/main/system-prompt.txt`](../../config/agents/main/system-prompt.txt) and [`config/agents/main/client-tools.json`](../../config/agents/main/client-tools.json). Updating these files does not publish changes to the shared ElevenLabs agent. Deploy the matching application before applying `scripts/sync-elevenlabs-agent.mjs`. The app blocks legacy recorder finalization and assessment questions.

The recorder's first message is maintained in ElevenLabs and preserved by the sync script. Both text and voice sessions pass `participant_name` from the saved note's participant name when connecting, before the first message or any context tool call. Use `{{participant_name}}` in the ElevenLabs first message, for example: "Hi, I'm your AI shift-note assistant for {{participant_name}}. Tell me about the shift you've just finished." Publish the first-message setting in ElevenLabs and deploy the application change for new conversations to use the greeting.

The same session initialization passes `participant_context` as a JSON string containing only name, communication, goals and support setting. Scheduled notes use their saved participant profile snapshot; legacy notes resolve their selected demo profile. The system prompt references `{{participant_context}}` and treats its contents as background data, never instructions or evidence of this shift. Main still reads current draft fields, revision, scheduling and validation through `get_form_context`. Silent AI2 separately receives the limited saved snapshot fields described above, without the Recorder's demo-profile fallback. The hosted agent has neutral dashboard test placeholders (`participant_name: "this participant"`, `participant_context: "{}"`); these do not supply missing variables in SDK sessions. When testing directly in ElevenLabs, provide synthetic values for both variables; the dashboard does not know which participant is selected in the app.

Deploy the application code that sends both variables before publishing an agent prompt that requires them. A successful session API response or WebSocket upgrade does not establish that the conversation initialized: a caller missing `participant_name` is rejected with code 1008 and `Missing required dynamic variables in first message`. Inspect ElevenLabs conversation error metadata for the reason; the current recorder UI shows a generic stopped message for SDK errors. After deploying, reload the worker page so it uses the new client bundle before starting another conversation.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:assessment`. The HTTP suite uses isolated synthetic records and mocked provider responses. Live classification quality and latency still require provider evaluation before production rollout.

## Participant context and tool management

The Recorder's third tool, `get_participant_context`, is a **Client** tool with **Wait for response** enabled, a 45-second timeout and no parameters. The browser selects the active session's saved note and calls `GET /api/notes/:id/knowledge/context` using the application's signed session. The model cannot choose a different participant, worker or provider. The read waits for admitted transcript/form saves; session, note revision, worker-turn and interruption changes discard a late response. Failed reads leave recording available without returning historical sources.

The tool returns the saved profile snapshot (name, setting, communication, conditions, risks and goals), up to two recent confirmed notes, confirmed AI2 follow-up when available, source dates/versions, retrieval ID and coverage. History is limited to the same worker/provider/participant and to records completed and confirmed before the shift-start cutoff. A scheduled start can be provisional: save the actual start and refresh context before relying on that history. Legacy notes without a current assignment cannot read history; they retain the minimal startup background described above.

Historical material only helps the Recorder understand the current account and ask relevant current updates. It must identify earlier shift dates and record only what the worker reports about this shift. A prior AI assessment is not a new observation or current care instruction. The tool persists a retrieval audit; ordinary questions and replies remain in the recorder transcript. It does not register legacy `interview_questions`, enforce their old question budget, mark a task resolved or feed historical context directly into silent AI2. Keyword search and the native Workflow's RAG remain disabled.

Manage the two surfaces separately:

- **ElevenLabs → the Recorder agent → Tools:** the attached list should contain `get_form_context`, `get_participant_context` and `update_and_check_form`. Select the existing tool to inspect its description, response waiting and timeout. **Add tool → New tool → Client** is only needed if the tool has not been created; avoid a duplicate with the same name. No webhook URL, patient identifier, database secret or patient content belongs in this tool definition. Client tools need the Assura app's registered handler, so the standalone ElevenLabs dashboard cannot read the application's signed-in participant data. See [ElevenLabs client-tool documentation](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools).
- **Assura → Manager → Participants → Edit participant:** manage the underlying profile. Existing notes keep the snapshot captured when they were created; editing a profile applies to subsequently created notes. Confirmed shift notes supply history automatically. Medication/plan fields in the editor and local PDF/Word files are not included by this context tool.

Keep the canonical tool JSON and prompt in Git when changing the dashboard configuration. For a coordinated release, deploy the app, run `node scripts/sync-elevenlabs-agent.mjs --check`, then `--apply`, then `--check` again. The sync creates or reuses the tool, attaches it to the intended Recorder agent and preserves the first message, voice and model settings. Reload the Assura worker page before starting a new conversation so the third client handler is present.
