# LegalMate web MVP

An English web workspace for support workers to create a shift note, save a draft, review it, and explicitly confirm a completed record. The review view lists real saved records and flags follow-up items.

## Current scope

- Provisional form, clearly marked as a demo; the final organisation template is pending.
- Authenticated, user-scoped D1 persistence with optimistic revision checks.
- Conditional incident/follow-up details and correction handling.
- Review tokens tied to the current revision; changing a draft invalidates its previous confirmation.
- Text export of saved completed notes.
- Simple review list with status filters. Each signed-in user sees their own records; organisational manager roles are not implemented yet.
- **Live voice is not configured.** The voice control is disabled and labelled accordingly. No recorded or simulated conversation is substituted. See `docs/voice-integration.md` for the planned integration.

Use fictional participants for the demo. Form checks verify configured completeness and consistency; they do not certify regulatory compliance.

## Development

Requires Node.js 22.13 or later. `npm run install:ci` installs the pinned dependencies; `npm run dev` starts the preview. Use the local sign-in route `/signin-with-chatgpt?return_to=/` for the starter's development identity.

`npm run db:generate` generates schema migrations. After building, apply pending local migrations with Wrangler against the generated config:

```
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_confused_green_goblin.sql
```

Run that migration once per fresh local database. Production migrations are managed by Sites on deployment.

## Validation

```
node --experimental-strip-types --test tests/shift-form.test.mjs
npx tsc --noEmit
npm run build
```

`tests/notes-api.mjs` exercises draft creation, revisions, validation, confirmation, retry behaviour and authentication against a running local preview. It creates fictional test notes in the local development database.

## Source layout

- `app/workspace.tsx`: worker form, confirmation and review views.
- `lib/shift-form.ts`: provisional field definitions, validation and text rendering.
- `app/api/notes/`: authenticated note operations.
- `lib/notes-server.ts`, `db/schema.ts`, `drizzle/`: data access and migrations.
- `docs/voice-integration.md`: pending ElevenLabs integration.

No API credentials are needed for the current form MVP. When live voice is added, configure secrets through the hosting provider; never expose the ElevenLabs API key in the browser.
