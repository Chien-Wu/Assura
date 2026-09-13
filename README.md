# LegalMate

An English web app for disability support workers to capture a shift in one conversation, review the saved facts, and explicitly confirm their note. Managers have a separate workspace for reviewing alerts and evidence.

## Workspaces

- `/` — choose a workspace; each opens in a separate browser tab or window.
- `/worker` — select a fictional participant, type or speak through the shift, edit a draft, review and confirm, and export the note.
- `/manager` — review captured candidates, inspect transcripts and changes, record supervisor assessments and awareness times, and prepare restrictive-practice reporting follow-up.

Text test mode is the default. Voice remains available through the same ElevenLabs Agent and form tools. Both demo workspaces use the current signed-in owner's records; separate staff accounts and organisation-wide manager permissions are not implemented.

Use fictional participant details. The form is provisional and the question bank needs clinical review. This app does not certify regulatory compliance or submit reports to the NDIS Commission. Alerts appear in the app only; no external notification is sent.

## Development

Requires Node.js 22.13 or later and npm. Run commands from this repository's root.

```sh
npm run install:ci
cp .env.example .env.local
npm run build
```

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` in `.env.local` to enable text/voice interviews. Manual drafting works without these credentials. The key stays on the server. See [Agent configuration](docs/elevenlabs-agent.md).

For a **fresh local database only**, apply all three SQL migrations in order:

```sh
for migration in drizzle/0000_confused_green_goblin.sql drizzle/0001_eminent_lilandra.sql drizzle/0002_amazing_spectrum.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration" || break
done
```

Existing local databases should receive only unapplied migrations. Do not edit or rerun an applied migration. `npm run db:generate` creates new migrations after schema changes; production migrations are managed by Sites.

```sh
npm run dev
```

Open `http://localhost:5173/`. Local development sign-in is available at `/signin-with-chatgpt?return_to=/worker` through the starter's development identity. Hosted requests use ChatGPT authentication.

## Checks

```sh
npm run check
npm run build
```

`check` runs formatting checks, ESLint, TypeScript, and the 30 unit tests. Use `npm run format` to format application source, tests and docs. Generated migrations, vendored UI components, and platform build support are kept intact.

With the local preview running and ElevenLabs configured:

```sh
npm run test:api
```

The HTTP checks create fictional records in the local database and request connection credentials, but do not open an audio call. They cover note revisions, confirmation, early risk capture, evidence preservation and manager review. Append-only evidence remains in that local test database.

`npm run test:live` is an **optional** real Agent text conversation. It consumes Agent credits and tests extraction, correction and confirmation. It is separate from `check`; live speech quality and full conversation performance require acceptance testing. See [conversation integration](docs/voice-integration.md).

## Source layout

| Directory                                                           | Responsibility                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `app/worker`, `app/workspace.tsx`, `app/voice-panel.tsx`            | Worker workspace and text/voice lifecycle                    |
| `app/manager`, `app/management-board.tsx`                           | Manager review queue, timelines and evidence views           |
| `app/api`                                                           | Authenticated note, session, audit and manager operations    |
| `lib/shift-form.ts`, `lib/voice-state.ts`                           | Form validation and revision-bound confirmation              |
| `lib/participants.ts`, `lib/safety.ts`                              | Four fictional profiles, candidate detection and plan checks |
| `lib/audit-server.ts`, `lib/notes-server.ts`, `lib/voice-server.ts` | Persistence and append-only evidence                         |
| `db`, `drizzle`                                                     | Schema and database migrations                               |
| `tests`                                                             | Unit, HTTP and optional live Agent tests                     |
| `components/ui`, `vendor`, `build`                                  | Existing UI library and Sites build support                  |
| `docs`                                                              | Requirements, Agent configuration and testing guidance       |

## Evidence model

Fields distinguish stated facts, explicit negatives and topics not yet reviewed. Missing information does not mean an incident did not happen. Candidate flags are retained for supervisor assessment, including when the worker disagrees or later edits the note.

The app keeps an append-only transcript, the original generated review draft, and saved changes. Final confirmation is tied to the current note revision and a fresh worker response. Inbox capture time, provider awareness and external Commission notification are distinct facts. Birth dates are unavailable in the fictional profiles; extended retention decisions remain unresolved.

The implementation and current limitations are recorded in [requirements](docs/requirements.md). Earlier ideas in that document are historical context; its implementation sections describe the current demo.

## Credentials and hosting

Never commit `.env.local`, `.secrets/`, tokens, local database files or conversation exports. `.env.example` contains variable names and a non-secret Agent identifier only. GitHub credentials are local development credentials and must not be added to the app's runtime environment or deployed assets.

`.openai/hosting.json` retains the existing private Sites project and storage bindings. GitHub stores the source; pushing here does not automatically deploy the app. Configure ElevenLabs values as server secrets when deploying through Sites. No GitHub Actions workflow is configured in this repository.

For the standalone VM runtime, protected HTTPS access, persistent data and hourly updates from `main`, see [VM deployment](docs/vm-deployment.md).
