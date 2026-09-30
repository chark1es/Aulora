#!/usr/bin/env bash
#
# Rebuild and redeploy the Aulora stack from the current source tree.
#
# Why this exists: `docker compose run setup` reuses whatever `aulora-setup`
# image already exists, so a code change can silently deploy an old API. This
# script always rebuilds the images that embed repository source (`web` and
# `setup`) before recreating the web container and redeploying the Convex
# functions. It is idempotent and safe to run after every update.
#
# Usage:
#   ./deploy.sh                     # rebuild + recreate web + redeploy functions
#   ./deploy.sh --pull              # also refresh pinned upstream images
#   ./deploy.sh --profile backups   # enable an optional compose profile
#
set -euo pipefail

self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$(dirname "$self")"

compose=(docker compose)
pull=0
while [ $# -gt 0 ]; do
  case "$1" in
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
      sed -n '2,16p' "$self"
      exit 0
      ;;
    *)
      echo "deploy.sh: unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ "${pull}" = 1 ]; then
  echo "==> Pulling pinned upstream images"
  "${compose[@]}" pull --ignore-buildable
fi

echo "==> Rebuilding local images (web, setup, smtp-gateway)"
"${compose[@]}" build web setup smtp-gateway

echo "==> Recreating the web container"
"${compose[@]}" up -d --no-deps --force-recreate web

echo "==> Deploying Convex functions and refreshing the well-known document"
"${compose[@]}" run --rm setup
"${compose[@]}" up -d --no-deps --force-recreate smtp-gateway

version="$(sed -n 's/^export const AULORA_VERSION = "\([^"]*\)";.*/\1/p' ../../packages/convex/convex/lib/env.ts)"
[ -n "$version" ] && printf '%s\n' "$version" > .deployed-version

echo "==> Done. Open http://localhost:${WEB_PORT:-8080}"
