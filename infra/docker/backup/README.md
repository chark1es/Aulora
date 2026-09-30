# Aulora backup runner

The optional `backups` Compose profile creates a Postgres dump, a Convex snapshot including uploaded files, and an encryption manifest, then uploads them to S3/MinIO. The manifest has no encryption key.

The current operator procedure is [backups and restore](../../../apps/docs/content/backups.md). Use that guide for recovery commands. Logical Convex import and raw Postgres recovery are alternative strategies; do not apply both to the same deployment.

From `infra/docker`:

```sh
docker compose --profile backups up -d --build
docker compose --profile backups run --rm -e BACKUP_RUN_ONCE=1 backup
docker compose logs --tail=100 backup
```

The default backup bucket is on the live MinIO instance. Keep an off-machine copy and a separately secured backup of `.env` and the encryption key. Backups contain sensitive account metadata even when content is encrypted.

The runner waits for setup, generates its result-recording token if absent, and schedules work at `BACKUP_HOUR_UTC`. Pass one-off container settings with Compose `-e`. Local retention does not configure remote retention.

Run planning and shell-invocation tests without Docker:

```sh
node --test infra/docker/backup/test/*.test.mjs
```
