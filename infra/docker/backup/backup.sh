#!/usr/bin/env bash
# One Aulora backup run: Postgres dump + Convex export, uploaded to S3, with a
# result recorded back in Convex (`backups:record`).
#
# The caller (entrypoint.sh) has already exported CONVEX_SELF_HOSTED_URL,
# CONVEX_SELF_HOSTED_ADMIN_KEY and BACKUP_TOKEN. Usage:
#
#   backup.sh [cron|manual]
#
# Exit code is 0 on success and 1 on failure; a failure is also recorded so the
# admin panel shows it. Nothing here prints secret values.

set -uo pipefail

TRIGGER="${1:-cron}"

INSTANCE_NAME="${INSTANCE_NAME:-aulora}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
BACKUP_BUCKET="${BACKUP_BUCKET:-aulora-backups}"
BACKUP_RETENTION="${BACKUP_RETENTION:-7}"
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-convex}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
CONVEX_PROJECT_DIR="${CONVEX_PROJECT_DIR:-/app/packages/convex}"
BACKUP_PLAN="${BACKUP_PLAN:-/app/backup/backup-plan.mjs}"

log() { printf '[backup] %s\n' "$*"; }

TS="$(node "$BACKUP_PLAN" timestamp)"
DB="$(node "$BACKUP_PLAN" db "$INSTANCE_NAME")"
RUN_DIR="$BACKUP_DIR/$TS"
LOCATION="$(node "$BACKUP_PLAN" prefix "$TS")"
STARTED="$(date +%s)000"
SIZE_BYTES=""
STATUS="failed"
MESSAGE=""

mkdir -p "$RUN_DIR"

convex() { ( cd "$CONVEX_PROJECT_DIR" && bunx convex "$@" ); }

record() {
  local json
  json="$(
    TOKEN="${BACKUP_TOKEN:-}" \
    STATUS="$STATUS" \
    STARTED="$STARTED" \
    FINISHED="$(date +%s)000" \
    SIZE="$SIZE_BYTES" \
    LOCATION="$LOCATION" \
    MESSAGE="$MESSAGE" \
    TRIGGER="$TRIGGER" \
    node "$BACKUP_PLAN" record
  )"
  # Recording is best-effort: a missing token or deployment is logged, not fatal.
  if ! convex run backups:record "$json" >/dev/null 2>&1; then
    log "could not record backup result"
  fi
}

fail() {
  STATUS="failed"
  MESSAGE="$1"
  log "FAILED: $1"
  record
  exit 1
}

log "starting ${TRIGGER} backup ${TS} (database ${DB})"

# 1. Postgres logical dump (custom format, restorable with pg_restore).
if ! PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" \
  --format=custom --file "$RUN_DIR/postgres.dump" "$DB"; then
  fail "pg_dump failed"
fi

# 2. Convex logical export (also covers S3-backed file storage).
if ! convex export --path "$RUN_DIR/convex.zip" >/dev/null 2>&1; then
  fail "convex export failed"
fi

SIZE_BYTES="$(du -sb "$RUN_DIR" 2>/dev/null | cut -f1)"
SIZE_BYTES="${SIZE_BYTES:-0}"

# 3. Upload both artifacts to S3/MinIO.
if [ "${BACKUP_SKIP_UPLOAD:-0}" != "1" ]; then
  if [ -z "${S3_ENDPOINT_URL:-}" ] || [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
    fail "no S3 endpoint or credentials configured"
  fi
  if ! mc alias set aulora "$S3_ENDPOINT_URL" "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" >/dev/null 2>&1; then
    fail "could not reach the S3 endpoint"
  fi
  mc mb --ignore-existing "aulora/$BACKUP_BUCKET" >/dev/null 2>&1 || true
  if ! mc cp "$RUN_DIR/postgres.dump" "aulora/$BACKUP_BUCKET/$LOCATION/postgres.dump" >/dev/null 2>&1; then
    fail "uploading the Postgres dump failed"
  fi
  if ! mc cp "$RUN_DIR/convex.zip" "aulora/$BACKUP_BUCKET/$LOCATION/convex.zip" >/dev/null 2>&1; then
    fail "uploading the Convex export failed"
  fi
fi

# 4. Prune old local run directories (the S3 copies are the durable backups).
if [ "${BACKUP_KEEP_LOCAL:-1}" = "1" ]; then
  node "$BACKUP_PLAN" prune "$BACKUP_DIR" "$BACKUP_RETENTION" >/dev/null 2>&1 || true
fi

STATUS="succeeded"
MESSAGE="postgres dump + convex export uploaded"
record
log "backup ${TS} complete (${SIZE_BYTES} bytes)"
