#!/bin/sh
# Aulora Vault initialiser (compose profile `ekm`).
#
# Waits for Vault, enables the transit secrets engine and creates the KEK. When
# a local master key is present it also wraps that key with transit and writes
# the resulting AULORA_KEK_WRAPPED (plus VAULT_ADDR / VAULT_TRANSIT_MOUNT) back
# to infra/docker/.env, so the server can unwrap it at runtime.
#
# No key material is ever printed. The bundled Vault is dev mode (in-memory);
# for production use a persistent Vault and back up the KEK.

set -eu

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
export VAULT_ADDR
: "${VAULT_TOKEN:?VAULT_TOKEN must be set for vault-init}"
VAULT_TRANSIT_MOUNT="${VAULT_TRANSIT_MOUNT:-transit}"
AULORA_EKM_KEY_ID="${AULORA_EKM_KEY_ID:-aulora-kek}"
HOST_ENV_FILE="${HOST_ENV_FILE:-/host/.env}"

log() { printf '[vault-init] %s\n' "$*"; }

# --- tiny .env helpers (preserve comments; never echo secret values) ---------

env_get() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?${key}=//p" "$file" | tail -n 1
}

env_set() {
  local key="$1" value="$2" file="$3"
  [ -f "$file" ] || return 0
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file"; then
    KEY="$key" VALUE="$value" awk '
      BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"] }
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" k "=" { print k "=" v; next }
      { print }
    ' "$file" > "${file}.tmp"
    mv "${file}.tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# --- 1. wait for Vault -------------------------------------------------------

log "waiting for Vault at ${VAULT_ADDR}"
for _ in $(seq 1 60); do
  if vault status >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
vault status >/dev/null 2>&1 || {
  log "Vault did not become ready"
  exit 1
}

# --- 2. transit engine + KEK -------------------------------------------------

if vault secrets list -format=json 2>/dev/null | grep -q "\"${VAULT_TRANSIT_MOUNT}/\""; then
  log "transit engine already enabled at ${VAULT_TRANSIT_MOUNT}"
else
  vault secrets enable -path="${VAULT_TRANSIT_MOUNT}" transit >/dev/null
  log "enabled the transit engine at ${VAULT_TRANSIT_MOUNT}"
fi

if vault read "${VAULT_TRANSIT_MOUNT}/keys/${AULORA_EKM_KEY_ID}" >/dev/null 2>&1; then
  log "KEK ${AULORA_EKM_KEY_ID} already exists"
else
  vault write -f "${VAULT_TRANSIT_MOUNT}/keys/${AULORA_EKM_KEY_ID}" >/dev/null
  log "created KEK ${AULORA_EKM_KEY_ID}"
fi

# --- 3. wrap the local master key, if one is configured ----------------------

PLAINTEXT="$(env_get AULORA_ENCRYPTION_KEY "$HOST_ENV_FILE")"
WRAPPED="$(env_get AULORA_KEK_WRAPPED "$HOST_ENV_FILE")"
if [ -n "$WRAPPED" ]; then
  log "AULORA_KEK_WRAPPED already present; leaving it unchanged"
elif [ -n "$PLAINTEXT" ]; then
  CIPHERTEXT="$(
    vault write -field=ciphertext \
      "${VAULT_TRANSIT_MOUNT}/encrypt/${AULORA_EKM_KEY_ID}" \
      plaintext="$PLAINTEXT" 2>/dev/null || true
  )"
  if [ -n "$CIPHERTEXT" ]; then
    env_set AULORA_KEK_WRAPPED "$CIPHERTEXT" "$HOST_ENV_FILE"
    env_set VAULT_ADDR "$VAULT_ADDR" "$HOST_ENV_FILE"
    env_set VAULT_TRANSIT_MOUNT "$VAULT_TRANSIT_MOUNT" "$HOST_ENV_FILE"
    log "wrapped AULORA_ENCRYPTION_KEY into AULORA_KEK_WRAPPED"
    log "set AULORA_EKM_PROVIDER=vault in ${HOST_ENV_FILE}, then re-run setup"
  else
    log "could not wrap the master key; no AULORA_KEK_WRAPPED written"
  fi
else
  log "no AULORA_ENCRYPTION_KEY or AULORA_KEK_WRAPPED in ${HOST_ENV_FILE}; nothing to wrap"
fi

log "done"
