#!/usr/bin/env bash
# Aulora nightly backup runner.
#
# Long-running service (compose profile `backups`). It:
#   1. waits for the Convex backend and resolves the instance name/secret
#   2. ensures a `BACKUP_TOKEN` deployment secret exists (generating one, and
#      persisting it to infra/docker/.env, when absent)
#   3. mints the admin key with the backend's own /convex/generate_key
#   4. sleeps until BACKUP_HOUR_UTC (default 03:00) every day and runs backup.sh
#
# Backups include encrypted content and sensitive metadata/configuration. The
# original key is required for recovery. Set BACKUP_RUN_ONCE=1 to run a
# single backup and exit. Set BACKUP_ENABLED=false to idle. Secrets are never
# printed.

set -euo pipefail

SETUP_DIR="${SETUP_DIR:-/app/setup}"
BACKUP_PLAN="${BACKUP_PLAN:-/app/backup/backup-plan.mjs}"
export BACKUP_PLAN

CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://convex-backend:3210}"
CONVEX_PROJECT_DIR="${CONVEX_PROJECT_DIR:-/app/packages/convex}"
HOST_ENV_FILE="${HOST_ENV_FILE:-/host/.env}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-3}"
BACKUP_ENABLED="${BACKUP_ENABLED:-true}"

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

env_get() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?${key}=//p" "$file" | tail -n 1
}

env_set() {
  local key="$1" value="$2" file="$3"
  [ -f "$file" ] || return 0
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file"; then
    KEY="$key" VALUE="$value" awk '
      BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"] }
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" k "=" { print k "=" v; next }
      { print }
    ' "$file" > "${file}.tmp"
    mv "${file}.tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

convex() { ( cd "$CONVEX_PROJECT_DIR" && bunx convex "$@" ); }

wait_for_backend() {
  log "waiting for Convex backend at ${CONVEX_SELF_HOSTED_URL}"
  for _ in $(seq 1 60); do
    if node "$SETUP_DIR/backend-version.mjs" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "Convex backend did not become reachable"
}

wait_for_backend

INSTANCE_NAME_RESOLVED="$(node "$SETUP_DIR/resolve-instance.mjs" name)"
INSTANCE_SECRET_RESOLVED="$(node "$SETUP_DIR/resolve-instance.mjs" secret)"
[ -n "$INSTANCE_SECRET_RESOLVED" ] || die "could not resolve INSTANCE_SECRET"
export INSTANCE_NAME="$INSTANCE_NAME_RESOLVED"

ADMIN_KEY="$(/usr/local/bin/generate_key "$INSTANCE_NAME_RESOLVED" "$INSTANCE_SECRET_RESOLVED" 2>/dev/null | tr -d '\r' | tail -n 1)"
case "$ADMIN_KEY" in
  *"|"*) : ;;
  *) die "generate_key did not produce an instance|key pair" ;;
esac
export CONVEX_SELF_HOSTED_URL
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"

# --- BACKUP_TOKEN: the shared secret the runner uses to record results -------
BACKUP_TOKEN_VALUE="${BACKUP_TOKEN:-}"
if [ -z "$BACKUP_TOKEN_VALUE" ]; then
  BACKUP_TOKEN_VALUE="$(openssl rand -hex 24)"
  log "generated a BACKUP_TOKEN"
fi
export BACKUP_TOKEN="$BACKUP_TOKEN_VALUE"
convex env set BACKUP_TOKEN "$BACKUP_TOKEN_VALUE" >/dev/null
if [ -f "$HOST_ENV_FILE" ]; then
  env_set BACKUP_TOKEN "$BACKUP_TOKEN_VALUE" "$HOST_ENV_FILE"
  log "persisted BACKUP_TOKEN to ${HOST_ENV_FILE}"
fi

mkdir -p "$BACKUP_DIR"

# The runner exports stored content without decrypting it
# while it runs. Provider/keyId/version are non-secret and stay for the manifest.
unset AULORA_ENCRYPTION_KEY AULORA_KEK_WRAPPED VAULT_TOKEN EKM_PROXY_TOKEN

run_backup() {
  if ! /app/backup/backup.sh "$1"; then
    log "backup run reported failure (recorded in Convex)"
  fi
}

if [ "${BACKUP_RUN_ONCE:-0}" = "1" ]; then
  run_backup manual
  exit 0
fi

if [ "$BACKUP_ENABLED" != "true" ]; then
  log "backups disabled (BACKUP_ENABLED != true); idling"
  exec sleep infinity
fi

log "backup runner ready; hour=${BACKUP_HOUR_UTC}:00 UTC, bucket=${BACKUP_BUCKET:-aulora-backups}"
while :; do
  DELAY="$(node "$BACKUP_PLAN" delay "$BACKUP_HOUR_UTC")"
  log "next backup in ${DELAY}s"
  sleep "$DELAY"
  run_backup cron
done
