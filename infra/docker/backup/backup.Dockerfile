# syntax=docker/dockerfile:1.7
#
# Nightly backup runner image (compose profile `backups`).
#
# It reuses `/convex/generate_key` from the exact Convex backend image we run so
# the admin key it mints is valid, and adds the Convex CLI (Bun + packages) for
# `convex export` / `convex run`, `pg_dump` for Postgres, and the MinIO `mc`
# client for S3 uploads. The entrypoint loops until BACKUP_HOUR_UTC; see
# entrypoint.sh.
#
# Build context is the repo root; see ../../.dockerignore.

# Source of the `generate_key` binary only.
FROM ghcr.io/get-convex/convex-backend@sha256:b756b06641d15a55b5ec0692897ce5ad3715ddccfd02e1e213621e9e764255c8 AS backend

FROM oven/bun:1.4.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc

COPY --from=backend /convex/generate_key /usr/local/bin/generate_key

WORKDIR /app

# Workspace manifests for a cacheable, frozen install.
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages ./packages

RUN bun install --frozen-lockfile

COPY infra/docker/setup /app/setup
COPY infra/docker/backup /app/backup

RUN chmod +x /usr/local/bin/generate_key \
  /app/setup/entrypoint.sh \
  /app/backup/entrypoint.sh \
  /app/backup/backup.sh

ENTRYPOINT ["/app/backup/entrypoint.sh"]
