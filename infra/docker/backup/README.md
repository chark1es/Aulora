# Aulora backup runner

A small long-running service that produces a portable Aulora backup every night:

1. `pg_dump` of the Convex Postgres database (custom format);
2. `convex export` of the deployment (data + S3-backed file storage);
3. both artifacts uploaded to S3/MinIO under `backups/<timestamp>/`;
4. the result recorded back in Convex, where the instance admin panel shows it.

The Convex cron in `packages/convex/convex/crons.ts` records the nightly *intent*
at 03:00 UTC (unless the operator disabled backups); this runner performs the
actual work. Neither side ever sees message plaintext or key material — data at
rest is ciphertext by design.

## Enable it

```sh
cd infra/docker
# optional: set BACKUP_HOUR_UTC / BACKUP_BUCKET / BACKUP_RETENTION in .env
docker compose --profile backups up -d --build
docker compose logs -f backup
```

The runner waits for the Convex backend, waits for `setup` to finish, mints the
admin key with the backend's own `/convex/generate_key`, ensures a
`BACKUP_TOKEN` deployment secret exists and persists it to `.env`, then sleeps
until `BACKUP_HOUR_UTC`.

- `BACKUP_RUN_ONCE=1 docker compose run --rm backup` runs a single backup now.
- `BACKUP_ENABLED=false` keeps the container idle.
- `BACKUP_SKIP_UPLOAD=1` keeps artifacts local (useful when testing without S3).
- `BACKUP_KEEP_LOCAL=0` disables local pruning; the S3 copies are durable.

## Restore

Bring up a fresh stack, restore `.env` (it holds `INSTANCE_SECRET`, which is
required to read the data), then:

```sh
# Postgres
docker compose cp backup-data:... # or download from S3, then:
docker compose exec -T postgres pg_restore -U convex -d <db> --clean postgres.dump

# Convex
docker compose run --rm setup bash -lc \
  "cd /app/packages/convex && bunx convex import --path /backup/convex.zip"
```

See the "Backup and restore" section of `../README.md` for the full procedure.

## Tests

The pure planning helpers (`backup-plan.mjs`) have `node:test` coverage and no
Docker dependency:

```sh
node --test test/*.test.mjs
```
