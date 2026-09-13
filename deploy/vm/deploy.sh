#!/usr/bin/env bash
# Installed root-owned outside the checkout. Builds and migrations run unprivileged.
set -Eeuo pipefail
umask 027
ROOT=/opt/legalmate
STATE=/var/lib/legalmate/state
BACKUPS=/var/lib/legalmate/backups
MAINTENANCE=/var/lib/legalmate/maintenance
REPO=$ROOT/repository
NODE=$ROOT/runtime/node/bin
export PATH="$NODE:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
exec 9>/run/lock/legalmate-deploy.lock
flock -n 9 || exit 0

as_app() {
  runuser -u legalmate -- env PATH="$PATH" CI=1 npm_config_cache="$ROOT/cache/npm" \
    CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false \
    GIT_SSH_COMMAND="ssh -i $ROOT/ssh/github_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ROOT/ssh/known_hosts -o BatchMode=yes" "$@"
}

if [[ ! -d "$REPO/.git" ]]; then
  as_app git init "$REPO"
  as_app git -C "$REPO" remote add origin git@github.com:Chien-Wu/legalMate.git
fi

if [[ ${1:-} == --initial ]]; then
  REVISION=${2:-}
  [[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid initial revision.' >&2; exit 1; }
  [[ -f "$ROOT/releases/$REVISION/package.json" ]] || exit 1
else
  as_app git -C "$REPO" fetch --prune origin +refs/heads/main:refs/remotes/origin/main
  REVISION=$(as_app git -C "$REPO" rev-parse refs/remotes/origin/main)
fi

PREVIOUS=$(readlink -f "$ROOT/current" || true)
RELEASE=$ROOT/releases/$REVISION
if [[ "$PREVIOUS" == "$RELEASE" ]] && systemctl is-active --quiet legalmate.service; then
  echo "Already serving main at $REVISION"
  exit 0
fi

if [[ ! -f "$RELEASE/package.json" ]]; then
  install -d -o legalmate -g legalmate -m 0750 "$RELEASE"
  as_app git -C "$REPO" archive "$REVISION" | as_app tar -x -C "$RELEASE"
fi

cd "$RELEASE"
as_app npm run install:ci
as_app npm run lint
as_app npm run typecheck
as_app npm test
as_app npm run build
as_app node deploy/vm/configure-release.mjs

BACKUP=$BACKUPS/$(date -u +%Y%m%dT%H%M%SZ)-${REVISION:0:12}
install -d -m 0750 "$BACKUP"
STOPPED=0
BACKED_UP=0

health() {
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 3 http://127.0.0.1:8787/api/notes \
      -H 'oai-authenticated-user-id: vm_deployment_health' \
      -H 'oai-authenticated-user-email: deployment-health@legalmate.local' >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  local status=${1:-1}
  trap - ERR TERM INT
  if [[ "$STOPPED" == 1 ]]; then
    if ! systemctl stop legalmate.service; then
      echo 'Could not stop LegalMate; maintenance remains enabled and database has not been restored.' >&2
      exit "$status"
    fi
    if [[ "$BACKED_UP" == 1 ]]; then
      mv "$STATE" "$BACKUP/failed-state"
      cp -a "$BACKUP/state" "$STATE"
    fi
    if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
      ln -sfn "$PREVIOUS" "$ROOT/current"
      systemctl start legalmate.service
      if health; then rm -f "$MAINTENANCE"; fi
    fi
  fi
  echo "Deployment failed for $REVISION; previous release retained. See journalctl -u legalmate-deploy." >&2
  exit "$status"
}
trap 'rollback $?' ERR
trap 'rollback 143' TERM
trap 'rollback 130' INT

touch "$MAINTENANCE"
STOPPED=1
systemctl stop legalmate.service
if systemctl is-active --quiet legalmate.service; then
  echo 'Application still running; refusing to migrate its database.' >&2
  false
fi
cp -a "$STATE" "$BACKUP/state"
BACKED_UP=1
printf '%s\n' "$PREVIOUS" > "$BACKUP/previous-release"
as_app node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
  d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to "$STATE"
ln -sfn "$RELEASE" "$ROOT/current"
systemctl start legalmate.service
health
rm -f "$MAINTENANCE"
STOPPED=0
trap - ERR TERM INT
echo "Deployed main at $REVISION"

# Keep the active and previous release plus three recent candidates; retain seven DB backups.
python3 /usr/local/lib/legalmate/prune.py
