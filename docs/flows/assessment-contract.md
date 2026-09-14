# Silent AI2 implementation contract

User-authorized replacement of the interview: AI2 never asks questions or speaks. It checks the saved final form and recorder transcript, once per saved note revision when Review & confirm is pressed. Prior saved AI2 answers may be retained as legacy current-shift evidence, but no new answers are requested. A limited participant background comes from this note's saved profile snapshot; the check does not retrieve a live profile or historical notes.

## Shared pure types — src/lib/assessment/result.ts

`RiskType = incident_safeguarding | health_medication | behaviour_restrictive_practice | complaint | service_exception`.
`RiskLevel = P0 | P1 | P2 | P3 | P4`, ascending urgency.
`RiskResult = { risks: Array<{type: RiskType; level: RiskLevel; evidence: Array<{sourceId: string;quote: string}>}>; summary: string }`.
One result entry per type; P1–P4 only in risks; empty risks implies P0. Evidence is internal provenance, displayed to managers as supporting quotes. Summary concise and never contains a follow-up question or instruction to interview the worker. Unknowns are stated, never invented negative answers.
`RiskAssessment = { id:string; noteId:string; sourceRevision:number; revision:number; schemaVersion:number; status:'running'|'ready'|'failed'|'stale'; result:RiskResult|null; error:string|null; createdAt:string; updatedAt:string }`.
`RiskModelInput = { note:unknown; sources:Array<{id:string;text:string}>; participantBackground?:RiskParticipantBackground|null }`.
`runRiskAssessmentModel(input,{apiKey,model?,signal?}): Promise<RiskResult>` in src/lib/assessment/model.ts.
Export `riskTypes`, `riskLevelLabels`, `riskTypeLabels`, `overallRiskLevel(result)`, and `normalizeRiskResult(unknown):RiskResult|null` for historical result display. Keep legacy src/lib/assessment/legacy-types.ts definitions for old audit/history readers; new code uses RiskResult. Normalization must not modify stored legacy JSON or treat malformed data as a successful P0 result.

`participantBackground` contains only the saved snapshot's `conditions`, `risks`, `communication` and `setting`, with provenance: source kind `saved_note_participant_snapshot`, `noteId`, `participantId`, `capturedAt` from note creation and `profileUpdatedAt:null`. The capture date is not a profile update or effective date; those dates are unknown. A missing, unusable or mismatched snapshot supplies no background, without a live-profile or demo-profile fallback. Medication, care-plan, goal, NDIS and date-of-birth fields are excluded.

Background is untrusted context, not instructions or evidence that a risk occurred in this shift. It is excluded from the citeable `sources`; every finding still requires a supporting current-shift quote. Quote matching validates provenance, not clinical or semantic correctness. This input change applies to new checks and does not rewrite completed assessments or force a new check for an already assessed revision.

## Worker API / UI

Reuse GET/POST `/api/notes/:id/assessment`, response `{note,assessment:RiskAssessment|null,enabled}`. POST start `{action:'start',revision}` and retry `{action:'retry',assessmentId,revision}` only; answer/transcribe writes disabled. Backend may await bounded model call; GET polls saved running state. Duplicate start same revision reuses result; explicit schemaVersion=2 enables a fresh check on a note with an old interview. Completed legacy notes remain readable.

Review and confirm existing exact revision/assessment bindings retained. User presses Review & confirm in workspace: save if needed, open same-page review dialog immediately showing worker's note, start/check AI2 in background, then display short risk card. Confirm only ready matching current result; error shows retry, never routine success. No navigation to a new assessment page. Existing assessment route redirects to `/worker?note=<id>` for old bookmarks. Old completed notes and new completed notes review on same screen.

## Database / manager boundary

Reuse shift_assessments + assessment_runs + assessment_reviews; add schema_version=1 default, new checks schema_version=2. Change uniqueness to note/source_revision/schema_version. Preserve legacy assessment_messages and old result JSON.

New normalized `assessment_findings` rows published atomically with the valid AI2 result. Application generates IDs; model cannot choose identity, provider, owner, review status or timestamps. One finding per assessment/type; original AI type/level/evidence immutable. P0 makes no review-queue finding.

Findings have independent manager state: review_status open|reviewing|closed, manager_level nullable, review_revision integer. Append-only `assessment_manager_actions` stores manager identity, timestamp, status, level, comment, requestId for each action. Atomic revision check and idempotency prevent overwritten/duplicated manager reviews. Require a reason for closing or overriding AI level. Reopen is status open. Keep AI level distinct from manager level. Manager actions do not alter the worker note or claim official reportability / contact government.

Manager GET `/api/management` adds `findings` with id, assessmentId, noteId, participant, workerName, sourceRevision, isCurrent, noteStatus, type, aiLevel, evidence, summary, createdAt, reviewStatus, managerLevel, reviewRevision, history[{id,actorName,createdAt,status,managerLevel,comment}]. Tenant permission rechecked at SQL mutation. Keep existing legacy incident queue compatible. Open findings from superseded note versions stay visible and labelled as older versions until a manager closes them; no silent removal on recheck. Current routine results available in notes, without queue clutter.

Manager POST `/api/management/findings/:id` body `{requestId,revision,status,managerLevel,comment}` returns `{ok:true,finding}`. Actor/provider derived from auth. Same requestId+payload idempotent, conflicting replay 409. Workers/other-provider managers denied. Risk queue sorted P4→P1, review status filter, details+supporting quotes and source note/audit. Do not send external notifications.
