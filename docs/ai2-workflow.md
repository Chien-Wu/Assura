# Silent shift risk checks

The worker records a shift and chooses **End conversation & review** while the recorder is connected, or **Review & confirm** after it has ended. The connected path stops the recorder, finishes admitted transcript/form saves, closes the session and reads the latest saved note before review. A failed save keeps review closed and leaves the draft available for recovery. Unsent text must be sent or cleared first. The saved note opens immediately in a review dialog on the same page. AI2 checks the final saved form and captured shift transcript in the background. It returns up to five risk types with priority and evidence, plus one short summary. It never asks questions or speaks. A second request is needed only if the note changed or a failed check is retried.

The types are incident/safeguarding, health/medication, behaviour/restrictive practice, complaint, and service exception. Each detected type has a P1–P4 priority; an empty risk list means **P0 Routine: no risk detected in the supplied account**, not proof nothing happened. The highest finding level is the overall shift priority. Uncertainty stays in the summary. AI2 cannot determine official reportability or send notifications.

The worker reviews the saved account and AI result, then explicitly confirms. A server binding fixes the exact note revision and assessment revision being confirmed. Editing the account invalidates the previous check. Failed or incomplete checks remain unfinished with a retry button, never a successful P0.

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

Apply `drizzle/0008_shift_assessments.sql` and `drizzle/0009_silent_risk_findings.sql` in sequence to the intended database. Back up local data before migration. Set server-only `OPENAI_API_KEY`; `LEGALMATE_AI2_MODEL` optionally overrides the existing default `gpt-5.6-terra`.

The model uses strict structured output, low reasoning, a compact output budget, `store:false`, and no external tools. `store:false` does not promise zero provider retention. No historical records or participant profile are fetched for a current check. Exact evidence quotes are validated against supplied sources. Oversized input fails visibly rather than silently omitting events.

The canonical recorder prompt and two-tool configuration are in [`config/agents/main/system-prompt.txt`](../config/agents/main/system-prompt.txt) and [`config/agents/main/client-tools.json`](../config/agents/main/client-tools.json). Updating these files does not publish changes to the shared ElevenLabs agent. Apply `scripts/sync-elevenlabs-agent.mjs` only through the coordinated release process. The app blocks legacy recorder finalization and assessment questions in the meantime.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:assessment`. The HTTP suite uses isolated synthetic records and mocked provider responses. Live classification quality and latency still require provider evaluation before production rollout.
