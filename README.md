# LegalMate

Support workers record a shift, review the saved account and AI risk check, then explicitly confirm it. Managers schedule shifts and review their provider's notes and findings.

The product is an English-language web app designed for mobile and desktop use.

## Repository

```text
src/          Application routes, components, domain logic, styles and types
config/       Agent definitions and database generation settings
database/     Table schemas and immutable migrations
tests/        Unit/API suites, harnesses and synthetic fixtures
scripts/      Development and operator commands
deploy/       VM operations and Sites build support
docs/         Architecture, setup guides and flow contracts
public/       Public static assets
```

Start in `src/` to change the product. See the [architecture map](docs/architecture.md) for a specific feature and the [documentation index](docs/README.md) for setup. Package, Vite, TypeScript and ESLint entrypoints stay at the root for normal tool discovery; PostCSS is configured inside Vite. `.openai/` identifies the existing private hosting project.

## Current flows

| Entry                         | Behaviour                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/worker`                     | Assigned shifts, manual entry or ElevenLabs text/voice recording. Three recorder client tools read the draft, read participant background/history and save the account. **Review & confirm** runs a silent AI2 check against the saved note and transcript, with limited saved participant background when available. |
| `/worker/notes/[id]/workflow` | Separate, optional native Workflow test: Main routes to six risk specialists sharing one case and six draft forms. It is not yet part of ordinary note confirmation or manager AI2 review.                                                                                                                            |
| `/manager`                    | Participants, shift scheduling, notes, risk findings and append-only manager decisions within the provider.                                                                                                                                                                                                           |
| `/onboarding`                 | Workers select an existing provider and confirm their profile. Managers are provisioned by the operator.                                                                                                                                                                                                              |

The normal recorder's three tools are `get_form_context`, `get_participant_context` and `update_and_check_form`. Participant context provides a profile snapshot and up to two recent confirmed records for the same worker, provider and participant. The separate Workflow uses `get_case_context` and `save_risk_form`. Workflow forms and the silent AI2 classification schema are distinct contracts. See [architecture and technology decisions](docs/architecture.md) and the [documentation index](docs/README.md) before changing either flow.

Silent AI2 receives only conditions, known risks, communication and support setting from the note's saved participant snapshot, with source and capture-date provenance. It does not retrieve a live profile or earlier shifts, and unavailable background has no demo-profile fallback. Background is context; each finding still requires current-shift evidence. Existing completed checks remain unchanged. See [note review](docs/flows/note-review.md) for the input boundary and date limitations.

## Local setup

Requires Node.js 22.13+ and npm. Run from this repository root:

```sh
npm run install:ci
cp .env.example .env.local # First setup only; preserve an existing environment.
npm run build
```

Configure [application authentication](docs/guides/authentication.md) and [provider access](docs/guides/providers.md). Manual drafting works without ElevenLabs. Text/voice recording requires server-only `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`. Silent AI2 requires `OPENAI_API_KEY`; when it is missing, review shows a setup error and retains the draft. The optional Workflow has its own agent, version and enable flag; follow [Workflow setup](docs/flows/risk-workflow.md).

For a **fresh, empty local database only**, apply every SQL migration in filename order:

```sh
for migration in database/migrations/*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration" || break
done
npm run dev
```

Open `http://localhost:5173`. For an existing database, back up first and apply only unapplied migrations. Never edit or rerun applied SQL. The history currently runs from `0000` through `0010`; `npm run db:generate` adds a new migration after a schema change.

The optional fixed test-account form intentionally prefills the two TestProvider aliases and configured shared test password. It does not enable general email registration. Do not use real participant data in demo testing.

## Validation

```sh
npm run check
npm run build
npm run test:api
```

`check` runs formatting, ESLint, TypeScript and unit/isolated SQLite tests. After building, `test:api` runs onboarding, knowledge, assessment and Workflow HTTP suites against isolated D1 databases with synthetic signed sessions and mocked providers. It does not use the development database or paid AI calls. The suites can also run separately with `test:onboarding`, `test:knowledge`, `test:assessment` and `test:workflow`.

`npm run test:workflow:live` is an optional **paid** synthetic client-tool smoke against the configured Workflow agent and isolated D1. It requires the private manifest created by `scripts/configure-workflow-test.mjs`. It does not cover browser microphone timing or end-to-end speech quality.

`npm run format` formats maintained code, UI primitives and documentation. Generated migrations, platform support and licensed vendor CSS remain unchanged. Retired protocols and experiments are available in Git history at `c5c5021`; they are not shipped in the current tree. Source-file reorganisation does not change API URLs, existing data or agent settings.

## Evidence and deployment

Source transcripts and audit actions are append-only. Facts, explicit negatives, unknowns and undiscussed fields remain distinct. Note confirmation is bound to a current revision and successful AI2 check. Existing assessment history and compatibility endpoints remain readable even where new writes have been retired. The app does not submit external reports or send external risk notifications.

GitHub `main` is the source for the standalone VM's configured updater. [VM deployment](docs/guides/deployment.md) documents backups, migration and release handling. `.openai/hosting.json` identifies the separate private Sites deployment and D1 binding; Sites publication requires its own build, version and deployment flow. Pushing GitHub alone does not publish Sites or change an ElevenLabs agent.

Keep `.env.local`, `.secrets/`, local databases and test exports out of Git. `.env.example` documents server settings. Never put source repository credentials into deployed assets or runtime environment variables.

The containing local workspace has one separate `reference/` directory for original documents, research and official form samples. These materials are not application source and are not included in this Git repository. Generated `dist/`, caches and test reports are ignored; credentials and local D1 persistence keep their existing locations.
