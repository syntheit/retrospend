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
  
  # Check for P3005 (Schema not empty) which indicates we need to baseline
  if grep -q "P3005" /tmp/migrate.log; then
    echo "Database schema is not empty (Error P3005). Attempting to baseline..."
    
    # Get the first migration name dynamically
    FIRST_MIGRATION=$(ls prisma/migrations | sort | head -n 1)
    
    if [ -n "$FIRST_MIGRATION" ]; then
      echo "Marking baseline migration as applied: $FIRST_MIGRATION"
      if pnpm prisma migrate resolve --applied "$FIRST_MIGRATION"; then
        echo "Baseline migration resolved. Verifying..."
        pnpm prisma migrate deploy
        echo "Database migrations baseline resolved successfully!"
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
