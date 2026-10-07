#!/usr/bin/env bash
set -euo pipefail

setup_image="${1:-aulora-setup:local}"

# Run against a built setup image. Fresh named volumes have root-owned 0755
# directories, which these tmpfs mounts reproduce without retaining test data.
test "$(docker image inspect --format '{{.Config.User}}' "$setup_image")" = aulora
worker_check="$(cat <<'CHECK'
set -euo pipefail
test "$(id -u)" = 10001
test "$(awk '/^CapEff:/ { print $2 }' /proc/self/status)" = 0000000000000000
test "$(awk '/^CapBnd:/ { print $2 }' /proc/self/status)" = 0000000000000000
test "$(awk '/^NoNewPrivs:/ { print $2 }' /proc/self/status)" = 1
node /app/setup/well-known.mjs > /web-well-known/aulora.json
umask 077
printf "INSTANCE_NAME=volume-test\n" > /host/.env
printf "INSTANCE_NAME=updated-test\n" > /host/.env.tmp
mv /host/.env.tmp /host/.env
test "$(stat -c %a /host/.env)" = 600
test -s /web-well-known/aulora.json
printf "Setup runs as aulora without capabilities; output mounts are writable and secret state mode is 600.\n"
CHECK
)"
docker run --rm --user 0:0 \
  --mount type=tmpfs,destination=/web-well-known,tmpfs-mode=0755 \
  --mount type=tmpfs,destination=/host,tmpfs-mode=0755 \
  "$setup_image" /bin/bash -c "$worker_check"

# Legacy root-owned files, including private .env state, must also be writable
# by the worker after bootstrapping an existing deployment.
docker run --rm --user 0:0 --entrypoint /bin/bash \
  --mount type=tmpfs,destination=/web-well-known,tmpfs-mode=0755 \
  --mount type=tmpfs,destination=/host,tmpfs-mode=0755 \
  "$setup_image" -c '
    set -euo pipefail
    printf "{}\n" > /web-well-known/aulora.json
    umask 077
    printf "INSTANCE_NAME=legacy\n" > /host/.env
    exec /app/setup/bootstrap.sh /bin/bash -c "$1"
  ' bootstrap-test "$worker_check"

# Read-only output mounts must fail before setup contacts or changes a backend.
test_directory="$(mktemp -d)"
trap 'rmdir "$test_directory"' EXIT
for output_directory in /web-well-known /host; do
  if setup_output="$(docker run --rm --user 0:0 --entrypoint /usr/bin/timeout \
    --mount "type=bind,source=$test_directory,destination=$output_directory,readonly" \
    "$setup_image" 5 /app/setup/bootstrap.sh /app/setup/entrypoint.sh 2>&1)"; then
    printf 'Setup unexpectedly accepted read-only %s.\n' "$output_directory" >&2
    exit 1
  fi
  if [[ "$setup_output" != *"cannot write ${output_directory};"* ]]; then
    printf 'Setup did not reject read-only %s before backend access.\n' "$output_directory" >&2
    exit 1
  fi
done
printf 'Read-only mounts are rejected before backend access.\n'
