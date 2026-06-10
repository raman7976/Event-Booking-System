#!/bin/bash
# Custom entrypoint for the REPLICA. Waits for the primary, takes a base backup
# the first time, configures standby mode, then starts Postgres in recovery.
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

echo "[replica] waiting for primary (postgres_primary:5432) ..."
until pg_isready -h postgres_primary -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done
echo "[replica] primary is ready"

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo "[replica] empty data dir -> running pg_basebackup from primary"
  export PGPASSWORD="$PG_REPLICATION_PASSWORD"
  gosu postgres pg_basebackup \
    -h postgres_primary -p 5432 \
    -U "$PG_REPLICATION_USER" \
    -D "$PGDATA" \
    -Fp -Xs -P

  echo "[replica] configuring standby mode"
  touch "$PGDATA/standby.signal"
  cat >> "$PGDATA/postgresql.auto.conf" <<EOF
primary_conninfo = 'host=postgres_primary port=5432 user=${PG_REPLICATION_USER} password=${PG_REPLICATION_PASSWORD} application_name=replica1'
EOF
else
  echo "[replica] data dir already present -> skipping base backup"
fi

chown -R postgres:postgres "$PGDATA"
chmod 0700 "$PGDATA"

echo "[replica] starting postgres (standby / hot_standby)"
exec gosu postgres postgres
