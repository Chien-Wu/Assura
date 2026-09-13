# Application architecture

`app/` owns route boundaries and authorization entrypoints. `components/` holds UI by audience. `lib/` holds the domain rules and persistence services; the `*-server.ts` modules perform database work, while validation/state modules are shared with isolated tests. Keep API contracts stable when reorganizing UI.

## Runtime responsibilities

| Area                             | Modules and boundaries                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and provider scope      | `auth*`, `organisations`, `organisation-access`, `test-account*`; scope is checked again when SQL writes execute.                                         |
| Participants and roster          | `roster*`, `shifts*`, `participants`; note attribution is snapshotted and stays with its original provider.                                               |
| Shift recording                  | `shift-form`, `notes-server`, `voice-server`, `voice-state`, `recorder-handoff`, `agent-tools`; transcript writes remain durable before acknowledgements. |
| Normal AI2 review                | `risk-assessment*`, `assessment-server`, `finding-review-server`; one silent result per current note revision, followed by explicit worker confirmation.  |
| Native Workflow test             | `workflow-case`, `workflow-server`, `workflow-queue`; separate cases, revision checks, session tokens, shared source evidence and six forms.              |
| Historical evidence and RAG APIs | `legacy-assessment`, `interview*`, `knowledge*`, `safety`, `audit-server`; still needed by existing records or callable routes.                           |

The old conversational AI2 model, browser answer drafts and audio adapter have no active route and were removed. Legacy-result validation in `risk-assessment.ts` and stored audit data remain. Retired answer/transcription endpoints continue returning HTTP 410. Do not remove a service solely because the current screen does not call it: audit exports, manager views, migrations and compatibility routes are consumers too.

## Data and configuration

D1 is the durable record. Voice and Workflow callbacks serialize admitted writes before closing; model context is not the source of truth. `db/` defines schemas and `drizzle/` preserves every applied migration. Fixture JSON is synthetic and used by imports and tests. No migrations or stored records are deleted during source cleanup.

Recorder artifacts are in `config/agents/main/`. Silent AI2's runtime prompt is in `lib/risk-assessment-prompt.ts`, with its review artifact under `config/agents/ai2/`. Native Workflow node prompts and tool definitions are in `config/agents/workflow.mjs`. Agent publication is an explicit operator script, separate from application deployment.

## Tests and operations

Unit tests stay at `tests/*.test.mjs`. Built-Worker tests are in `tests/api/` and reusable signed-session, migration and Workflow harnesses in `tests/support/`. Only current tests remain in the tree. The optional Workflow smoke consumes provider credits and stays separate from local acceptance checks.

GitHub/VM deployment and private Sites deployment share application source but have separate credentials and runtime environments. Keep `deploy/vm/`, `.openai/hosting.json`, `build/`, `vendor/` and runtime installer scripts intact. Unused developer bundles and retired experiments have been removed; Git retains their history.

## Technology decisions

| Choice                                 | Why it fits                                                                                                                                                                        | Tradeoff                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript + React                     | Typed form/state contracts and a shared component model for worker and manager screens.                                                                                            | Unused locals/parameters fail TypeScript checks. Provider JSON and database contents still require runtime validation.                                          |
| Vinext + Vite                          | Keeps the existing Next-style route/component structure while producing a Cloudflare Worker build for Sites and the VM adapter.                                                    | Vinext is pinned to a beta version. Build and built-Worker tests are required before framework upgrades.                                                        |
| D1 + Drizzle migrations                | One relational store links note ownership, revisions, source evidence and six form drafts. SQL guards and atomic batches enforce save boundaries.                                  | The VM instance uses local persisted D1 and needs backups; it is an MVP deployment, not a distributed database cluster. Applied migrations remain immutable.    |
| Better Auth                            | Maintains signed application sessions and separate worker/provider permissions across hosting environments.                                                                        | Provider authorization still belongs in application queries; login alone grants no manager scope.                                                               |
| ElevenLabs React SDK + native Workflow | Uses the existing voice transport and routes Main to six specialist instructions inside one conversation. Client tools reuse the authenticated application and ordered save queue. | Provider turn/routing latency still needs live voice evaluation. The specialist forms remain a separate test flow.                                              |
| Silent structured AI2 + Zod            | A bounded post-recording check produces risk JSON; local schema and source-quote validation reject malformed or invented evidence references.                                      | A schema-valid result can still be mistaken; the worker reviews the account and managers review findings. Missing configuration is a visible retryable failure. |
| Node tests + SQLite/Miniflare          | Exercises validators, real SQL constraints and the built API with synthetic sessions, without paid model calls.                                                                    | This does not measure microphone recognition, playback timing or clinical classification quality.                                                               |

No additional routing service, shared spreadsheet or RAG call sits on the current native Workflow save path. Case context comes from the same durable record. Distinct UI request helpers retain their own timeouts and error handling because those contracts differ; a common wrapper would hide those differences.

## Maintaining the boundaries

- Keep routes thin: authenticate and validate the request, then call the relevant server service. Never trust model-selected identities or revisions.
- Keep validation and state transitions independent of the database where possible. `shift-form.recorderFields` and `shifts.validLocalTime` are shared contracts, not duplicate copies.
- Put persistence beside its domain service. Keep SQL ownership/revision checks at the write boundary even after an earlier authorization read.
- Keep historical read shapes in `legacy-assessment.ts`; current results use `risk-assessment.ts`. Compatibility types and stored evidence do not require retaining retired models or question banks.
- Add comments for invariants and non-obvious recovery behaviour. Avoid comments that simply repeat a function name.
- Update this guide and the README when a supported flow changes. Delete retired implementations after verifying their callers; use Git history for old experiments.
