# Google and email sign-in

LegalMate uses Better Auth 1.7.4 with the Drizzle D1 adapter. People sign in with Google or a six-digit email code; passwords and other social providers are disabled. Managers use the same sign-in methods as workers. Manager access is assigned through provisioned provider grants, not through a public sign-up field. See [Provider setup](provider-setup.md).

## Required server configuration

Set these values in the ignored `web/.env.local` for development and in the hosting environment's secrets for deployment. Keep the same authentication secret across instances serving one environment.

| Variable                  | Purpose                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `LEGALMATE_PUBLIC_ORIGIN` | Exact app origin, e.g. `http://localhost:5173` locally or the production HTTPS origin. No path, query, credentials or trailing route. |
| `BETTER_AUTH_SECRET`      | A cryptographically random secret of at least 32 characters; generate a separate value for each environment.                          |
| `GOOGLE_CLIENT_ID`        | Google OAuth client ID for a Web application.                                                                                         |
| `GOOGLE_CLIENT_SECRET`    | Secret belonging to that Google client.                                                                                               |
| `RESEND_API_KEY`          | Resend key authorized to send sign-in emails.                                                                                         |
| `LEGALMATE_EMAIL_FROM`    | Verified sender, e.g. `LegalMate <signin@your-verified-domain.example>`.                                                              |

Authentication also requires the D1 `DB` binding and migrations `0003_auth.sql` and `0004_organisations.sql`, following the existing migrations. These create new tables and preserve existing shift-note evidence. Do not reset the database to add sign-in.

The origin must use HTTPS except for localhost, `127.0.0.1`, and `::1` development addresses. `GET /api/auth/status` reports which configured sign-in methods are available without revealing secrets. Missing configuration disables the corresponding sign-in button; a missing origin, short/missing authentication secret, or missing DB binding disables both. There is no development identity bypass. Health checks additionally verify schema readiness.

## Google setup

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client of type **Web application**.
2. Add `http://localhost:5173` as a local JavaScript origin and `http://localhost:5173/api/auth/callback/google` as an authorized redirect URI.
3. Add the deployed app origin and its exact `/api/auth/callback/google` URI to the production client. Prefer separate development and production clients.
4. Put the client ID and secret in the server configuration above. If the consent app is in testing mode, add the intended testers in Google Cloud Console.

Use the real public origin seen by the browser; proxy hosts and a different localhost port are not interchangeable with a registered redirect URI. Restart the development server after changing environment values.

Only Google's fresh verified-email identity is accepted, including on returning sign-ins. Google can link to an existing LegalMate email-code account only when both identities have verified ownership of the same email. Unverified-provider claims are never trusted, and different-email linking is disabled.

References: [Better Auth Google configuration](https://better-auth.com/docs/authentication/google), [Google web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

## Email setup

1. Create a Resend API key and verify a sending domain in Resend.
2. Set `LEGALMATE_EMAIL_FROM` to a sender on that verified domain and store `RESEND_API_KEY` on the server.
3. Sign in with an email you control, enter the code, and confirm the onboarding page opens. Development tests use an in-memory captured sender and do not send real mail.

Codes expire after five minutes and allow three incorrect attempts. Stored codes and verification identifiers are hashed. Resending rotates the code, and a successful code cannot be reused. The database enforces persistent request rate limits; the app returns a clear retry message if email delivery fails. The email provider processes the recipient address and the sign-in code to deliver the message.

References: [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction), [Resend sending API](https://resend.com/docs/api-reference/emails/send-email), [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp).

## Sessions and existing evidence

Sessions last up to eight hours and use signed, HttpOnly, SameSite=Lax cookies, with Secure cookies on HTTPS. Every authenticated request checks the database-backed session; sign-out revokes it. Only Cloudflare's client-IP header is used for rate-limit IP detection; if it is absent, Better Auth uses a shared per-route bucket. A reverse proxy must not allow clients to supply an untrusted replacement for that header.

New authentication user IDs have an `auth_` prefix. Neither ChatGPT identity headers nor email matches attach a new user to an existing legacy evidence owner. Older notes, transcripts, and audit records retain their original owner IDs. Any future legacy ownership migration requires an explicit, reviewed mapping.

Run `node --experimental-strip-types --test tests/auth.test.mjs` for isolated authentication checks. These cover real OTP sign-in, signed sessions, replay/expiry/attempt rejection, logout, persistent rate limiting, cross-origin denial, failed email delivery, and verified Google identity rules. Live Google redirects and real email deliverability still require the external credentials above.

## HTTP test sessions

The existing notes, voice, safety and live text tests use a real test account. Sign in normally and complete the worker's name and provider selection. In browser developer tools, copy the Cookie request-header value from a request to the app into a private, ignored local file such as `.secrets/http-test-cookie.txt`; keep that file readable only by you (mode `600`). It contains session access, so do not paste it into chat, Git or logs. Refresh the file after signing in again if the session expires.

```sh
LEGALMATE_TEST_COOKIE_FILE="$PWD/.secrets/http-test-cookie.txt" npm run test:api
LEGALMATE_TEST_COOKIE_FILE="$PWD/.secrets/http-test-cookie.txt" npm run test:live
```

`LEGALMATE_TEST_ORIGIN` optionally selects a test deployment; the default is `http://localhost:5173`. Use a cookie from that same origin. Safety tests require the signed-in worker to also have an operator-provisioned manager grant for their selected provider, and scope management requests to that provider. These tests create fictional records in the selected test account. Voice tests need configured ElevenLabs access; the live text test uses Agent credits.

For a fully isolated run without external credentials, first build the app and then run:

```sh
npm run build
node --experimental-strip-types tests/onboarding-api.mjs
```

This harness starts a temporary local Worker with isolated D1, copies signed session rows from the real captured-email authentication fixture, and tests the deployed route handlers. It never reads `.env.local`, the live cookie file, or existing app state, and blocks external service calls. The temporary runtime is disposed after the test.
