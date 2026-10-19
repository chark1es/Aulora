#!/usr/bin/env bash
# Literal `.env` read/write helpers, shared by the setup entrypoint and tests.
#
# Values are written unquoted and read verbatim (last assignment wins, optional
# `export ` prefix). Secrets are never echoed. Values containing `#`, spaces or
# newlines do not round-trip; the setup script stores such values base64url-
# encoded instead (see BOT_JWT_*_B64 in entrypoint.sh).

env_get() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  # Last assignment wins; strip an optional `export ` prefix. `-E` keeps the
  # optional group portable (BSD sed does not support `\+`/`\?` in BRE).
  sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${key}=//p" "$file" | tail -n 1
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
