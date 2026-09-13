# VM deployment

The VM runs a separate LegalMate instance from the Sites deployment. It uses the built Worker through Wrangler/Miniflare, local persistent D1, and an HTTPS Nginx proxy. Google sign-in and the limited Email/password test-account flow are handled by the application. Email-code sign-in is deferred in the current release. The VM is still an MVP deployment with a single local database.

## Runtime and access

- `/opt/legalmate/runtime/node`: app-specific Node 22; the VM's system Node is unchanged.
- `/opt/legalmate/releases/<commit>`: source, dependencies and built assets for each release.
- `/opt/legalmate/current`: active release symlink.
- `/etc/legalmate/runtime.env`: server-only application configuration, loaded by Wrangler's `--env-file` into Worker bindings.
- `/var/lib/legalmate/state`: persistent D1 data, independent of releases.
- `/var/lib/legalmate/backups`: database snapshots taken while the app is stopped, before migration.
- `/opt/legalmate/ssh/github_ed25519`: VM-only, read-only GitHub deploy key.

The service runs as the unprivileged `legalmate` account on `127.0.0.1:8787`. Only Nginx is exposed externally. Nginx forwards application cookies, supplies the public HTTPS host and protocol, strips the old identity headers, and does not use Basic authentication. The app ignores `oai-authenticated-user-*` headers in every environment. The old development cookie, ChatGPT sign-in endpoints, and VM test passwords do not establish an application session.

Set the shared origin, authentication secret and Google credentials in `/etc/legalmate/runtime.env` before activating this release. Add `LEGALMATE_TEST_PASSWORD` to the same private environment only when enabling the operator-provisioned shared test accounts. No Resend configuration is required:

| Variable                                       | Purpose                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `LEGALMATE_PUBLIC_ORIGIN`                      | Exact public HTTPS origin, without a path; also used for request-origin validation.                                                     |
| `BETTER_AUTH_SECRET`                           | Stable random secret with at least 32 characters. Keep the same value across releases.                                                  |
| `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`  | Google OAuth web application credentials. Register `<LEGALMATE_PUBLIC_ORIGIN>/api/auth/callback/google` as its authorised redirect URI. |
| `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` | Existing server-side Agent connection configuration.                                                                                    |

Use separate localhost Google redirect configuration for local testing. The app reads runtime Worker bindings with a server-side process environment fallback; none of these credentials belong in a browser bundle. Keep secrets out of Git and deployment logs. Do not print the runtime environment file during validation.

Google must be configured for deployment readiness. The limited test-account password and any deferred email-code configuration do not satisfy readiness on their own. The current UI offers Google plus a conditional Email/password form for the two shared TestProvider accounts; no general email signup or OTP button is available. `/api/health` is a public, read-only endpoint returning only readiness booleans. It returns `503` if authentication configuration or the required auth/provider/application schema is missing. It does not create an account, issue a session, read notes, or call Google, email delivery, or ElevenLabs. A `200` confirms configuration and schema readiness, not external credential validity: complete a real Google sign-in smoke test before opening access.

## One-time activation of Google authentication

This change needs coordinated application, database and root-owned proxy/deployment-helper updates. Repository edits alone do not alter installed VM files. Do not let the hourly timer activate this release before the credentials and migration plan are ready.

1. Pause the deployment timer for the transition. Record the active revision and keep the previous root-owned Nginx configuration and deployment helper for rollback. Prepare the required credentials using the VM's existing protected secret file.
2. Verify a backup of persistent D1 and the current migration ledger. If a database was previously migrated manually without ledger entries, reconcile its actual schema with its migration history before using the automated deployment helper; do not blindly reapply old migrations.
3. Install the updated deployment helper as root-owned configuration. It checks `/api/health` without authentication or fabricated user headers. Stage the updated Nginx template and validate it with `nginx -t` as part of the maintenance window.
4. Activate the tested application revision with the helper's stopped-service backup and migration process. The additive auth and organisation migrations create the new account/provider tables and add nullable `shift_notes.provider_id`. They do not create providers, managers or test accounts.
5. Provision the agreed service providers and first manager access using the operator-only provisioning script. There is no public provider creation endpoint. Confirm the intended manager's verified email address before granting access.
6. Activate the corresponding Nginx configuration during the same maintenance window, then verify Google sign-in, worker onboarding, manager access, sign-out, and denial of worker access to another worker's records. When shared testing is enabled, also verify both fixed Email/password accounts, wrong-password rejection and their TestProvider-only access. Confirm no general email signup or OTP flow is offered. Resume the timer only after these checks pass.

Shared test login aliases (`managertest@gmail.com` and `workertest@gmail.com`) resolve to reserved internal test identities, not to personal Google accounts with those email addresses. Provision the test identities and TestProvider through the operator setup procedure described in [authentication setup](authentication.md#limited-emailpassword-test-accounts); keep the test password in the private runtime environment. Do not attach test passwords or test grants to personal Google identities.

Existing `owner_id` values, record IDs and append-only evidence are preserved. New authenticated account IDs are not matched to legacy ChatGPT or `vm_<username>` identities by email or display name. Existing notes retain a null provider and are not automatically exposed to a new account or organisation. Any later legacy-record access/migration must use an explicit, reviewed identity mapping and preserve the original audit evidence; onboarding is not an ownership-transfer mechanism. Keep the backup available until legacy access requirements have been resolved.

If rollback crosses the old Basic-auth/new cookie-auth boundary, restore the matching previous root-owned Nginx configuration along with the old application. The helper restores application and database state, but cannot infer or restore manually installed proxy configuration or credentials. Its legacy `/` fallback checks only process availability, not successful legacy user sign-in.

VM data starts empty on a new installation. Local Mac test records and the Sites database are not copied.

## Hourly deployment

Install the files in `deploy/vm` as root-owned configuration: service units in `/etc/systemd/system`, deployment helpers in `/usr/local/lib/legalmate`, and the rendered Nginx template in `/etc/nginx/sites-available/legalmate`. The root deployment helper runs fetched code, npm builds and migrations as `legalmate`, never as root.

`legalmate-deploy.timer` runs on the VM every hour, including after a reboot. It fetches GitHub `main` using the read-only repository deploy key. It skips unchanged commits, installs dependencies, runs lint/type checks/unit tests, builds the candidate, enters a short maintenance window, backs up the database, applies pending migrations using the migration ledger, activates the release and checks `/api/health`. Build failures leave the active release running; activation failures restore the prior release and pre-migration data before removing maintenance mode. Seven database backups, three recent releases and the active/previous releases are retained.

New releases must pass the health endpoint with HTTP `200`. Only during rollback, and only if an older release returns `404` from `/api/health`, may the helper accept HTTP `200` from `/`. A `503`, server error, authentication error or connection failure from the health endpoint never falls back to the home page.

```sh
systemctl status legalmate legalmate-deploy.timer
systemctl list-timers legalmate-deploy.timer
journalctl -u legalmate -n 100
journalctl -u legalmate-deploy -n 100
systemctl start legalmate-deploy.service
systemctl disable --now legalmate-deploy.timer
```

GitHub pushes do not deploy to the existing Sites website. The hourly timer affects only this VM. Prompt changes published in ElevenLabs apply to new conversations and do not require a code deployment.

Run `nginx -t` before reloading Nginx. HTTPS certificates live in `/etc/legalmate/letsencrypt`; the `legalmate-cert-renew.timer` checks twice daily and reloads Nginx after renewal. The VM's other Certbot accounts, certificates and timers are unchanged.

## Local integration testing

The notes, voice, safety and live text HTTP scripts load a real session from `LEGALMATE_TEST_COOKIE_FILE`, a private local file containing one browser Cookie header line. They validate `/api/onboarding` before creating records. Complete worker onboarding first; safety tests also need a manager grant for that worker's selected provider. See [Authentication test setup](authentication.md#http-test-sessions) for commands. The removed `/signin-with-chatgpt` route cannot create a session.

The isolated `tests/onboarding-api.mjs` harness instead runs the built Worker in Miniflare with a new in-memory D1 database. It applies all migrations and seeds real signed-session rows from the captured-email auth fixture using a test-only origin and secret. It checks actual HTTP authorisation, provider affiliation, manager/audit access and logout without using the app's existing server or state. Outbound requests are denied. This fixture is never imported by application code.
