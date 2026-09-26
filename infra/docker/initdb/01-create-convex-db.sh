#!/usr/bin/env bash
# Creates the Convex database named after INSTANCE_NAME.
#
# Convex derives its Postgres database name from INSTANCE_NAME by replacing
# dashes with underscores (aulora-team -> aulora_team). We start a temporary
# PostgreSQL server on a private Unix socket inside this container and connect
# to the real server over TCP as POSTGRES_USER.
#
# Idempotent: skips creation when the database already exists. Runs once, on
# first stack creation (Postgres only executes initdb scripts on an empty
# data directory). The compose stack gates the Convex backend on this
# service completing successfully.
set -euo pipefail

INSTANCE_NAME="${INSTANCE_NAME:-aulora}"
DATABASE_NAME="${INSTANCE_NAME//-/_}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
WORKDIR="$(mktemp -d)"
export PGDATA="$WORKDIR/data"
mkdir -p "$PGDATA"

if [ "$DATABASE_NAME" = "postgres" ]; then
  echo "create-convex-db: instance name resolves to 'postgres'; nothing to create"
  exit 0
fi

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "create-convex-db: preparing for database '${DATABASE_NAME}'"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -o "-c listen_addresses='' -c unix_socket_directories='$WORKDIR' -c fsync=off -c synchronous_commit=off" -w start >/dev/null

exists="$(
  PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
    "host=$PGHOST port=$PGPORT user=$POSTGRES_USER dbname=postgres" \
    -tAc "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'"
)"
if [ "$exists" = "1" ]; then
  echo "create-convex-db: database '${DATABASE_NAME}' already exists"
else
  PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
    "host=$PGHOST port=$PGPORT user=$POSTGRES_USER dbname=postgres" \
    -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"$DATABASE_NAME\""
  echo "create-convex-db: created database '${DATABASE_NAME}'"
fi
