#!/usr/bin/env bash
#
# Copy the PRODUCTION database into the LOCAL dev database.
#
#   - Prod is read STRICTLY read-only (pg_dump). This script never writes prod.
#   - The dev db is wiped and replaced with a fresh copy of current prod.
#     ("reset dev to prod" and "refresh dev with latest prod" are the same op.)
#   - Streams prod -> dev directly; no host psql tools, no temp files.
#
# Usage:  pnpm db:up   (once, to start the dev db)
#         pnpm db:sync-prod
#
set -euo pipefail

PROD_CONTAINER="retrospend_postgres"   # production Postgres (docker network only)
DEV_CONTAINER="retrospend_dev_db"      # local dev Postgres (docker-compose.dev.yml)
DEV_DB="retrospend_dev"
DEV_USER="retrospend"
DEV_PASSWORD="retrospend_dev"

# --- Safety guards: the write target must be the dev container, never prod ---
if [ "$DEV_CONTAINER" = "$PROD_CONTAINER" ] || [ "$DEV_DB" = "postgres" ]; then
  echo "REFUSING: dev target looks like production." >&2
  exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$PROD_CONTAINER"; then
  echo "Production container '$PROD_CONTAINER' is not running — nothing to copy from." >&2
  exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$DEV_CONTAINER"; then
  echo "Dev db '$DEV_CONTAINER' is not running. Start it first:  pnpm db:up" >&2
  exit 1
fi

# Prod uses a dedicated 'retrospend_app' role for row-level security. It's a
# cluster role (not included in a single-db dump), so create it in dev first
# — otherwise the restored GRANT/policy statements error. Harmless if it exists.
docker exec "$DEV_CONTAINER" psql -U "$DEV_USER" -d "$DEV_DB" \
  -c "CREATE ROLE retrospend_app;" >/dev/null 2>&1 || true

echo "Copying production -> dev db '$DEV_DB' (prod is read-only)..."

# Plain-SQL dump with DROP-IF-EXISTS so it cleanly replaces existing dev objects,
# piped straight into the dev container's psql.
docker exec "$PROD_CONTAINER" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" --clean --if-exists --no-owner --no-privileges "$POSTGRES_DB"' \
| docker exec -i "$DEV_CONTAINER" sh -c \
  "PGPASSWORD='$DEV_PASSWORD' psql -q -v ON_ERROR_STOP=0 -U '$DEV_USER' -d '$DEV_DB'" >/dev/null

echo "Done. Dev db now mirrors production."
echo "Layer any in-progress migrations on top with:  pnpm prisma migrate dev"
