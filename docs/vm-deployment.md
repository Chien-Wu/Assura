# VM deployment

The VM runs a separate LegalMate instance from the Sites deployment. It uses the existing built Worker through Wrangler/Miniflare, local persistent D1, and an authenticated HTTPS Nginx proxy. This is an MVP testing deployment, not a replacement for a managed production database and full staff authentication.

## Runtime and access

- `/opt/legalmate/runtime/node`: app-specific Node 22; the VM's system Node is unchanged.
- `/opt/legalmate/releases/<commit>`: source, dependencies and built assets for each release.
- `/opt/legalmate/current`: active release symlink.
- `/etc/legalmate/runtime.env`: server-only ElevenLabs configuration and `LEGALMATE_PUBLIC_ORIGIN`.
- `/etc/legalmate/users.htpasswd`: HTTPS test-login password hashes.
- `/var/lib/legalmate/state`: persistent D1 data, independent of releases.
- `/var/lib/legalmate/backups`: database snapshots taken while the app is stopped, before migration.
- `/opt/legalmate/ssh/github_ed25519`: VM-only, read-only GitHub deploy key.

The service runs as the unprivileged `legalmate` account on `127.0.0.1:8787`. Only Nginx is exposed externally. Nginx requires a password, replaces all four trusted identity headers and strips the Basic authentication header before proxying. Set `LEGALMATE_PUBLIC_ORIGIN` to the public HTTPS origin so write validation remains strict behind the proxy.

Each test-login username maps to its own note owner. The existing manager board still shows only that owner's records. A shared test login shares its records. This deployment does not add organisation-wide manager permissions. Browser Basic authentication can remain cached until the browser session closes; the existing ChatGPT sign-out link is not a full VM session logout.

VM data starts empty. Local Mac test records and the Sites database are not copied.

## Hourly deployment

Install the files in `deploy/vm` as root-owned configuration: service units in `/etc/systemd/system`, deployment helpers in `/usr/local/lib/legalmate`, and the rendered Nginx template in `/etc/nginx/sites-available/legalmate`. The root deployment helper runs fetched code, npm builds and migrations as `legalmate`, never as root.

`legalmate-deploy.timer` runs on the VM every hour, including after a reboot. It fetches GitHub `main` using the read-only repository deploy key. It skips unchanged commits, installs dependencies, runs lint/type checks/unit tests, builds the candidate, enters a short maintenance window, backs up the database, applies pending migrations using the migration ledger, activates the release and checks the notes API. Build failures leave the active release running; activation failures restore the prior release and pre-migration data before removing maintenance mode. Seven database backups, three recent releases and the active/previous releases are retained.

```sh
systemctl status legalmate legalmate-deploy.timer
systemctl list-timers legalmate-deploy.timer
journalctl -u legalmate -n 100
journalctl -u legalmate-deploy -n 100
systemctl start legalmate-deploy.service
systemctl disable --now legalmate-deploy.timer
```

GitHub pushes do not deploy to the existing Sites website. The hourly timer affects only this VM. Prompt changes published in ElevenLabs apply to new conversations and do not require a code deployment.

Run `nginx -t` before reloading Nginx. HTTPS certificate renewals use the VM's existing Certbot timer and a LegalMate-specific Nginx reload hook. Keep secrets out of Git and deployment logs.
