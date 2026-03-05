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

# Try to migrate, capturing output
if ! pnpm prisma migrate deploy > /tmp/migrate.log 2>&1; then
  cat /tmp/migrate.log
  
  # Check for P3009 (failed migrations) — roll back the failed one and retry
  if grep -q "P3009" /tmp/migrate.log; then
    FAILED_MIGRATION=$(grep "The \`" /tmp/migrate.log | sed "s/.*The \`\(.*\)\` migration.*/\1/" | head -n 1)
    if [ -n "$FAILED_MIGRATION" ]; then
      echo "Found failed migration: $FAILED_MIGRATION. Rolling back and retrying..."
      pnpm prisma migrate resolve --rolled-back "$FAILED_MIGRATION"
      pnpm prisma migrate deploy
      echo "Database migrations applied successfully after rollback!"
    else
      echo "Migration failed (P3009) but could not parse migration name."
      exit 1
    fi

  # Check for P3005 (Schema not empty) which indicates we need to baseline
  elif grep -q "P3005" /tmp/migrate.log; then
    echo "Database schema is not empty (Error P3005). Attempting to baseline..."

    # Get the first migration directory name (exclude files like migration_lock.toml)
    FIRST_MIGRATION=$(ls -d prisma/migrations/*/  2>/dev/null | head -n 1 | xargs basename 2>/dev/null)

    if [ -n "$FIRST_MIGRATION" ]; then
      echo "Marking baseline migration as applied: $FIRST_MIGRATION"
      if pnpm prisma migrate resolve --applied "$FIRST_MIGRATION"; then
        echo "Baseline migration resolved. Retrying migrations..."
        pnpm prisma migrate deploy
        echo "Database migrations applied successfully after baseline!"
      else
        echo "Failed to resolve baseline migration."
        exit 1
      fi
    else
      echo "Error: No migration files found in prisma/migrations."
      exit 1
    fi
  else
    echo "Migration failed. Please check the logs above."
    exit 1
  fi
else
  echo "Database migrations applied successfully!"
fi

echo "Starting application..."
exec "$@"
