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

  exec setpriv --reuid=aulora --regid=aulora --init-groups \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs "$@"
fi

exec "$@"
