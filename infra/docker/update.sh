#!/usr/bin/env bash
#
# Check for and apply an Aulora workspace update.
#
# Runs on the host, in a git checkout. It does not touch .env or named volumes.
# A newer release is applied by fast-forwarding to its tag and running deploy.sh.
# If the checkout already contains that release but the containers were not
# rebuilt, it only redeploys.
#
#   ./update.sh                 # check; apply when AULORA_AUTO_UPDATE=true
#   ./update.sh --check         # print the plan and change nothing
#   ./update.sh --apply         # apply when a newer release is published
#   ./update.sh --watch         # enable updates from settings; watch for releases
#   ./update.sh --download      # prepare the release without restarting
#   ./update.sh --restart       # install the prepared release
#   ./update.sh --install-service # keep the macOS watcher running at login
#   ./update.sh --remove-service  # remove the macOS watcher service
#
# --check exits 10 when an update is available and 1 on failure.
#
set -euo pipefail

self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DOCKER_DIR="$(cd "$(dirname "$self")" && pwd)"
REPO="$(cd "$DOCKER_DIR/../.." && pwd)"
CLI="$DOCKER_DIR/update/cli.mjs"
STATUS="$DOCKER_DIR/.update-status.json"
DEPLOYED="$DOCKER_DIR/.deployed-version"
LOCK="$DOCKER_DIR/.update.lock"

log() { printf '[update] %s\n' "$*"; }
fail() { printf '[update] ERROR: %s\n' "$*" >&2; return 1; }

lock_owned=0
cleanup() { if [ "$lock_owned" = 1 ]; then rmdir "$LOCK" 2>/dev/null || true; fi; }
trap cleanup EXIT

json_field() {
  bun -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    if (value === undefined || value === null) process.exit(0);
    process.stdout.write(typeof value === "boolean" ? (value ? "true" : "false") : String(value));
  ' "$1" "$2"
}

is_release_tag() {
  printf '%s' "$1" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
}

publish_status() {
  command -v docker >/dev/null 2>&1 || return 0
  docker compose version >/dev/null 2>&1 || return 0
  (
    cd "$DOCKER_DIR"
    docker compose run --rm --no-deps -T --entrypoint sh setup \
      -c 'cat > /web-well-known/aulora-update.json'
  ) < "$1" >/dev/null 2>&1 || true
}

check_plan() {
  command -v bun >/dev/null 2>&1 || { fail "bun is required to check for updates"; return 1; }
  [ -d "$REPO/.git" ] || { fail "auto-update needs a git clone of Aulora"; return 1; }
  bun "$CLI" check --output "$STATUS" >/dev/null || return 1
  publish_status "$STATUS"
}

apply_plan() {
  local apply tag source latest error head tagrev
  apply="$(json_field "$STATUS" apply)"
  tag="$(json_field "$STATUS" gitTag)"
  source="$(json_field "$STATUS" sourceVersion)"
  latest="$(json_field "$STATUS" latestVersion)"
  error="$(json_field "$STATUS" error)"
  if [ -n "$error" ]; then
    fail "$error"
    return 1
  fi
  if [ "$apply" = "none" ]; then
    log "already current ($(json_field "$STATUS" currentVersion))"
    return 0
  fi
  if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
    bun "$CLI" mark --file "$STATUS" --state failed --error "Working tree has uncommitted changes."
    publish_status "$STATUS"
    fail "working tree has uncommitted changes; refusing to update"
    return 1
  fi
  if [ ! -f "$DEPLOYED" ]; then
    printf '%s\n' "$source" > "$DEPLOYED"
  fi
  if [ "$apply" = "fast-forward" ]; then
    is_release_tag "$tag" || { fail "refusing tag: $tag"; return 1; }
    log "fast-forwarding to $tag"
    GIT_TERMINAL_PROMPT=0 git -C "$REPO" fetch --tags --force origin
    git -C "$REPO" rev-parse --verify "${tag}^{commit}" >/dev/null 2>&1 || {
      fail "tag $tag was not found"
      return 1
    }
    head="$(git -C "$REPO" rev-parse HEAD)"
    tagrev="$(git -C "$REPO" rev-parse "${tag}^{commit}")"
    if [ "$head" != "$tagrev" ]; then
      git -C "$REPO" merge --ff-only "$tag" || { fail "cannot fast-forward to $tag"; return 1; }
      head="$(git -C "$REPO" rev-parse HEAD)"
      [ "$head" = "$tagrev" ] || { fail "HEAD is not $tag after merge; refusing to deploy"; return 1; }
    fi
  elif [ "$apply" != "redeploy" ]; then
    fail "unknown apply action: $apply"
    return 1
  fi
  bun "$CLI" mark --file "$STATUS" --state applying
  publish_status "$STATUS"
  log "rebuilding and redeploying"
  if ! "$DOCKER_DIR/deploy.sh"; then
    bun "$CLI" mark --file "$STATUS" --state failed --error "deploy.sh failed"
    publish_status "$STATUS"
    fail "deploy.sh failed; the previous version stamp was kept"
    return 1
  fi
  if [ "$apply" = "fast-forward" ]; then
    printf '%s\n' "$latest" > "$DEPLOYED"
  else
    printf '%s\n' "$source" > "$DEPLOYED"
  fi
  bun "$CLI" check --output "$STATUS" >/dev/null || true
  publish_status "$STATUS"
  log "updated to $(json_field "$STATUS" currentVersion)"
}

with_lock() {
  if ! mkdir "$LOCK" 2>/dev/null; then
    log "an update is already running"
    return 1
  fi
  lock_owned=1
  set +e
  "$@"
  local status=$?
  set -e
  rmdir "$LOCK" 2>/dev/null || true
  lock_owned=0
  return "$status"
}

run_once() {
  local mode="$1" apply auto error
  check_plan || return 1
  apply="$(json_field "$STATUS" apply)"
  auto="$(json_field "$STATUS" autoUpdate)"
  error="$(json_field "$STATUS" error)"
  if [ "$mode" = "check" ]; then
    cat "$STATUS"
    if [ -n "$error" ]; then
      return 1
    fi
    if [ "$apply" != "none" ]; then
      return 10
    fi
    return 0
  fi
  if [ -n "$error" ]; then
    log "$error"
    return 1
  fi
  if [ "$mode" = "apply" ] || { [ "$auto" = "true" ] && [ "$apply" != "none" ]; }; then
    apply_plan
    return $?
  fi
  if [ "$apply" != "none" ]; then
    log "v$(json_field "$STATUS" latestVersion) is available. Auto-update is off; run $self --apply"
    return 0
  fi
  log "no update ($(json_field "$STATUS" currentVersion))"
}

mode="auto"
case "${1:-}" in
  "") mode="auto" ;;
  --check) mode="check" ;;
  --apply) mode="apply" ;;
  --download) mode="download" ;;
  --restart) mode="restart" ;;
  --watch) mode="watch" ;;
  --install-service) exec bun "$DOCKER_DIR/update/service.mjs" install ;;
  --remove-service) exec bun "$DOCKER_DIR/update/service.mjs" remove ;;
  -h|--help)
    sed -n '2,16p' "$self" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    printf '[update] ERROR: unknown option: %s\n' "$1" >&2
    exit 2
    ;;
esac

if [ "$mode" = "watch" ]; then
  exec bun "$DOCKER_DIR/update/host.mjs"
fi
if [ "$mode" = "download" ] || [ "$mode" = "restart" ]; then
  with_lock bun "$DOCKER_DIR/update/stage.mjs" "$mode"
  exit $?
fi

with_lock run_once "$mode"
