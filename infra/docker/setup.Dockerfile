# syntax=docker/dockerfile:1.7
#
# One-shot first-run setup image.
#
# It reuses `/convex/generate_key` from the exact Convex backend image we run
# (so the admin key it mints is guaranteed valid for that revision) and adds
# Bun + the `packages/convex` project so it can deploy functions and call the
# Convex CLI. The entrypoint is idempotent; see setup/entrypoint.sh.
#
# Build context is the repo root; see ../../.dockerignore.

# Source of the `generate_key` binary only.
FROM ghcr.io/convex/convex-backend@sha256:b756b06641d15a55b5ec0692897ce5ad3715ddccfd02e1e213621e9e764255c8 AS backend

# Package manifests only; see web.Dockerfile for why.
FROM oven/bun:1.4.4 AS manifests
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages ./packages
RUN find packages -type f ! -name package.json -delete \
  && find packages -type d -empty -delete

# Bun runtime. `generate_key` was built on Ubuntu 24.04 (older glibc) and runs
# fine on this newer Debian base; the reverse is not guaranteed.
FROM oven/bun:1.4.4 AS setup

# Compose grants root only to the bootstrap, which prepares output ownership
# and drops all privileges before running setup. Direct image use is non-root.
#
# The user exists first and everything under /app is created as that user. A
# recursive `chown -R /app` afterwards rewrites every file of node_modules into
# a new layer, which dominated this image's build time.
RUN groupadd --system --gid 10001 aulora \
  && useradd --system --uid 10001 --gid aulora --home-dir /app aulora \
  && mkdir -p /app && chown aulora:aulora /app

COPY --from=backend --chmod=0755 /convex/generate_key /usr/local/bin/generate_key

WORKDIR /app
USER aulora

# Dependencies first, from the manifests alone, so a source edit does not
# reinstall them. Only the Convex project is installed: setup deploys its
# functions and runs the Convex CLI, and needs nothing from the web client.
COPY --from=manifests --chown=aulora:aulora /src ./
RUN --mount=type=cache,target=/bun-cache,uid=10001,gid=10001 \
  BUN_INSTALL_CACHE_DIR=/bun-cache bun install --frozen-lockfile --filter '@aulora/convex'

COPY --chown=aulora:aulora turbo.json ./
COPY --chown=aulora:aulora packages ./packages
COPY --chown=aulora:aulora LICENSE NOTICE COMMERCIAL.md THIRD_PARTY_NOTICES.md /app/legal/
COPY --chown=aulora:aulora licenses /app/legal/third-party/
COPY --chown=aulora:aulora --chmod=0755 infra/docker/setup /app/setup

ENTRYPOINT ["/app/setup/bootstrap.sh"]
CMD ["/app/setup/entrypoint.sh"]
