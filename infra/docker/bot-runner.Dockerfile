# syntax=docker/dockerfile:1.7
#
# Aulora bot runner image (compose profile `bots`).
#
# Supervises user-created TypeScript and Python bots: one sandboxed process per
# enabled bot, each with its own uid/gid, work directory and resource limits.
# The supervisor runs as root ONLY to switch uids; compose drops every other
# capability (cap_drop: ALL with cap_add SETUID/SETGID/CHOWN/KILL). See
# ../../docs/bots-design.md for the contract.
#
# Build context is the repo root; see ../../.dockerignore.

# Builder: compile the TypeScript bot SDK in the Bun workspace (it extends
# `@aulora/config` and is a `workspace:*` consumer), then ship only its dist.
FROM oven/bun:1.4.0 AS ts-sdk
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages ./packages
RUN bun install --frozen-lockfile
RUN bun run --cwd packages/bot-sdk build

FROM node:24-bookworm-slim

# python3 + venv for Python bots and their `pip install --target` step;
# util-linux provides `prlimit` for per-bot resource limits.
# Pinning exact Debian package versions would break the build whenever the
# bookworm repositories move, so install the current bookworm packages.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    util-linux \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Python bot SDK: installed once into a shared venv that bots reuse.
RUN python3 -m venv /opt/venv
COPY packages/bot-sdk-python /tmp/bot-sdk-python
RUN /opt/venv/bin/pip install --no-cache-dir --disable-pip-version-check /tmp/bot-sdk-python \
  && rm -rf /tmp/bot-sdk-python

# TypeScript bot SDK: dist + package.json only. Bots resolve `@aulora/bot`
# through a symlink the supervisor creates in each bot's node_modules.
COPY --from=ts-sdk /app/packages/bot-sdk/dist /opt/aulora/bot-sdk/dist
COPY --from=ts-sdk /app/packages/bot-sdk/package.json /opt/aulora/bot-sdk/package.json

# tsx runs TypeScript bots; pinned like every other image dependency.
RUN npm install -g --no-audit --no-fund tsx@4.23.15

WORKDIR /app
COPY infra/bot-runner/src /app/src
COPY infra/bot-runner/package.json /app/package.json

# The root filesystem is read-only in compose; give the supervisor a writable
# HOME on the /tmp tmpfs.
ENV HOME=/tmp
ENV NODE_ENV=production

# The supervisor starts as root only to give every bot its own uid/gid; compose
# grants SETUID/SETGID/CHOWN/KILL and drops every other capability.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["node", "/app/src/main.mjs"]
