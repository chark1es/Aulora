#!/bin/sh
# Creates the streaming server's API key pair the first time the `streaming`
# profile starts, and leaves it alone afterwards (rotating it would only drop
# in-flight shares, but a stable key keeps `setup` and the server agreeing).
#
# The pair lives in a named volume that only this one-shot can write: the
# LiveKit server reads it as `key_file`, and `setup` reads it to teach Convex
# how to sign room tokens. It is never printed and never written to `.env`.
set -eu

KEYS_DIR="${KEYS_DIR:-/keys}"
KEYS_FILE="${KEYS_DIR}/keys"

if [ -s "$KEYS_FILE" ]; then
  echo "[livekit-init] key pair already exists"
  exit 0
fi

# LiveKit refuses a key file that other users can read.
umask 077
secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
if [ "${#secret}" -ne 64 ]; then
  echo "[livekit-init] could not read random bytes" >&2
  exit 1
fi

# Quoted so a secret made only of digits is never read back as a number.
tmp="${KEYS_FILE}.tmp"
printf 'aulora: "%s"\n' "$secret" >"$tmp"
mv "$tmp" "$KEYS_FILE"
echo "[livekit-init] generated a key pair"
