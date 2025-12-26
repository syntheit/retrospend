#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Wait for database to be ready
while ! nc -z postgres 5432; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "Database is ready!"

# Check if database has our schema
# Try to query a known table - if it fails, assume schema needs to be created
CHECK_SQL_FILE=$(mktemp)
echo "SELECT 1 FROM \"user\" LIMIT 1;" > "$CHECK_SQL_FILE"

if ! pnpm prisma db execute --file "$CHECK_SQL_FILE" >/dev/null 2>&1; then
  echo "Database schema not found, pushing schema..."
  pnpm prisma db push
  echo "Database schema pushed successfully!"
else
  echo "Database schema already exists, skipping schema push."
fi

rm -f "$CHECK_SQL_FILE"

echo "Starting application..."
exec "$@"
