#!/bin/bash
# Runs once on first init of the PRIMARY (via /docker-entrypoint-initdb.d).
# Creates the streaming-replication role and opens pg_hba for replication.
set -e

echo "[primary-init] creating replication role '${PG_REPLICATION_USER}'"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE "${PG_REPLICATION_USER}" WITH REPLICATION LOGIN PASSWORD '${PG_REPLICATION_PASSWORD}';
EOSQL

echo "[primary-init] allowing replication connections in pg_hba.conf"
{
  echo "host replication ${PG_REPLICATION_USER} 0.0.0.0/0 scram-sha-256"
  echo "host replication ${PG_REPLICATION_USER} ::/0       scram-sha-256"
} >> "$PGDATA/pg_hba.conf"

# Pick up the pg_hba change immediately (also re-read on the final restart)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "SELECT pg_reload_conf();"

echo "[primary-init] done"
