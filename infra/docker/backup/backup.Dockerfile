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
FROM ghcr.io/convex/convex-backend@sha256:b756b06641d15a55b5ec0692897ce5ad3715ddccfd02e1e213621e9e764255c8 AS backend
FROM docker.io/pgsty/mc@sha256:cfc83108c3abb371f8fb84d99c1fdc88f8c237e022409b0081fb7c0a3be634dd AS minio-client

# Package manifests only; see web.Dockerfile for why.
FROM oven/bun:1.4.4 AS manifests
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages ./packages
RUN find packages -type f ! -name package.json -delete \
  && find packages -type d -empty -delete

FROM oven/bun:1.4.4

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-client=17+278 \
    ca-certificates=20250419+deb13u1 \
    curl=8.14.1-2+deb13u7 \
  && rm -rf /var/lib/apt/lists/*

# Run the backup runner as an unprivileged user rather than root. The user
# exists first and everything under /app is created as that user: a recursive
# `chown -R /app` afterwards rewrites every file of node_modules into a new
# layer, which dominated the build time of the sibling setup image.
RUN groupadd --system aulora && useradd --system --gid aulora --home-dir /app aulora \
  && mkdir -p /app && chown aulora:aulora /app

COPY --from=backend --chmod=0755 /convex/generate_key /usr/local/bin/generate_key
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc

WORKDIR /app

# Dependencies first, from the manifests alone, so a source edit does not
# reinstall them. The runner only drives the Convex CLI. The install runs as the
# runner's user so node_modules is created with the right owner.
COPY --from=manifests --chown=aulora:aulora /src ./
RUN --mount=type=cache,target=/bun-cache \
  chmod 777 /bun-cache \
  && runuser -u aulora -- env BUN_INSTALL_CACHE_DIR=/bun-cache bun install --frozen-lockfile --filter '@aulora/convex'

COPY --chown=aulora:aulora turbo.json ./
COPY --chown=aulora:aulora packages ./packages
COPY --chown=aulora:aulora LICENSE NOTICE COMMERCIAL.md THIRD_PARTY_NOTICES.md /app/legal/
COPY --chown=aulora:aulora licenses /app/legal/third-party/
COPY --chown=aulora:aulora --chmod=0755 infra/docker/setup /app/setup
COPY --chown=aulora:aulora --chmod=0755 infra/docker/backup /app/backup

USER aulora

ENTRYPOINT ["/app/backup/entrypoint.sh"]
