# Backups

Three things hold state, and all three matter:

1. **Convex data** — exported with `convex export` (it also covers S3-backed
   file storage).
2. **Postgres** — the relational store behind Convex, dumped with `pg_dump`.
3. **Secrets** — `infra/docker/.env`, which holds `INSTANCE_SECRET` and the
   default encryption key `AULORA_ENCRYPTION_KEY` (plus any optional external EKM
   settings). That key is the KEK; the data and its backups are ciphertext at
   rest, and the KEK is what makes them readable. Keep it separately and securely
   and never commit it. Losing the KEK makes the existing data unreadable.

## Nightly runner

Enable the `backups` profile and the discrete service does all of it for you:

```sh
cd infra/docker
docker compose --profile backups up -d --build
docker compose logs -f backup
```

Each run:

1. waits for the backend and `setup` to finish;
2. mints the admin key with the backend's own `generate_key`;
3. runs `pg_dump` and `convex export`;
4. uploads both artifacts to `s3://<BACKUP_BUCKET>/backups/<timestamp>/`;
5. records the result, which the [admin panel](admin.md) shows.

The Convex cron in `packages/convex/convex/crons.ts` records the nightly intent
at 03:00 UTC; the runner performs the work. The artifacts hold only ciphertext
and a non-secret `encryption.json` manifest naming the EKM provider and key
version; no key material is included.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_HOUR_UTC` | `3` | hour (0–23, UTC) to start the run |
| `BACKUP_ENABLED` | `true` | set `false` to idle the container |
| `BACKUP_BUCKET` | `aulora-backups` | destination bucket |
| `BACKUP_RETENTION` | `7` | local run directories to keep |
| `BACKUP_TOKEN` | generated | shared secret for recording results |
| `BACKUP_RUN_ONCE` | unset | `1` runs one backup and exits |
| `BACKUP_SKIP_UPLOAD` | unset | `1` keeps artifacts local |

Result recording is best-effort: if the token or deployment is missing the run
still completes and is logged.

## Restore

Bring up a fresh stack and restore `infra/docker/.env` first, then make sure the
KEK is available (the `AULORA_ENCRYPTION_KEY` value or, if you moved to an
external key manager, its KEK); without it the restored data is unreadable
ciphertext. Then:

```sh
# Postgres (custom-format dump)
docker compose exec -T postgres pg_restore -U convex -d <db> --clean postgres.dump

# Convex
docker compose run --rm setup bash -lc \
  "cd /app/packages/convex && bunx convex import --path /backup/convex.zip"
```

Then run `docker compose run --rm setup` to refresh the deployment and the
well-known document.
