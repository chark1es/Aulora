#!/usr/bin/env bash
#
# Rebuild and redeploy the Aulora stack from the current source tree.
#
# Why this exists: `docker compose run setup` reuses whatever `aulora-setup`
# image already exists, so a code change can silently deploy an old API. This
# script always rebuilds the images that embed repository source (`web`,
# `setup`, `smtp-gateway` and `bot-runner`), deploys the backend first, and
# only then recreates the web container. It is idempotent and safe to run after
# every update. The bot runner is recreated after `setup` so it picks up a
# newly generated BOT_RUNNER_TOKEN from `.env`.
#
# Usage:
#   ./deploy.sh                     # rebuild + redeploy backend, then web
#   ./deploy.sh --pull              # also refresh pinned upstream images
#   ./deploy.sh --profile backups   # enable an optional compose profile
#   ./deploy.sh --rollback          # restore the web image pinned by the last deploy
#
set -euo pipefail

self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$self")"

compose=(docker compose)
pull=0
rollback=0
while [ $# -gt 0 ]; do
  case "$1" in
    --rollback)
      rollback=1
      ;;
    --pull)
      pull=1
      ;;
    --profile)
      shift
      [ $# -gt 0 ] || { echo "deploy.sh: --profile needs a name" >&2; exit 2; }
      compose+=(--profile "$1")
      ;;
    --profile=*)
      compose+=(--profile "${1#*=}")
      ;;
    -h | --help)
      sed -n '2,18p' "$self"
      exit 0
      ;;
    *)
      echo "deploy.sh: unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ "${rollback}" = 1 ]; then
  command -v bun >/dev/null 2>&1 || {
    echo "deploy.sh: rollback needs bun (the host updater already requires it)" >&2
    exit 2
  }
  exec bun update/rollback.mjs rollback
fi

# Rollback only restores a pinned image; the checks below need Compose 2.24+
# (`config --images`, `up --wait`).
# A missing plugin (or docker itself) fails the probe; say so instead of letting
# `set -e` end the script on a raw docker error.
compose_version="$(docker compose version --short 2>/dev/null || true)"
if [ -z "$compose_version" ]; then
  echo "deploy.sh: Docker Compose >= 2.24 is required (the 'docker compose' plugin was not found). Install or upgrade the Compose plugin." >&2
  exit 2
fi
if ! [[ "$compose_version" =~ ^v?([0-9]+)\.([0-9]+) ]] ||
  (( BASH_REMATCH[1] < 2 || (BASH_REMATCH[1] == 2 && BASH_REMATCH[2] < 24) )); then
  echo "deploy.sh: Docker Compose >= 2.24 is required (found $compose_version). Upgrade the Compose plugin." >&2
  exit 2
fi

if [ "${pull}" = 1 ]; then
  echo "==> Pulling pinned upstream images"
  "${compose[@]}" pull --ignore-buildable
fi

# Keep the build that is currently serving web traffic so `--rollback` can
# restore it. Best effort: a first install has no image, and a missing bun must
# not block a plain deployment.
echo "==> Pinning the current web image for rollback"
if command -v bun >/dev/null 2>&1; then
  bun update/rollback.mjs pin || echo "warning: could not pin the previous web image" >&2
else
  echo "warning: bun not found; web rollback marker was not updated" >&2
fi

echo "==> Rebuilding local images (web, setup, smtp-gateway, bot-runner)"
"${compose[@]}" build web setup smtp-gateway bot-runner

# Compare immutable engine image IDs before setup; matching engines are kept.
echo "==> Checking the Convex engine image"
engine_image="$("${compose[@]}" config --images convex-backend)"
if [ -z "$engine_image" ] || [[ "$engine_image" == *$'\n'* ]]; then
  echo "deploy.sh: Expected one engine image for convex-backend, got: ${engine_image:-none}" >&2
  exit 1
fi
if ! engine_target="$(docker image inspect --format '{{.Id}}' "$engine_image")"; then
  "${compose[@]}" pull convex-backend
  engine_target="$(docker image inspect --format '{{.Id}}' "$engine_image")"
fi
engine_container="$("${compose[@]}" ps -a -q convex-backend)"
engine_running=""
if [ -n "$engine_container" ]; then
  engine_running="$(docker inspect --format '{{.Image}}' "$engine_container")"
fi
if [ -z "$engine_container" ]; then
  # A fresh deployment also needs Postgres/object-storage dependencies started.
  # `--wait` already gates on the engine healthcheck, so no second wait is needed.
  "${compose[@]}" up -d --no-build --wait --wait-timeout 120 convex-backend
else
  if [ "$engine_running" != "$engine_target" ]; then
    "${compose[@]}" up -d --no-deps --no-build --force-recreate convex-backend
  fi
  "${compose[@]}" up -d --no-deps --no-build --no-recreate --wait --wait-timeout 120 convex-backend
fi

# Backend first. The release's schema and functions must accept both the old
# and new frontend, so an old web bundle keeps working during this window and
# a failed setup leaves the previously serving frontend in place.
echo "==> Deploying Convex functions and refreshing the well-known document"
"${compose[@]}" run --rm setup

echo "==> Recreating the web container after the backend is current"
"${compose[@]}" up -d --no-deps --force-recreate web

"${compose[@]}" up -d --no-deps --force-recreate smtp-gateway

# `setup` may have just generated BOT_RUNNER_TOKEN. Recreate the runner so it
# reads the current `.env` value; without a token it idles instead of exiting.
echo "==> Starting the bot runner"
"${compose[@]}" up -d --no-deps --force-recreate bot-runner

# Never advertise a completed deployment until both healthchecks pass.
"${compose[@]}" up -d --no-deps --no-build --no-recreate --wait --wait-timeout 120 convex-backend web

version="$(sed -n 's/^export const AULORA_VERSION = "\([^"]*\)";.*/\1/p' ../../packages/convex/convex/lib/env.ts)"
[ -n "$version" ] && printf '%s\n' "$version" > .deployed-version

echo "==> Done. Open http://localhost:${WEB_PORT:-8080}"
