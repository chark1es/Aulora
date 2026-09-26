#!/usr/bin/env bash
# Aulora one-command self-host installer (macOS / Linux / WSL).
#
#   ./install.sh [options]
#
# It checks Docker, writes infra/docker/.env (reusing an existing one), builds
# and starts the Compose stack, runs first-run setup, and prints the URL. It is
# idempotent: re-running reuses .env and is a no-op for data.
#
# Options (or the matching AULORA_* environment variable):
#   --name <name>        workspace name            (AULORA_WORKSPACE_NAME)
#   --instance <name>    instance/database name    (AULORA_INSTANCE_NAME)
#   --email <email>      owner email               (AULORA_OWNER_EMAIL)
#   --password <pw>      owner password, 16+ chars (AULORA_OWNER_PASSWORD)
#   --port <port>        host web port, default 8080 (AULORA_WEB_PORT)
#   --site-url <url>     public origin             (AULORA_SITE_URL)
#   --backups            also start the nightly backup runner
#   --no-start           write .env and stop before docker compose
#   --dry-run            print the plan; change nothing
#   -h, --help           show this help

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$ROOT/infra/docker"
ENV_FILE="${AULORA_ENV_FILE:-$DOCKER_DIR/.env}"
ENV_EXAMPLE="$DOCKER_DIR/.env.example"

log() { printf '[install] %s\n' "$*"; }
die() { printf '[install] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

WORKSPACE_NAME="${AULORA_WORKSPACE_NAME:-}"
INSTANCE_NAME="${AULORA_INSTANCE_NAME:-}"
OWNER_EMAIL="${AULORA_OWNER_EMAIL:-}"
OWNER_PASSWORD="${AULORA_OWNER_PASSWORD:-}"
WEB_PORT="${AULORA_WEB_PORT:-8080}"
SITE_URL="${AULORA_SITE_URL:-}"
OWNER_NAME="${AULORA_OWNER_NAME:-}"
WITH_BACKUPS=0
NO_START=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) WORKSPACE_NAME="${2:-}"; shift 2 ;;
    --instance) INSTANCE_NAME="${2:-}"; shift 2 ;;
    --email) OWNER_EMAIL="${2:-}"; shift 2 ;;
    --password) OWNER_PASSWORD="${2:-}"; shift 2 ;;
    --port) WEB_PORT="${2:-}"; shift 2 ;;
    --site-url) SITE_URL="${2:-}"; shift 2 ;;
    --backups) WITH_BACKUPS=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# --- pure helpers -----------------------------------------------------------

lower_slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//'
}

env_set() {
  local key="$1" value="$2" file="$3"
  KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"] }
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" k "=" { print k "=" v; next }
    { print }
  ' "$file" > "${file}.tmp"
  mv "${file}.tmp" "$file"
}

# --- validate inputs (before touching anything) -----------------------------

command -v docker >/dev/null 2>&1 || die "Docker is not installed or not on PATH"
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 is required (docker compose)"
fi

[ -f "$ENV_EXAMPLE" ] || die "missing $ENV_EXAMPLE"

if [ -f "$ENV_FILE" ]; then
  log "using the existing $ENV_FILE (idempotent re-run)"
else
  [ -n "$WORKSPACE_NAME" ] || WORKSPACE_NAME="Aulora"
  if [ -z "$INSTANCE_NAME" ]; then
    INSTANCE_NAME="$(lower_slug "$WORKSPACE_NAME")"
    [ -n "$INSTANCE_NAME" ] || INSTANCE_NAME="aulora"
  fi
  if [ -z "$OWNER_EMAIL" ] && [ -t 0 ]; then
    read -r -p "Owner email: " OWNER_EMAIL
  fi
  [ -n "$OWNER_EMAIL" ] || die "set --email (or AULORA_OWNER_EMAIL) for the owner account"
  if [ -z "$OWNER_PASSWORD" ] && [ -t 0 ]; then
    read -r -s -p "Owner password (16+ chars): " OWNER_PASSWORD
    printf '\n'
  fi
  [ -n "$OWNER_PASSWORD" ] || die "set --password (or AULORA_OWNER_PASSWORD)"
  [ "${#OWNER_PASSWORD}" -ge 16 ] || die "owner password must be at least 16 characters"
fi

if [ -z "$SITE_URL" ]; then
  SITE_URL="http://localhost:${WEB_PORT}"
fi
if [ -z "$OWNER_NAME" ]; then
  OWNER_NAME="$WORKSPACE_NAME"
fi

# --- plan -------------------------------------------------------------------

write_env() {
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  env_set INSTANCE_NAME "$INSTANCE_NAME" "$ENV_FILE"
  env_set WORKSPACE_NAME "$WORKSPACE_NAME" "$ENV_FILE"
  env_set OWNER_EMAIL "$OWNER_EMAIL" "$ENV_FILE"
  env_set OWNER_PASSWORD "$OWNER_PASSWORD" "$ENV_FILE"
  env_set OWNER_NAME "$OWNER_NAME" "$ENV_FILE"
  env_set SITE_URL "$SITE_URL" "$ENV_FILE"
  env_set WEB_PORT "$WEB_PORT" "$ENV_FILE"
}

compose() { ( cd "$DOCKER_DIR" && docker compose --env-file "$ENV_FILE" "$@" ); }

if [ "$DRY_RUN" = "1" ]; then
  if [ -f "$ENV_FILE" ]; then
    log "DRY RUN: would reuse $ENV_FILE"
  else
    log "DRY RUN: would write $ENV_FILE (workspace=${WORKSPACE_NAME}, instance=${INSTANCE_NAME}, site=${SITE_URL}, port=${WEB_PORT})"
  fi
  log "DRY RUN: docker compose up -d --build"
  log "DRY RUN: docker compose run --rm setup"
  if [ "$WITH_BACKUPS" = "1" ]; then
    log "DRY RUN: docker compose --profile backups up -d --build"
  fi
  log "DRY RUN: done; no changes made"
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  write_env
  log "wrote $ENV_FILE"
fi

if [ "$NO_START" = "1" ]; then
  log "config ready; skipping docker compose (--no-start)"
  exit 0
fi

log "building and starting the stack (this can take a few minutes)…"
compose up -d --build

log "running first-run setup (idempotent)…"
compose run --rm setup

if [ "$WITH_BACKUPS" = "1" ]; then
  log "starting the nightly backup runner…"
  compose --profile backups up -d --build
fi

log "ready. Open ${SITE_URL} and sign in as ${OWNER_EMAIL}."
log "Logs: (cd infra/docker && docker compose logs -f setup)"
