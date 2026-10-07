#!/usr/bin/env bash
set -euo pipefail

setup_image="${1:-aulora-setup:local}"

# Run against a built setup image. Fresh named volumes have root-owned 0755
# directories, which these tmpfs mounts reproduce without retaining test data.
docker run --rm --entrypoint /bin/bash \
  --mount type=tmpfs,destination=/web-well-known,tmpfs-mode=0755 \
  --mount type=tmpfs,destination=/host,tmpfs-mode=0755 \
  "$setup_image" -c '
    set -euo pipefail
    node /app/setup/well-known.mjs > /web-well-known/aulora.json
    umask 077
    printf "INSTANCE_NAME=volume-test\n" > /host/.env
    printf "INSTANCE_NAME=updated-test\n" > /host/.env.tmp
    mv /host/.env.tmp /host/.env
    test "$(stat -c %a /host/.env)" = 600
    test -s /web-well-known/aulora.json
    printf "Discovery and setup state are writable; secret state mode is 600.\n"
  '

# Read-only output mounts must fail before setup contacts or changes a backend.
test_directory="$(mktemp -d)"
trap 'rmdir "$test_directory"' EXIT
for output_directory in /web-well-known /host; do
  if setup_output="$(docker run --rm --entrypoint /usr/bin/timeout \
    --mount "type=bind,source=$test_directory,destination=$output_directory,readonly" \
    "$setup_image" 5 /app/setup/entrypoint.sh 2>&1)"; then
    printf 'Setup unexpectedly accepted read-only %s.\n' "$output_directory" >&2
    exit 1
  fi
  if [[ "$setup_output" != *"cannot write ${output_directory};"* ]]; then
    printf 'Setup did not reject read-only %s before backend access.\n' "$output_directory" >&2
    exit 1
  fi
done
printf 'Read-only mounts are rejected before backend access.\n'
