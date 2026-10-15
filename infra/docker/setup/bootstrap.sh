#!/usr/bin/env bash
set -euo pipefail

# Compose starts this short bootstrap as root to prepare existing Docker
# volumes. Deployment and initialization run without root or capabilities.
if [ "$(id -u)" = 0 ]; then
  discovery_directory="${WELL_KNOWN_DIR:-/web-well-known}"
  state_file="${HOST_ENV_FILE:-/host/.env}"
  state_directory="$(dirname "$state_file")"

  prepare_directory() {
    local directory="$1"
    [ -w "$directory" ] || {
      printf '[setup] ERROR: cannot write %s; check setup volume permissions\n' "$directory" >&2
      exit 1
    }
    chown aulora:aulora "$directory"
  }

  mkdir -p "$discovery_directory"
  prepare_directory "$discovery_directory"
  if [ -f "$discovery_directory/aulora.json" ]; then
    chown aulora:aulora "$discovery_directory/aulora.json"
  fi
  if [ -d "$state_directory" ]; then
    prepare_directory "$state_directory"
    if [ -f "$state_file" ]; then
      chown aulora:aulora "$state_file"
      chmod 600 "$state_file"
    fi
  fi

  # `livekit-init` writes the streaming key pair as a root-only 0600 file,
  # because the LiveKit server refuses a key file other users can read. Setup
  # then runs without root, so read the pair here while we still can and hand it
  # down through the environment; otherwise the unprivileged stage cannot open
  # it and setup aborts before it hands the credentials to Convex.
  livekit_keys_file="${LIVEKIT_KEYS_FILE:-/livekit-keys/keys}"
  if [ -s "$livekit_keys_file" ] && [ -z "${LIVEKIT_API_KEY:-}${LIVEKIT_API_SECRET:-}" ]; then
    LIVEKIT_API_KEY="$(sed -n '1s/:.*//p' "$livekit_keys_file")"
    LIVEKIT_API_SECRET="$(sed -n '1s/^[^:]*:[[:space:]]*//p' "$livekit_keys_file" | tr -d '"[:space:]')"
    [ -n "$LIVEKIT_API_KEY" ] && [ -n "$LIVEKIT_API_SECRET" ] || {
      printf '[setup] ERROR: the streaming key pair in %s is unreadable\n' "$livekit_keys_file" >&2
      exit 1
    }
    export LIVEKIT_API_KEY LIVEKIT_API_SECRET
  fi

  exec setpriv --reuid=aulora --regid=aulora --init-groups \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs "$@"
fi

exec "$@"
