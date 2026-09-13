# LegalMate

An English web app for disability support workers to capture a shift in one conversation, review the saved facts, and explicitly confirm their note. Managers have a separate workspace for reviewing alerts and evidence.

## Workspaces

- `/` — mobile-first Service provider / Support worker selection, expanding Google and email sign-in in place.
- `/onboarding` — workers confirm their name and select an existing service provider; no manager invitation or approval is required.
- `/worker` — select a fictional participant, type or speak through the shift, edit a draft, review and confirm, and export the note.
- `/manager` — review captured candidates, inspect transcripts and changes, record supervisor assessments and awareness times, and prepare restrictive-practice reporting follow-up.

Text test mode is the default. Voice remains available through the same ElevenLabs Agent and form tools. Workers access their own notes; provisioned managers can review their provider's notes and evidence. Providers and their first manager accounts are provisioned by the LegalMate team, with no public organisation sign-up. Each note retains the provider it was created for when a worker changes affiliation.

Use fictional participant details. The form is provisional and the question bank needs clinical review. This app does not certify regulatory compliance or submit reports to the NDIS Commission. Alerts appear in the app only; no external notification is sent.

## Development

Requires Node.js 22.13 or later and npm. Run commands from this repository's root.

```sh
npm run install:ci
cp .env.example .env.local
npm run build
```

Configure Google and email sign-in using [authentication setup](docs/authentication.md), then create the provider and first manager using [provider setup](docs/provider-setup.md). A missing auth configuration shows a clear setup state and cannot sign users in. Existing `.env.local` files should be extended with the new variables from `.env.example`, not overwritten.

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` in `.env.local` to enable text/voice interviews. Authenticated workers can draft manually without ElevenLabs credentials. All keys stay on the server. See [Agent configuration](docs/elevenlabs-agent.md).

For a **fresh local database only**, apply all five SQL migrations in order:

```sh
for migration in drizzle/0000_confused_green_goblin.sql drizzle/0001_eminent_lilandra.sql drizzle/0002_amazing_spectrum.sql drizzle/0003_auth.sql drizzle/0004_organisations.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration" || break
done
```

Existing local databases should receive only unapplied migrations, after a backup. Do not edit or rerun an applied migration. `npm run db:generate` creates new migrations after schema changes. Existing legacy notes stay with their historical owner IDs and remain unassigned to any provider; email sign-in does not automatically claim them.

```sh
npm run dev
```

Open `http://localhost:5173/`. Google and email-code sign-in use the same application authentication locally and on the standalone VM. Dummy ChatGPT and HTTP Basic sign-in are retired. Set `LEGALMATE_CONTACT_URL` to an HTTPS or mailto link for new provider enquiries; when unset, the entry page only directs visitors to contact the LegalMate team.

## Checks

```sh
npm run check
npm run build
npm run test:onboarding
```

`check` runs formatting checks, ESLint, TypeScript, and the unit/isolated SQLite tests, including authentication and organisation isolation. After building, `test:onboarding` exercises the built app against an isolated D1 database with signed test sessions; it makes no external service calls and does not change the development database. Use `npm run format` to format application source, tests and docs. Generated migrations, vendored UI components, and platform build support are kept intact.

With the local preview running, ElevenLabs configured, and the authenticated test-cookie fixture described in [authentication setup](docs/authentication.md):

```sh
npm run test:api
```

The HTTP checks create fictional records in the local database and request connection credentials, but do not open an audio call. They cover note revisions, confirmation, early risk capture, evidence preservation and manager review. Append-only evidence remains in that local test database.

`npm run test:live` is an **optional** real Agent text conversation. It consumes Agent credits and tests extraction, correction and confirmation. It is separate from `check`; live speech quality and full conversation performance require acceptance testing. See [conversation integration](docs/voice-integration.md).

## Source layout

| Directory                                                                  | Responsibility                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `app/worker`, `app/workspace.tsx`, `app/voice-panel.tsx`                   | Worker workspace and text/voice lifecycle                    |
| `app/manager`, `app/management-board.tsx`                                  | Manager review queue, timelines and evidence views           |
| `app/api`                                                                  | Authenticated note, session, audit and manager operations    |
| `lib/auth.ts`, `lib/auth-config.ts`, `app/entry.tsx`                       | Google/email sign-in, session verification and entry UI      |
| `lib/organisations.ts`, `app/onboarding`, `scripts/provision-provider.mjs` | Worker affiliation, provider roles and staff provisioning    |
| `lib/shift-form.ts`, `lib/voice-state.ts`                                  | Form validation and revision-bound confirmation              |
| `lib/participants.ts`, `lib/safety.ts`                                     | Four fictional profiles, candidate detection and plan checks |
| `lib/audit-server.ts`, `lib/notes-server.ts`, `lib/voice-server.ts`        | Persistence and append-only evidence                         |
| `db`, `drizzle`                                                            | Schema and database migrations                               |
| `tests`                                                                    | Unit, HTTP and optional live Agent tests                     |
| `components/ui`, `vendor`, `build`                                         | Existing UI library and Sites build support                  |
| `docs`                                                                     | Requirements, Agent configuration and testing guidance       |

## Evidence model

Fields distinguish stated facts, explicit negatives and topics not yet reviewed. Missing information does not mean an incident did not happen. Candidate flags are retained for supervisor assessment, including when the worker disagrees or later edits the note.

The app keeps an append-only transcript, the original generated review draft, and saved changes. Final confirmation is tied to the current note revision and a fresh worker response. Inbox capture time, provider awareness and external Commission notification are distinct facts. Birth dates are unavailable in the fictional profiles; extended retention decisions remain unresolved.

The implementation and current limitations are recorded in [requirements](docs/requirements.md). Earlier ideas in that document are historical context; its implementation sections describe the current demo.

## Credentials and hosting

Never commit `.env.local`, `.secrets/`, tokens, local database files or conversation exports. `.env.example` contains variable names and a non-secret Agent identifier only. GitHub credentials are local development credentials and must not be added to the app's runtime environment or deployed assets.

`.openai/hosting.json` retains the previous private Sites project and storage bindings. This branch implements standalone application authentication; activating it on the VM requires the auth configuration and proxy changes documented below. The older Sites deployment has its own access gate and is not changed by this branch. No GitHub Actions workflow is configured in this repository.

For the standalone VM runtime, protected HTTPS access, persistent data and hourly updates from `main`, see [VM deployment](docs/vm-deployment.md).
