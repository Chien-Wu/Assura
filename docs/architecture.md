# Application architecture

The application has one codebase and one durable database per deployment. It uses feature folders for domain rules and screen controllers; no additional service layer, transport or framework is required by this organisation.

## Finding a feature

| Domain                                   | Rules and services                                                                                                                                                                        | Screen                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Sign-in and test accounts                | `lib/auth/`: client, configuration, server session checks and scoped demo accounts.                                                                                                       | `components/auth/`                                                      |
| Participants, providers and shifts       | `lib/roster/`: profile types, participant validation, organisation scope, scheduling and persistence.                                                                                     | `components/manager/roster/`, `components/worker/shifts/`               |
| Shift notes and source evidence          | `lib/notes/`: form validation, saved notes, safety fields and append-only audit.                                                                                                          | `components/worker/notes/`                                              |
| Recorder                                 | `lib/recorder/`: the two client-tool contracts, session state and stop/save/review handoff.                                                                                               | `components/worker/recorder/`                                           |
| Silent AI2 and findings                  | `lib/assessment/`: result schema, model adapter, prompt, revision-bound assessment, manager decisions and historical types.                                                               | `components/worker/notes/risk-review.tsx`, `components/manager/review/` |
| Native Workflow test                     | `lib/workflow/`: case schema, ordered write queue, sessions and shared six-form persistence.                                                                                              | `components/worker/workflow/`                                           |
| Historical context and follow-up records | `lib/knowledge/`: context/search, source records and interview evidence.                                                                                                                  | Note reference and audit views                                          |
| Shared infrastructure                    | `lib/shared/server.ts`: one RequestError class, DB access, request identity/origin/body validation and responses. Other shared modules hold class names and server contact configuration. | No screen owns these services.                                          |

`app/` owns URLs and request boundaries. Routes authenticate, parse a request and call the domain service. Database writes repeat ownership and revision checks at execution time. Server modules are imported directly; there are no mixed client/server barrel files. Pure validators keep relative TypeScript imports so the browser build and Node test runner can both use them.

## Screen controllers and views

- `notes/use-workspace.ts` keeps the editor state, mutation lock, draft recovery, unload guard and recorder handoff together. The workspace renders the frame; `shift-note-card` renders the form and `notes-history` renders the list.
- `recorder/use-voice-recorder.ts` owns one recorder lifecycle. `voice-panel.tsx` owns the existing provider/key boundary and renders its controls.
- `workflow/use-risk-conversation.ts` owns connection generation, context, admitted writes and specialist/form selection. `workflow-test.tsx` renders the conversation, six forms and manual corrections.
- Manager roster, participant editor and shift editor retain their existing mounting and keys. Switching sections hides an editor without discarding its draft. Manager incident review and audit dialogs receive data and callbacks from the board.
- Request helpers stay within their feature: recorder and Workflow have different timeouts, authentication and non-JSON error handling. Shared UI primitives contain presentation only.

## Data, configuration and styles

D1 is the source of truth. Acknowledgements follow admitted durable writes; model context is a working copy. `db/schema/` owns tables by domain, and `db/schema.ts` exports the schema for Drizzle. All applied SQL and generator snapshots remain in `drizzle/` unchanged. Synthetic imports use `fixtures/`; local databases and credentials are never source files.

`config/agents/main/` is the recorder prompt/tool source. Silent AI2's runtime prompt is `lib/assessment/prompt.ts`, checked against `config/agents/ai2/system-prompt.txt`. Native nodes and tools are in `config/agents/workflow.mjs`. Operator scripts publish provider settings separately from application deployment.

`app/globals.css` is the stylesheet entrypoint. Its ordered imports preserve the existing cascade: theme → workspace → note form → responsive rules → recorder → review → interaction. Component-specific CSS remains beside its screen. Splitting styles must preserve selector order and media-query precedence.

## Supported flows and compatibility

Normal recording followed by silent AI2 review and the native Main-plus-six-specialists Workflow test remain separate supported flows. Their tool/result contracts are different. The workflow drafts have not been merged into normal confirmation or manager AI2 review.

Historical result validation and audit records remain readable. Retired answer/transcription endpoints still return HTTP 410. A service can be required by audits, existing records or compatibility APIs even when it is not exposed on the current primary screen.

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

## Validation and maintenance

`npm run check` runs formatting, ESLint, strict TypeScript and all `tests/unit/` suites. `npm run build` produces the Worker; `npm run test:api` exercises onboarding, knowledge, assessment and Workflow against isolated synthetic D1 databases and mocked providers. A live provider smoke is a separate paid operation and does not measure browser microphone latency.

Keep each feature's state transitions together, expose only the values its views use, and comment on recovery/order invariants. Add a folder when it groups a real responsibility; do not introduce a wrapper solely to shorten imports. Preserve API URLs, authorization checks, field contracts, source evidence, applied migrations and component mounting when refactoring.

GitHub/VM and private Sites deployments share source but use separate credentials and runtime environments. Operator entrypoints keep stable paths in `scripts/` and `deploy/vm/`. Current instructions belong in `docs/guides/` or `docs/flows/`; supplied originals belong in `docs/sources/`. The local workspace's research/form archive is outside this repository under `reference/`.
