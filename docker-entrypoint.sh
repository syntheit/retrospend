#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Wait for database to be ready
while ! nc -z postgres 5432; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "Database is ready!"

# Apply any pending database migrations
echo "Applying database migrations..."
pnpm prisma migrate deploy
echo "Database migrations applied successfully!"

echo "Starting application..."
exec "$@"
