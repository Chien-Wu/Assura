#!/usr/bin/env bash
# Installed root-owned outside the checkout. Builds and migrations run unprivileged.
set -Eeuo pipefail
umask 027
# New installations use Assura paths. An existing installation keeps its storage,
# service account and lock until an operator coordinates a migration.
DEPLOYMENT_NAME=assura
if [[ -z ${ASSURA_DEPLOY_ROOT:-} && ! -d /opt/assura && -d /opt/legalmate ]]; then
  DEPLOYMENT_NAME=legalmate
fi
ROOT=${ASSURA_DEPLOY_ROOT:-/opt/$DEPLOYMENT_NAME}
DATA_ROOT=${ASSURA_DATA_ROOT:-/var/lib/$DEPLOYMENT_NAME}
STATE=$DATA_ROOT/state
BACKUPS=$DATA_ROOT/backups
MAINTENANCE=$DATA_ROOT/maintenance
APP_USER=${ASSURA_SERVICE_USER:-$DEPLOYMENT_NAME}
APP_GROUP=${ASSURA_SERVICE_GROUP:-$APP_USER}
APP_SERVICE=${ASSURA_SERVICE:-$DEPLOYMENT_NAME.service}
DEPLOY_SERVICE=${ASSURA_DEPLOY_SERVICE:-$DEPLOYMENT_NAME-deploy.service}
HELPERS=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
REPO=$ROOT/repository
NODE=$ROOT/runtime/node/bin
export PATH="$NODE:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
exec 9>"${ASSURA_DEPLOY_LOCK:-/run/lock/$DEPLOYMENT_NAME-deploy.lock}"
flock -n 9 || exit 0

as_app() {
  runuser -u "$APP_USER" -- env PATH="$PATH" CI=1 npm_config_cache="$ROOT/cache/npm" \
    XDG_CONFIG_HOME="$DATA_ROOT/config" \
    CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false \
    GIT_SSH_COMMAND="ssh -i $ROOT/ssh/github_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ROOT/ssh/known_hosts -o BatchMode=yes" "$@"
}

REPOSITORY_URL=${ASSURA_REPOSITORY_URL:-git@github.com:Chien-Wu/assura.git}
if [[ -z ${ASSURA_REPOSITORY_URL:-} ]] && ! as_app git ls-remote "$REPOSITORY_URL" HEAD >/dev/null 2>&1; then
  # Keep deployments working while the owner completes the GitHub rename.
  REPOSITORY_URL=git@github.com:Chien-Wu/legalMate.git
fi
if [[ ! -d "$REPO/.git" ]]; then
  as_app git init "$REPO"
  as_app git -C "$REPO" remote add origin "$REPOSITORY_URL"
fi
# Refresh existing checkouts after the Assura repository becomes available.
as_app git -C "$REPO" remote set-url origin "$REPOSITORY_URL"

if [[ ${1:-} == --initial ]]; then
  REVISION=${2:-}
  [[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid initial revision.' >&2; exit 1; }
  [[ -f "$ROOT/releases/$REVISION/package.json" ]] || exit 1
else
  as_app git -C "$REPO" fetch --prune origin +refs/heads/main:refs/remotes/origin/main
  REVISION=$(as_app git -C "$REPO" rev-parse refs/remotes/origin/main)
fi

PREVIOUS=
if [[ -L "$ROOT/current" ]]; then
  PREVIOUS=$(readlink -f "$ROOT/current")
  [[ "$PREVIOUS" == "$ROOT/releases/"* && -d "$PREVIOUS" ]] || { echo 'Invalid active release symlink.' >&2; exit 1; }
fi
RELEASE=$ROOT/releases/$REVISION
if [[ "$PREVIOUS" == "$RELEASE" ]] && systemctl is-active --quiet "$APP_SERVICE"; then
  echo "Already serving main at $REVISION"
  exit 0
fi

if [[ ! -f "$RELEASE/package.json" ]]; then
  install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$RELEASE"
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

activate() {
  ln -sfn -- "$1" "$ROOT/current.next"
  mv -Tf -- "$ROOT/current.next" "$ROOT/current"
}

health() {
  local allow_legacy=${1:-0}
  local attempt status page_status
  for attempt in $(seq 1 30); do
    status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
      --max-time 3 http://127.0.0.1:8787/api/health) || status=000
    if [[ "$status" == 200 ]]; then
      return 0
    fi
    # Only an older release without the new endpoint may use the basic page
    # check during rollback. A failing readiness check must never be bypassed.
    if [[ "$allow_legacy" == 1 && "$status" == 404 ]]; then
      page_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
        --max-time 3 http://127.0.0.1:8787/) || page_status=000
      if [[ "$page_status" == 200 ]]; then return 0; fi
    fi
    sleep 2
  done
  return 1
}

rollback() {
  local status=${1:-1}
  trap - ERR TERM INT
  if [[ "$STOPPED" == 1 ]]; then
    if ! systemctl stop "$APP_SERVICE"; then
      echo 'Could not stop Assura; maintenance remains enabled and database has not been restored.' >&2
      exit "$status"
    fi
    if [[ "$BACKED_UP" == 1 ]]; then
      mv "$STATE" "$BACKUP/failed-state"
      cp -a "$BACKUP/state" "$STATE"
    fi
    if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
      activate "$PREVIOUS"
      systemctl start "$APP_SERVICE"
      if health 1; then rm -f "$MAINTENANCE"; fi
    elif [[ -L "$ROOT/current" ]]; then
      rm "$ROOT/current"
    fi
  fi
  echo "Deployment failed for $REVISION; previous release retained. See journalctl -u $DEPLOY_SERVICE." >&2
  exit "$status"
}
trap 'rollback $?' ERR
trap 'rollback 143' TERM
trap 'rollback 130' INT

touch "$MAINTENANCE"
STOPPED=1
systemctl stop "$APP_SERVICE"
if systemctl is-active --quiet "$APP_SERVICE"; then
  echo 'Application still running; refusing to migrate its database.' >&2
  false
fi
cp -a "$STATE" "$BACKUP/state"
BACKED_UP=1
printf '%s\n' "$PREVIOUS" > "$BACKUP/previous-release"
as_app node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
  d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to "$STATE"
activate "$RELEASE"
systemctl start "$APP_SERVICE"
health
rm -f "$MAINTENANCE"
STOPPED=0
trap - ERR TERM INT
echo "Deployed main at $REVISION"

# Keep the active and previous release plus three recent candidates; retain seven DB backups.
ASSURA_DEPLOY_ROOT="$ROOT" ASSURA_DATA_ROOT="$DATA_ROOT" python3 "$HELPERS/prune.py"
