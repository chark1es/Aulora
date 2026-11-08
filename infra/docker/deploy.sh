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

version="$(sed -n 's/^export const AULORA_VERSION = "\([^"]*\)";.*/\1/p' ../../packages/convex/convex/lib/env.ts)"
[ -n "$version" ] && printf '%s\n' "$version" > .deployed-version

echo "==> Done. Open http://localhost:${WEB_PORT:-8080}"
