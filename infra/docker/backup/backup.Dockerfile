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
FROM docker.io/pgsty/mc@sha256:cfc83108c3abb371f8fb84d99c1fdc88f8c237e022409b0081fb7c0a3be634dd AS minio-client

FROM oven/bun:1.4.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=backend /convex/generate_key /usr/local/bin/generate_key
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc

WORKDIR /app

# Workspace manifests for a cacheable, frozen install.
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages ./packages
COPY LICENSE NOTICE COMMERCIAL.md THIRD_PARTY_NOTICES.md /app/legal/
COPY licenses /app/legal/third-party/

RUN bun install --frozen-lockfile

COPY infra/docker/setup /app/setup
COPY infra/docker/backup /app/backup

RUN chmod +x /usr/local/bin/generate_key \
  /app/setup/entrypoint.sh \
  /app/backup/entrypoint.sh \
  /app/backup/backup.sh

ENTRYPOINT ["/app/backup/entrypoint.sh"]
