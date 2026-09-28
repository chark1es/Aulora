#!/usr/bin/env bash
# Aulora first-run setup. Idempotent: safe to run on every deploy.
#
# It:
#   1. waits for the Convex backend and resolves the instance name/secret
#   2. generates any missing secrets (BETTER_AUTH_SECRET, SETUP_TOKEN, VAPID,
#      and the default local master key AULORA_ENCRYPTION_KEY)
#   3. mints the admin key with /convex/generate_key (needed for every CLI call)
#   4. sets the Convex deployment env vars
#   5. deploys packages/convex
#   6. initializes the workspace + owner once (refused by Convex otherwise)
#   7. writes the secret-free /.well-known/aulora.json into the web volume
#   8. persists generated secrets to HOST_ENV_FILE (infra/docker/.env on a plain
#      install, the `setup-state` volume under Coolify) and re-reads them on
#      later runs so a redeploy never regenerates the encryption master key
#
# Secrets are never printed. HTTP uses Node 26's built-in fetch and `convex run`
# drives the CLI, so there is no dependency on curl or on Node import rules.

set -euo pipefail

CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://convex-backend:3210}"
CONVEX_HTTP_URL="${CONVEX_HTTP_URL:-http://convex-backend:3211}"
CONVEX_PROJECT_DIR="${CONVEX_PROJECT_DIR:-/app/packages/convex}"
HOST_ENV_FILE="${HOST_ENV_FILE:-/host/.env}"
WELL_KNOWN_DIR="${WELL_KNOWN_DIR:-/web-well-known}"

log() { printf '[setup] %s\n' "$*"; }
die() { printf '[setup] ERROR: %s\n' "$*" >&2; exit 1; }

# --- tiny .env helpers (preserve comments; never echo secret values) --------

env_get() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  # Last assignment wins; strip an optional `export ` prefix.
  sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\?${key}=//p" "$file" | tail -n 1
}

env_set() {
  local key="$1" value="$2" file="$3"
  [ -f "$file" ] || return 0
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file"; then
    # awk so the replacement is literal (no sed delimiter/backref issues).
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

# --- 0. reuse persisted secrets and read optional settings -------------------
# `setup` writes generated secrets to ${HOST_ENV_FILE} so later runs stay
# consistent. On a plain `docker compose` the operator's .env is re-injected via
# `env_file`; under an orchestrator that does not provide that file (Coolify),
# the persisted values must be re-read here. Otherwise a redeploy would
# regenerate AULORA_ENCRYPTION_KEY and make existing ciphertext unreadable.
# Only variables the environment left empty are filled, so an explicit value
# always wins over the persisted file.

restore_persisted_secret() {
  local key="$1" current persisted
  eval "current=\${$key:-}"
  if [ -z "$current" ]; then
    persisted="$(env_get "$key" "$HOST_ENV_FILE")"
    if [ -n "$persisted" ]; then
      export "$key=$persisted"
    fi
  fi
  return 0
}

# Optional settings live in the host .env on a plain install; fall back to the
# container environment so an orchestrator can pass them directly.
host_value() {
  local key="$1" value
  eval "value=\${$key:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi
  env_get "$key" "$HOST_ENV_FILE"
}

for _persisted in \
  INSTANCE_SECRET BETTER_AUTH_SECRET VAPID_SUBJECT VAPID_PUBLIC_KEY \
  VAPID_PRIVATE_KEY AULORA_ENCRYPTION_KEY AULORA_KEK_WRAPPED; do
  restore_persisted_secret "$_persisted"
done

# --- 1. wait for the backend and resolve identity ---------------------------

SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SETUP_DIR

wait_for_backend() {
  log "waiting for Convex backend at ${CONVEX_SELF_HOSTED_URL}"
  for _ in $(seq 1 60); do
    if BACKEND_VERSION="$(node "$SETUP_DIR/backend-version.mjs" 2>/dev/null)"; then
      return 0
    fi
    sleep 2
  done
  die "Convex backend did not become reachable"
}

# --- 2. secret generation helpers -------------------------------------------

random_hex() { openssl rand -hex "$1"; }
random_b64() { openssl rand -base64 "$1"; }

# --- convex helpers ---------------------------------------------------------

convex() { ( cd "$CONVEX_PROJECT_DIR" && bunx convex "$@" ); }

set_env_if_present() {
  local key="$1" value="$2" secret="${3:-0}"
  [ -n "$value" ] || return 0
  if [ "$secret" = "1" ]; then
    log "setting env ${key}"
  else
    log "setting env ${key}=${value}"
  fi
  convex env set "$key" "$value" >/dev/null
}

# Runs a Convex function and prints its JSON result. Works for both a
# never-deployed deployment (returns nothing) and a deployed one.
run_function() {
  convex run "$1" "${2:-'{}'}" 2>/dev/null || true
}

wait_for_backend

INSTANCE_NAME_RESOLVED="$(node "$SETUP_DIR/resolve-instance.mjs" name)"
INSTANCE_SECRET_RESOLVED="$(node "$SETUP_DIR/resolve-instance.mjs" secret)"
[ -n "$INSTANCE_SECRET_RESOLVED" ] || die "could not resolve INSTANCE_SECRET"
log "instance name: ${INSTANCE_NAME_RESOLVED}"

BETTER_AUTH_SECRET_VALUE="${BETTER_AUTH_SECRET:-}"
[ -n "$BETTER_AUTH_SECRET_VALUE" ] || BETTER_AUTH_SECRET_VALUE="$(random_b64 48)"

SETUP_TOKEN_VALUE="${SETUP_TOKEN:-}"
SETUP_TOKEN_GENERATED=0
if [ -z "$SETUP_TOKEN_VALUE" ]; then
  SETUP_TOKEN_VALUE="$(random_hex 24)"
  SETUP_TOKEN_GENERATED=1
fi

VAPID_PUBLIC_KEY_VALUE="${VAPID_PUBLIC_KEY:-}"
VAPID_PRIVATE_KEY_VALUE="${VAPID_PRIVATE_KEY:-}"
VAPID_SUBJECT_VALUE="${VAPID_SUBJECT:-mailto:owner@example.com}"
if [ -z "$VAPID_PUBLIC_KEY_VALUE" ] || [ -z "$VAPID_PRIVATE_KEY_VALUE" ]; then
  # VAPID key pair for Web Push (RFC 8292). Generated once; persisted back to
  # .env so it stays stable across restarts (rotating it drops subscriptions).
  VAPID_KEYS="$(node "$SETUP_DIR/vapid.mjs")"
  VAPID_PUBLIC_KEY_VALUE="$(printf '%s\n' "$VAPID_KEYS" | sed -n 1p)"
  VAPID_PRIVATE_KEY_VALUE="$(printf '%s\n' "$VAPID_KEYS" | sed -n 2p)"
  unset VAPID_KEYS
  [ -n "$VAPID_PUBLIC_KEY_VALUE" ] || die "VAPID key generation failed"
  log "generated VAPID key pair"
fi

# --- 3. server-side encryption: local master key (default) ------------------

# The server seals all content with AES-256-GCM; the master key (the KEK) is the
# root of that confidentiality. AULORA_ENCRYPTION_KEY is the default root:
# generate a base64 32-byte key on first run and persist it. The `local` provider
# reads it directly and uses INSTANCE_SECRET only as a legacy fallback when it is
# absent. The remote providers (vault/aws-kms/gcp-kms/http) are optional/advanced
# and unwrap AULORA_KEK_WRAPPED instead, leaving the direct key unused.
AULORA_ENCRYPTION_KEY_VALUE="${AULORA_ENCRYPTION_KEY:-}"
ENCRYPTION_KEY_GENERATED=0
if [ -z "$AULORA_ENCRYPTION_KEY_VALUE" ]; then
  AULORA_ENCRYPTION_KEY_VALUE="$(random_b64 32)"
  ENCRYPTION_KEY_GENERATED=1
  log "generated AULORA_ENCRYPTION_KEY (32-byte base64 master key)"
fi

AULORA_EKM_PROVIDER_VALUE="${AULORA_EKM_PROVIDER:-local}"
AULORA_EKM_KEY_ID_VALUE="${AULORA_EKM_KEY_ID:-aulora-kek}"
AULORA_ENCRYPTION_KEY_VERSION_VALUE="${AULORA_ENCRYPTION_KEY_VERSION:-1}"
AULORA_ENCRYPTION_ENABLED_VALUE="${AULORA_ENCRYPTION_ENABLED:-true}"

# --- 4. admin key (must exist before any `convex env set`) ------------------

# Mint the admin key with the backend's own binary. It writes the
# "<instance>|<hex>" pair to stdout (stderr carries just the "Admin key:" label).
ADMIN_KEY="$(/usr/local/bin/generate_key "$INSTANCE_NAME_RESOLVED" "$INSTANCE_SECRET_RESOLVED" 2>/dev/null | tr -d '\r' | tail -n 1)"
case "$ADMIN_KEY" in
  *"|"*) : ;;
  *) die "generate_key did not produce an instance|key pair" ;;
esac
export CONVEX_SELF_HOSTED_URL
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"
log "minted admin key for instance ${INSTANCE_NAME_RESOLVED}"

# --- 5. deployment env vars -------------------------------------------------

SITE_URL_VALUE="${SITE_URL:-}"
CONVEX_SITE_ORIGIN_VALUE="${CONVEX_SITE_ORIGIN:-}"
CONVEX_CLOUD_ORIGIN_VALUE="${CONVEX_CLOUD_ORIGIN:-}"

set_env_if_present BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET_VALUE" 1
set_env_if_present SETUP_TOKEN "$SETUP_TOKEN_VALUE" 1
set_env_if_present SITE_URL "$SITE_URL_VALUE"
# NOTE: CONVEX_CLOUD_URL / CONVEX_SITE_URL are built-in Convex env vars and are
# rejected by `convex env set`; the backend derives them from
# CONVEX_CLOUD_ORIGIN / CONVEX_SITE_ORIGIN. server:publicConfig reads the
# built-in, and the well-known document takes the origin explicitly below.
set_env_if_present CONVEX_SITE_ORIGIN "$CONVEX_SITE_ORIGIN_VALUE"
set_env_if_present TRUSTED_ORIGINS "${TRUSTED_ORIGINS:-}"
set_env_if_present AUTH_LOCAL_ENABLED "${AUTH_LOCAL_ENABLED:-}"
set_env_if_present AUTH_LOCAL_SIGNUP "${AUTH_LOCAL_SIGNUP:-}"

for prefix in GITHUB GOOGLE MICROSOFT APPLE; do
  set_env_if_present "${prefix}_CLIENT_ID" "$(host_value "${prefix}_CLIENT_ID")"
  set_env_if_present "${prefix}_CLIENT_SECRET" "$(host_value "${prefix}_CLIENT_SECRET")" 1
done

set_env_if_present OIDC_DISPLAY_NAME "$(host_value OIDC_DISPLAY_NAME)"
set_env_if_present OIDC_ISSUER "$(host_value OIDC_ISSUER)"
set_env_if_present OIDC_DISCOVERY_URL "$(host_value OIDC_DISCOVERY_URL)"
set_env_if_present OIDC_CLIENT_ID "$(host_value OIDC_CLIENT_ID)"
set_env_if_present OIDC_CLIENT_SECRET "$(host_value OIDC_CLIENT_SECRET)" 1
set_env_if_present OIDC_SCOPES "$(host_value OIDC_SCOPES)"
set_env_if_present OIDC_GROUP_CLAIM "$(host_value OIDC_GROUP_CLAIM)"
set_env_if_present OIDC_GROUP_ROLE_MAP "$(host_value OIDC_GROUP_ROLE_MAP)"

set_env_if_present VAPID_SUBJECT "$VAPID_SUBJECT_VALUE"
set_env_if_present VAPID_PUBLIC_KEY "$VAPID_PUBLIC_KEY_VALUE"
set_env_if_present VAPID_PRIVATE_KEY "$VAPID_PRIVATE_KEY_VALUE" 1

# Server-side encryption: the default local master key is set as a secret.
# Optional/advanced external-provider settings are read from the host .env and
# applied only when present. No key material is ever logged.
set_env_if_present AULORA_ENCRYPTION_ENABLED "$AULORA_ENCRYPTION_ENABLED_VALUE"
set_env_if_present AULORA_EKM_PROVIDER "$AULORA_EKM_PROVIDER_VALUE"
set_env_if_present AULORA_EKM_KEY_ID "$AULORA_EKM_KEY_ID_VALUE"
set_env_if_present AULORA_ENCRYPTION_KEY_VERSION "$AULORA_ENCRYPTION_KEY_VERSION_VALUE"
set_env_if_present AULORA_ENCRYPTION_KEY "$AULORA_ENCRYPTION_KEY_VALUE" 1
set_env_if_present AULORA_KEK_WRAPPED "$(host_value AULORA_KEK_WRAPPED)" 1
set_env_if_present VAULT_ADDR "$(host_value VAULT_ADDR)"
set_env_if_present VAULT_TOKEN "$(host_value VAULT_TOKEN)" 1
set_env_if_present VAULT_TRANSIT_MOUNT "$(host_value VAULT_TRANSIT_MOUNT)"
set_env_if_present VAULT_NAMESPACE "$(host_value VAULT_NAMESPACE)"
set_env_if_present AWS_REGION "$(host_value AWS_REGION)"
set_env_if_present AWS_KMS_KEY_ID "$(host_value AWS_KMS_KEY_ID)"
set_env_if_present GCP_KMS_KEY_NAME "$(host_value GCP_KMS_KEY_NAME)"
set_env_if_present EKM_PROXY_URL "$(host_value EKM_PROXY_URL)"
set_env_if_present EKM_PROXY_TOKEN "$(host_value EKM_PROXY_TOKEN)" 1

# --- 6. deploy --------------------------------------------------------------

log "deploying ${CONVEX_PROJECT_DIR}"
convex deploy --yes

# --- 7. one-time initialize -------------------------------------------------

initialized() {
  run_function setup:status '{}' | grep -q '"initialized"[: ]*true'
}

if initialized; then
  log "server already initialized; skipping owner/workspace creation"
else
  WORKSPACE="${WORKSPACE_NAME:-Aulora}"
  OWNER_EMAIL_VALUE="${OWNER_EMAIL:-}"
  OWNER_PASSWORD_VALUE="${OWNER_PASSWORD:-}"
  OWNER_NAME_VALUE="${OWNER_NAME:-$WORKSPACE}"

  [ -n "$OWNER_EMAIL_VALUE" ] || die "OWNER_EMAIL is not set in .env"
  [ -n "$OWNER_PASSWORD_VALUE" ] || die "OWNER_PASSWORD is not set in .env"

  log "initializing workspace '${WORKSPACE}' with owner ${OWNER_EMAIL_VALUE}"

  RESPONSE_FILE="$(mktemp)"
  # Pass the generated token/value explicitly; the deployment may have a
  # user-supplied SETUP_TOKEN while the generated one lives only in this script.
  CODE="$(
    SETUP_TOKEN="$SETUP_TOKEN_VALUE" \
    WORKSPACE_NAME="$WORKSPACE" \
    OWNER_EMAIL="$OWNER_EMAIL_VALUE" \
    OWNER_PASSWORD="$OWNER_PASSWORD_VALUE" \
    OWNER_NAME="$OWNER_NAME_VALUE" \
    node "$SETUP_DIR/initialize.mjs" "$RESPONSE_FILE"
  )" || die "initialize.mjs could not run"

  if [ "$CODE" = "200" ]; then
    log "workspace initialized"
  elif [ "$CODE" = "400" ] && grep -q 'SETUP_FAILED' "$RESPONSE_FILE" 2>/dev/null; then
    # Likely already initialized (a concurrent or previous partial run).
    if initialized; then
      log "server already initialized; continuing"
    else
      rm -f "$RESPONSE_FILE"
      die "setup/initialize failed and the server is not initialized"
    fi
  else
    # Never print the response body: it could echo request data.
    rm -f "$RESPONSE_FILE"
    die "setup/initialize returned HTTP ${CODE}"
  fi
  rm -f "$RESPONSE_FILE"
fi

# --- 8. well-known document -------------------------------------------------

log "writing well-known document"
PUBLIC_CONFIG_JSON="$(run_function server:publicConfig '{}')"
[ -n "$PUBLIC_CONFIG_JSON" ] || die "could not read server:publicConfig"
# The volume is mounted by the web container at /var/www/.well-known, so the
# document lives at the volume root (nginx `root /var/www` + `/.well-known/...`).
mkdir -p "$WELL_KNOWN_DIR"
PUBLIC_CONFIG="$PUBLIC_CONFIG_JSON" \
  NAME_VALUE="${WORKSPACE_NAME:-}" \
  SITE_URL_VALUE="$SITE_URL_VALUE" \
  CONVEX_URL_VALUE="$CONVEX_CLOUD_ORIGIN_VALUE" \
  node "$SETUP_DIR/well-known.mjs" > "$WELL_KNOWN_DIR/aulora.json"
log "well-known written to ${WELL_KNOWN_DIR}/aulora.json"

# --- 9. persist generated secrets -------------------------------------------

# On a plain install /host is the repo checkout and .env already exists. On a
# named volume (Coolify) it is empty on the first run; create it so the
# generated secrets are actually written and can be reused on the next deploy.
# Creation (and env_set's temp-file swap) run under a restrictive umask so the
# generated secrets are never world-readable. Failing to create or write the
# file is fatal: silently skipping persistence would let a redeploy regenerate
# AULORA_ENCRYPTION_KEY and make existing ciphertext unreadable.
HOST_ENV_DIR="$(dirname "$HOST_ENV_FILE")"
if [ -d "$HOST_ENV_DIR" ]; then
  UMASK_PREV="$(umask)"
  umask 077
  if [ ! -f "$HOST_ENV_FILE" ]; then
    if ! : > "$HOST_ENV_FILE"; then
      die "cannot create ${HOST_ENV_FILE}"
    fi
    log "created ${HOST_ENV_FILE}"
  fi
  if ! : >> "$HOST_ENV_FILE"; then
    die "cannot write ${HOST_ENV_FILE}"
  fi
  env_set INSTANCE_NAME "$INSTANCE_NAME_RESOLVED" "$HOST_ENV_FILE"
  env_set INSTANCE_SECRET "$INSTANCE_SECRET_RESOLVED" "$HOST_ENV_FILE"
  env_set BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET_VALUE" "$HOST_ENV_FILE"
  [ -n "$VAPID_PUBLIC_KEY_VALUE" ] && env_set VAPID_PUBLIC_KEY "$VAPID_PUBLIC_KEY_VALUE" "$HOST_ENV_FILE"
  [ -n "$VAPID_PRIVATE_KEY_VALUE" ] && env_set VAPID_PRIVATE_KEY "$VAPID_PRIVATE_KEY_VALUE" "$HOST_ENV_FILE"
  env_set VAPID_SUBJECT "$VAPID_SUBJECT_VALUE" "$HOST_ENV_FILE"
  env_set AULORA_EKM_PROVIDER "$AULORA_EKM_PROVIDER_VALUE" "$HOST_ENV_FILE"
  env_set AULORA_EKM_KEY_ID "$AULORA_EKM_KEY_ID_VALUE" "$HOST_ENV_FILE"
  env_set AULORA_ENCRYPTION_KEY_VERSION "$AULORA_ENCRYPTION_KEY_VERSION_VALUE" "$HOST_ENV_FILE"
  env_set AULORA_ENCRYPTION_ENABLED "$AULORA_ENCRYPTION_ENABLED_VALUE" "$HOST_ENV_FILE"
  # Only write the master key back when this run generated it; an operator-set
  # key stays where they put it. Never echo it.
  if [ "$ENCRYPTION_KEY_GENERATED" = "1" ]; then
    env_set AULORA_ENCRYPTION_KEY "$AULORA_ENCRYPTION_KEY_VALUE" "$HOST_ENV_FILE"
  fi
  umask "$UMASK_PREV"
  log "persisted generated secrets to ${HOST_ENV_FILE}"
else
  log "host .env directory not mounted; skipped persisting generated secrets"
fi

# The one-time setup token is not needed after a successful init.
if [ "$SETUP_TOKEN_GENERATED" = "1" ] && initialized; then
  convex env remove SETUP_TOKEN >/dev/null 2>&1 || true
  log "removed one-time SETUP_TOKEN from the deployment"
fi

log "done"
