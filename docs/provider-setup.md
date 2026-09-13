# Service providers and staff access

A **service provider** is an organisation. A **manager** is an authenticated person with an administrator-provisioned grant for that organisation. There is no public provider registration or manager-role upgrade endpoint.

Support workers choose an existing provider, sign in with Google or email, and save their full name. This immediately creates their worker affiliation; no invitation or manager approval is required. The public provider list exposes only active provider IDs and names.

## Provisioning a provider and first manager

Apply authentication migration `0003` and organisation migration `0004_organisations.sql` to the intended database after the existing `0000`–`0002` migrations. Do not rerun already-applied migrations against the existing demo database: it may have no migration ledger. Migration `0004` preserves existing notes and evidence and leaves legacy notes without a provider.

From the `web` directory, prepare parameterized SQL for review:

```sh
node scripts/provision-provider.mjs --id YOUR_PROVIDER_ID --name "Your service provider" --manager-email manager@example.org
```

This only prints SQL and bindings; it does not change a database. Use the real organisation and the agreed first manager's email after discussing access with the provider. The script creates no sample organisations by default. Keep the printed provider ID for subsequent updates.

For an explicitly local setup, after building the project and applying migrations:

```sh
node scripts/provision-provider.mjs --id YOUR_PROVIDER_ID --name "Your service provider" --manager-email manager@example.org --local --config dist/server/wrangler.json
```

The local option runs Wrangler with `--local` and the project's `.wrangler/state` persistence directory. No remote option is supported. The script serializes bound values safely for Wrangler's SQL-file interface and deletes its temporary SQL file. Production provisioning is a separate administrator operation using the reviewed statements and bindings against the intended database.

The first manager signs in with the provisioned email address. Once that email is verified by the authentication service, the grant is bound to their stable application user ID. A grant already bound to another user cannot be claimed again. Disabling its `active` flag removes management access; selecting a provider on the worker signup form never grants management rights.

## Data boundaries

- Workers see and edit their own notes. A worker profile and active provider affiliation are required to create a new note.
- Each new note stores its provider at creation. Changing the worker's current affiliation does not move earlier notes. Database protection prevents changing a saved note's provider.
- Managers see their provider's notes, risk queue, monthly summary and preserved evidence, and can append management assessments. They cannot change workers' observations, start their conversations or confirm their notes.
- For people managing more than one provider, management requests select `?providerId=...`; otherwise the first managed provider is selected. Every request checks the authenticated person's current grant.
- Original note ownership and append-only transcripts, drafts and changes are preserved. Legacy ChatGPT identities are not automatically merged into new accounts by matching email, and legacy notes are not automatically shared with a provider.
- The four participant profiles remain fictional demonstration data. Provider-specific participant directories and care-plan access are not part of this onboarding change.

## API contracts

- `GET /api/providers` → `{ providers: [{ id, name }] }`.
- `GET /api/onboarding` requires verified sign-in and returns `{ user, profile: { fullName, providerId } | null, providers, managedProviders }`.
- `POST /api/onboarding` accepts `{ fullName, providerId }`, immediately saves the worker profile and affiliation, and returns `{ ok: true }`.
- `GET /api/management?providerId=...` returns that authorised provider's board. Posting a management assessment accepts the same provider query parameter.
