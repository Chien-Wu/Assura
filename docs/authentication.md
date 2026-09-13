# Google and limited test-account sign-in

LegalMate uses Better Auth 1.7.4 with the Drizzle D1 adapter. Personal accounts use Google sign-in. A separate Email/password form accepts only two provisioned shared test accounts for TestProvider; it is not general email/password registration. Email-code sign-in and other social providers remain unavailable in the entry UI. Manager access is assigned through provisioned provider grants, not through a public sign-up field. See [Provider setup](provider-setup.md).

## Required server configuration

Set these values in the ignored `web/.env.local` for development and in the hosting environment's secrets for deployment. Keep the same authentication secret across instances serving one environment.

| Variable                  | Purpose                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `LEGALMATE_PUBLIC_ORIGIN` | Exact app origin, e.g. `http://localhost:5173` locally or the production HTTPS origin. No path, query, credentials or trailing route. |
| `BETTER_AUTH_SECRET`      | A cryptographically random secret of at least 32 characters; generate a separate value for each environment.                          |
| `GOOGLE_CLIENT_ID`        | Google OAuth client ID for a Web application.                                                                                         |
| `GOOGLE_CLIENT_SECRET`    | Secret belonging to that Google client.                                                                                               |

The optional test-account form additionally requires `LEGALMATE_TEST_PASSWORD` in the server environment and the operator-provisioned test identities described below. The shared demo password is intentionally delivered to signed-out visitors to prefill the form. Keep its actual value out of source, documentation and logs.

Authentication also requires the D1 `DB` binding and migrations `0003_auth.sql` and `0004_organisations.sql`, following the existing migrations. These create new tables and preserve existing shift-note evidence. Do not reset the database to add sign-in.

The origin must use HTTPS except for localhost, `127.0.0.1`, and `::1` development addresses. `GET /api/auth/status` reports configured authentication capabilities without revealing secrets. Missing Google credentials, a missing origin, a short/missing authentication secret, or a missing DB binding disables the Google button. There is no development identity bypass. Google remains required for deployment readiness; the limited test-account form is enabled separately. No Resend configuration is required.

Deployment readiness requires the complete application schema and Google sign-in configuration. Test-account credentials or an email-only backend configuration cannot satisfy readiness on their own. A ready response does not verify external credential validity; complete a real Google sign-in and, when enabled, both test-account sign-ins before making the app available.

## Google setup

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client of type **Web application**.
2. Add `http://localhost:5173` as a local JavaScript origin and `http://localhost:5173/api/auth/callback/google` as an authorized redirect URI.
3. Add the deployed app origin and its exact `/api/auth/callback/google` URI to the production client. Prefer separate development and production clients.
4. Put the client ID and secret in the server configuration above. If the consent app is in testing mode, add the intended testers in Google Cloud Console.

Use the real public origin seen by the browser; proxy hosts and a different localhost port are not interchangeable with a registered redirect URI. Restart the development server after changing environment values.

Only Google's fresh verified-email identity is accepted, including on returning sign-ins. Google can link to an existing LegalMate email-code account only when both identities have verified ownership of the same email. Unverified-provider claims are never trusted, and different-email linking is disabled.

References: [Better Auth Google configuration](https://better-auth.com/docs/authentication/google), [Google web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

## Limited Email/password test accounts

When test-account sign-in is enabled, choosing a role opens the test-account form with its corresponding alias and the shared password already filled in:

| Public login alias      | Internal identity                                      | Access                                         |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `managertest@gmail.com` | `auth_test_manager` / `manager@test.legalmate.invalid` | TestProvider manager; redirects to `/manager`. |
| `workertest@gmail.com`  | `auth_test_worker` / `worker@test.legalmate.invalid`   | TestProvider worker; redirects to `/worker`.   |

The aliases are labels for shared test accounts, not proof of ownership of those Gmail addresses. The server checks the fixed alias and `LEGALMATE_TEST_PASSWORD`, then issues a signed, database-backed session for the distinct internal identity. A personal Google account using the same Gmail address remains a separate account and does not acquire a password or roles through test login. Any separately provisioned manager grant for that Google identity remains independent.

An operator provisions TestProvider and its two internal identities before enabling access. `node --experimental-strip-types scripts/provision-test-accounts.mjs --sql` prints the idempotent provisioning statements for review; apply them to the intended database after migrations. The script neither reads nor stores the password and does not execute SQL itself. The login form cannot create arbitrary accounts, providers, or manager grants. The test worker and manager share TestProvider records for testing, while the normal worker and provider access checks still apply. Use fictional records only: people using the same shared test account share its identity and saved records.

The server reads the configured password at runtime and sends it to the signed-out homepage for prefilling. This makes the two shared test accounts available to all visitors; the password input remains masked and editable. Signed-in visitors and instances with test-account sign-in disabled receive no prefill password. Auth-status and health responses continue to report only readiness flags. Failed passwords and unrecognised aliases are rejected. The endpoint is `POST /api/auth/sign-in/test-account` with `{ email, password }`; successful responses return a server-selected `redirectTo`, and sign-out revokes the resulting session normally.

## Deferred email sign-in

Email-code sign-in remains deferred. The retained OTP backend and captured-email test fixtures are separate from the fixed Email/password test accounts; this release does not configure Resend or offer email-code sign-in. Restoring OTP would require both a UI change and the `RESEND_API_KEY` / `LEGALMATE_EMAIL_FROM` server configuration.

The retained backend hashes codes and verification identifiers, expires codes after five minutes, limits incorrect attempts, rejects replay, and rate-limits requests. Isolated tests capture messages in memory and never send real email. See [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp) for the underlying implementation.

## Sessions and existing evidence

Sessions last up to eight hours and use signed, HttpOnly, SameSite=Lax cookies, with Secure cookies on HTTPS. Every authenticated request checks the database-backed session; sign-out revokes it. Only Cloudflare's client-IP header is used for rate-limit IP detection; if it is absent, Better Auth uses a shared per-route bucket. A reverse proxy must not allow clients to supply an untrusted replacement for that header.

New authentication user IDs have an `auth_` prefix. Neither ChatGPT identity headers nor email matches attach a new user to an existing legacy evidence owner. Older notes, transcripts, and audit records retain their original owner IDs. Any future legacy ownership migration requires an explicit, reviewed mapping.

Run `node --experimental-strip-types --test tests/auth.test.mjs` for isolated authentication checks. These cover real OTP sign-in, signed sessions, replay/expiry/attempt rejection, logout, persistent rate limiting, cross-origin denial, failed email delivery, and verified Google identity rules. Live Google sign-in still requires the configured OAuth client. OTP tests validate the retained backend, not a currently offered sign-in option.

## HTTP tests

Build the app, then run the current isolated suites:

```sh
npm run build
npm run test:api
```

These start temporary Workers with isolated D1 databases and signed synthetic sessions from `tests/support/auth-fixture.mjs`. They test the built route handlers, block external provider calls and dispose each runtime afterwards. They do not read `.env.local`, a live cookie file or the development database. Run `npm run test:onboarding` for the authentication and provider HTTP suite alone.
