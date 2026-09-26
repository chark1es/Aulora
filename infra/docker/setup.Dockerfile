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
FROM ghcr.io/get-convex/convex-backend@sha256:b756b06641d15a55b5ec0692897ce5ad3715ddccfd02e1e213621e9e764255c8 AS backend

# Bun runtime. `generate_key` was built on Ubuntu 24.04 (older glibc) and runs
# fine on this newer Debian base; the reverse is not guaranteed.
FROM oven/bun:1.4.0 AS setup

COPY --from=backend /convex/generate_key /usr/local/bin/generate_key

WORKDIR /app

# Workspace manifests for a cacheable, frozen install.
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages ./packages

RUN bun install --frozen-lockfile

COPY infra/docker/setup /app/setup

RUN chmod +x /usr/local/bin/generate_key /app/setup/entrypoint.sh


ENTRYPOINT ["/app/setup/entrypoint.sh"]
