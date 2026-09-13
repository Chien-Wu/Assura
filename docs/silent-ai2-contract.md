# Silent AI2 implementation contract

User-authorized replacement of the interview: AI2 never asks questions or speaks. It checks the saved final form and recorder transcript only, once per saved note revision when Review & confirm is pressed. Prior saved AI2 answers may be retained as legacy current-shift evidence, but no new answers are requested. No profile/history retrieval for the new check.

## Shared pure types — lib/risk-assessment.ts

`RiskType = incident_safeguarding | health_medication | behaviour_restrictive_practice | complaint | service_exception`.
`RiskLevel = P0 | P1 | P2 | P3 | P4`, ascending urgency.
`RiskResult = { risks: Array<{type: RiskType; level: RiskLevel; evidence: Array<{sourceId: string;quote: string}>}>; summary: string }`.
One result entry per type; P1–P4 only in risks; empty risks implies P0. Evidence is internal provenance, displayed to managers as supporting quotes. Summary concise and never contains a follow-up question or instruction to interview the worker. Unknowns are stated, never invented negative answers.
`RiskAssessment = { id:string; noteId:string; sourceRevision:number; revision:number; schemaVersion:number; status:'running'|'ready'|'failed'|'stale'; result:RiskResult|null; error:string|null; createdAt:string; updatedAt:string }`.
`RiskModelInput = { note:unknown; sources:Array<{id:string;text:string}> }`.
`runRiskAssessmentModel(input,{apiKey,model?,signal?}): Promise<RiskResult>` in lib/risk-assessment-model.ts.
Export `riskTypes`, `riskLevelLabels`, `riskTypeLabels`, `overallRiskLevel(result)`, and `normalizeRiskResult(unknown):RiskResult|null` for historical result display. Keep legacy lib/legacy-assessment.ts definitions for old audit/history readers; new code uses RiskResult. Normalization must not modify stored legacy JSON or treat malformed data as a successful P0 result.

## Worker API / UI

Reuse GET/POST `/api/notes/:id/assessment`, response `{note,assessment:RiskAssessment|null,enabled}`. POST start `{action:'start',revision}` and retry `{action:'retry',assessmentId,revision}` only; answer/transcribe writes disabled. Backend may await bounded model call; GET polls saved running state. Duplicate start same revision reuses result; explicit schemaVersion=2 enables a fresh check on a note with an old interview. Completed legacy notes remain readable.

Review and confirm existing exact revision/assessment bindings retained. User presses Review & confirm in workspace: save if needed, open same-page review dialog immediately showing worker's note, start/check AI2 in background, then display short risk card. Confirm only ready matching current result; error shows retry, never routine success. No navigation to a new assessment page. Existing assessment route redirects to `/worker?note=<id>` for old bookmarks. Old completed notes and new completed notes review on same screen.

## Database / manager boundary

Reuse shift_assessments + assessment_runs + assessment_reviews; add schema_version=1 default, new checks schema_version=2. Change uniqueness to note/source_revision/schema_version. Preserve legacy assessment_messages and old result JSON.

New normalized `assessment_findings` rows published atomically with the valid AI2 result. Application generates IDs; model cannot choose identity, provider, owner, review status or timestamps. One finding per assessment/type; original AI type/level/evidence immutable. P0 makes no review-queue finding.

Findings have independent manager state: review_status open|reviewing|closed, manager_level nullable, review_revision integer. Append-only `assessment_manager_actions` stores manager identity, timestamp, status, level, comment, requestId for each action. Atomic revision check and idempotency prevent overwritten/duplicated manager reviews. Require a reason for closing or overriding AI level. Reopen is status open. Keep AI level distinct from manager level. Manager actions do not alter the worker note or claim official reportability / contact government.

Manager GET `/api/management` adds `findings` with id, assessmentId, noteId, participant, workerName, sourceRevision, isCurrent, noteStatus, type, aiLevel, evidence, summary, createdAt, reviewStatus, managerLevel, reviewRevision, history[{id,actorName,createdAt,status,managerLevel,comment}]. Tenant permission rechecked at SQL mutation. Keep existing legacy incident queue compatible. Open findings from superseded note versions stay visible and labelled as older versions until a manager closes them; no silent removal on recheck. Current routine results available in notes, without queue clutter.

Manager POST `/api/management/findings/:id` body `{requestId,revision,status,managerLevel,comment}` returns `{ok:true,finding}`. Actor/provider derived from auth. Same requestId+payload idempotent, conflicting replay 409. Workers/other-provider managers denied. Risk queue sorted P4→P1, review status filter, details+supporting quotes and source note/audit. Do not send external notifications.

## Ownership

Core agent: pure risk types/normalization/model/prompt/unit tests.
Backend agent: schema/migration/server assessment API+review/confirm guards+manager read/write API+HTTP tests.
UI agent: workspace worker review flow/new compact component/styles/bookmark redirect; remove old interview page/client controls.
Root: manager UI, note export/audit/history adaptations, documentation, integration and browser verification.
