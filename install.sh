#!/usr/bin/env bash
# Aulora one-command self-host installer (macOS / Linux / WSL).
#
#   ./install.sh [options]
#
# Run it from a checkout of a release tag (vX.Y.Z). On any other ref with a
# clean tree it first checks out the newest published release and re-runs
# itself. It checks Docker, writes infra/docker/.env (reusing an existing one),
# pulls the release images from ghcr.io (a development checkout builds them
# instead), starts the Compose stack, runs first-run setup, and prints the URL.
# It is idempotent: re-running reuses .env and is a no-op for data.
#
# Options (or the matching AULORA_* environment variable):
#   --name <name>        workspace name            (AULORA_WORKSPACE_NAME)
#   --instance <name>    instance/database name    (AULORA_INSTANCE_NAME)
#   --email <email>      owner email               (AULORA_OWNER_EMAIL)
#   --password <pw>      owner password, 16+ chars (AULORA_OWNER_PASSWORD)
#   --port <port>        host web port, default 8080 (AULORA_WEB_PORT)
#   --site-url <url>     public origin             (AULORA_SITE_URL)
#   --backups            also start the nightly backup runner
#   --auto-update        allow infra/docker/update.sh to apply releases
#   --no-start           write .env and stop before docker compose
#   --dry-run            print the plan; change nothing
#   --allow-any-branch   install this checkout as is, even if it is not a release
#                        tag; builds images locally (AULORA_ALLOW_ANY_BRANCH)
#   -h, --help           show this help

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$ROOT/infra/docker"
ENV_FILE="${AULORA_ENV_FILE:-$DOCKER_DIR/.env}"
ENV_EXAMPLE="$DOCKER_DIR/.env.example"

log() { printf '[install] %s\n' "$*"; }
die() { printf '[install] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

WORKSPACE_NAME="${AULORA_WORKSPACE_NAME:-}"
INSTANCE_NAME="${AULORA_INSTANCE_NAME:-}"
OWNER_EMAIL="${AULORA_OWNER_EMAIL:-}"
OWNER_PASSWORD="${AULORA_OWNER_PASSWORD:-}"
WEB_PORT="${AULORA_WEB_PORT:-8080}"
SITE_URL="${AULORA_SITE_URL:-}"
OWNER_NAME="${AULORA_OWNER_NAME:-}"
WITH_BACKUPS=0
AUTO_UPDATE=0
NO_START=0
DRY_RUN=0
ALLOW_ANY_BRANCH="${AULORA_ALLOW_ANY_BRANCH:-0}"
ORIGINAL_ARGS=("$@")

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name) WORKSPACE_NAME="${2:-}"; shift 2 ;;
    --instance) INSTANCE_NAME="${2:-}"; shift 2 ;;
    --email) OWNER_EMAIL="${2:-}"; shift 2 ;;
    --password) OWNER_PASSWORD="${2:-}"; shift 2 ;;
    --port) WEB_PORT="${2:-}"; shift 2 ;;
    --site-url) SITE_URL="${2:-}"; shift 2 ;;
    --backups) WITH_BACKUPS=1; shift ;;
    --auto-update) AUTO_UPDATE=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --allow-any-branch) ALLOW_ANY_BRANCH=1; shift ;;
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

env_get() {
  local value
  value="$(awk -v key="$1" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "=" {
      sub(/^[^=]*=/, ""); value = $0
    }
    END { gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value }
  ' "$2")"
  case "$value" in
    \"*\"|\'*\') value="${value:1:${#value}-2}" ;;
  esac
  printf '%s' "$value"
}

# --- release checkout -------------------------------------------------------

# Installs come from a GitHub release: a checkout whose HEAD is exactly a stable
# vX.Y.Z tag. On any other ref the installer moves a clean checkout to the newest
# stable tag (detached) and runs itself again from there. A dirty tree, a failed
# fetch, or --allow-any-branch leaves the checkout alone.
STABLE_TAG_RE='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

head_stable_tag() {
  git -C "$ROOT" tag --points-at HEAD 2>/dev/null | grep -E "$STABLE_TAG_RE" | sort -V | tail -n 1 || true
}

ensure_release_checkout() {
  case "$ALLOW_ANY_BRANCH" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
  esac
  command -v git >/dev/null 2>&1 || return 0
  git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if [ -n "$(head_stable_tag)" ]; then
    return 0
  fi
  local ref latest
  ref="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  ref="${ref:-HEAD}"
  if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
    printf '[install] WARNING: this checkout is on "%s" with local changes, so it cannot switch to a release.\n' "$ref" >&2
    printf '[install]          Commit or discard them, or clone a release: git clone https://github.com/chark1es/Aulora.git\n' >&2
    printf '[install]          Use --allow-any-branch (or AULORA_ALLOW_ANY_BRANCH=1) to install this checkout as is; images are built locally.\n' >&2
    return 0
  fi
  if ! GIT_TERMINAL_PROMPT=0 git -C "$ROOT" fetch --tags --force --quiet origin >/dev/null 2>&1; then
    printf '[install] WARNING: could not fetch release tags from origin; installing "%s" as is (images are built locally).\n' "$ref" >&2
    return 0
  fi
  latest="$(git -C "$ROOT" tag --list 'v*' 2>/dev/null | grep -E "$STABLE_TAG_RE" | sort -V | tail -n 1 || true)"
  if [ -z "$latest" ]; then
    printf '[install] WARNING: no stable release tag found; installing "%s" as is (images are built locally).\n' "$ref" >&2
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY RUN: would check out release $latest (currently on \"$ref\") and re-run the installer"
    return 0
  fi
  [ -z "${AULORA_INSTALL_REEXEC:-}" ] || die "still not on a release tag after checkout"
  log "checking out release $latest (was on \"$ref\")"
  git -C "$ROOT" -c advice.detachedHead=false checkout --quiet --detach "refs/tags/$latest" ||
    die "could not check out $latest"
  # The checkout replaced this script; run the release's installer instead.
  AULORA_INSTALL_REEXEC=1 exec bash "$ROOT/install.sh" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
}

# Release images exist only for the release this checkout is exactly at.
# Anything else builds locally (AULORA_IMAGE_TAG=local) so it never runs a stale one.
at_release_tag() {
  local version
  version="$(sed -n 's/^export const AULORA_VERSION = "\([^"]*\)";.*/\1/p' "$ROOT/packages/convex/convex/lib/env.ts" 2>/dev/null || true)"
  [ -n "$version" ] || return 1
  command -v git >/dev/null 2>&1 || return 1
  git -C "$ROOT" describe --tags --exact-match --match "v${version}" HEAD >/dev/null 2>&1
}

# --- validate inputs (before touching anything) -----------------------------

ensure_release_checkout

command -v docker >/dev/null 2>&1 || die "Docker is not installed or not on PATH"
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 is required (docker compose)"
fi
compose_version="$(docker compose version --short 2>/dev/null || true)"
if ! [[ "$compose_version" =~ ^v?([0-9]+)\.([0-9]+) ]] ||
  (( BASH_REMATCH[1] < 2 || (BASH_REMATCH[1] == 2 && BASH_REMATCH[2] < 24) )); then
  die "Docker Compose 2.24 or newer is required (found ${compose_version:-unknown}). Upgrade the Compose plugin."
fi
docker compose wait --help >/dev/null 2>&1 || die "update Docker Compose: the installer requires the wait command"

[ -f "$ENV_EXAMPLE" ] || die "missing $ENV_EXAMPLE"

if [ -f "$ENV_FILE" ]; then
  log "using the existing $ENV_FILE (idempotent re-run)"
  SITE_URL="$(env_get SITE_URL "$ENV_FILE")"
  WEB_PORT="$(env_get WEB_PORT "$ENV_FILE")"
  WEB_PORT="${WEB_PORT:-8080}"
  OWNER_EMAIL="$(env_get OWNER_EMAIL "$ENV_FILE")"
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

# URL-safe random token. Reads /dev/urandom directly so the host needs no openssl.
random_token() {
  head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'
}

write_env() {
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  # Generate the bot runner token now so Compose has it when it first creates the
  # runner; `setup` keeps an existing value instead of generating its own.
  env_set BOT_RUNNER_TOKEN "$(random_token)" "$ENV_FILE"
  # Optional transcription engine; Compose needs the token at first start.
  env_set TRANSCRIBER_TOKEN "$(random_token)" "$ENV_FILE"
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
  if at_release_tag; then
    log "DRY RUN: docker compose pull (release images from ghcr.io)"
    log "DRY RUN: docker compose up -d --no-build"
  else
    log "DRY RUN: docker compose up -d --build (local images; this checkout is not a release tag)"
  fi
  log "DRY RUN: docker compose wait setup"
  if [ "$WITH_BACKUPS" = "1" ]; then
    log "DRY RUN: docker compose --profile backups up -d"
  fi
  if [ "$AUTO_UPDATE" = "1" ]; then
    log "DRY RUN: would set AULORA_AUTO_UPDATE=true"
  fi
  log "DRY RUN: done; no changes made"
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  write_env
  log "wrote $ENV_FILE"
fi

if [ "$AUTO_UPDATE" = "1" ]; then
  if grep -qE '^[[:space:]]*(export[[:space:]]+)?AULORA_AUTO_UPDATE=' "$ENV_FILE"; then
    env_set AULORA_AUTO_UPDATE true "$ENV_FILE"
  else
    printf 'AULORA_AUTO_UPDATE=true\n' >> "$ENV_FILE"
  fi
  log "auto-update enabled in $ENV_FILE"
fi

if [ "$NO_START" = "1" ]; then
  log "config ready; skipping docker compose (--no-start)"
  exit 0
fi

# A release checkout pulls the published images. Anything else (or a failed
# pull) builds from source, tagged `local` so it never reuses a release image.
BUILD_FLAG=(--no-build)
if at_release_tag; then
  log "pulling the release images (this can take a few minutes)…"
  if ! compose pull web setup smtp-gateway bot-runner transcriber; then
    log "WARNING: could not pull the published images; building locally instead"
    export AULORA_IMAGE_TAG=local
    BUILD_FLAG=(--build)
  fi
else
  export AULORA_IMAGE_TAG=local
  BUILD_FLAG=(--build)
fi
log "starting the stack…"
compose up -d "${BUILD_FLAG[@]}"

log "waiting for first-run setup (idempotent)…"
if ! compose wait setup; then
  compose logs --tail=100 setup
  die "setup failed; inspect the setup logs above"
fi

# A fresh install already has BOT_RUNNER_TOKEN in the env file. An older env file
# may not, and `setup` writes one then, but Compose resolved the token when the
# stack was created. Recreate the runner so it reads the current value; it idles
# safely if no token exists or BOT_RUNNER_ENABLED=false.
log "starting the bot runner…"
compose up -d --no-deps --force-recreate bot-runner

# Setup may have generated the shared token after Compose resolved the env file.
log "starting the transcriber (models download only on request)…"
compose up -d --no-deps --force-recreate transcriber

if [ "$WITH_BACKUPS" = "1" ]; then
  log "starting the nightly backup runner…"
  if [ "${BUILD_FLAG[0]}" = "--no-build" ]; then
    compose --profile backups pull backup
  fi
  compose --profile backups up -d "${BUILD_FLAG[@]}"
fi

log "enable update controls in settings with: infra/docker/update.sh --watch"

log "ready. Open ${SITE_URL} and sign in as ${OWNER_EMAIL}."
log "Logs: (cd infra/docker && docker compose logs -f setup)"
