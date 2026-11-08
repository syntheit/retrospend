#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Wait for database to be ready
while ! nc -z postgres 5432; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "Database is ready!"

# With a superuser URL, create the retrospend_owner role and hand it the
# objects (prisma/bootstrap), then run everything below, and the app, as that
# role. It prints the owner's URL, or nothing when DATABASE_URL should stay as
# it is (a URL that is not a superuser's, or a superuser with no password).
# The superuser URL is not exported anywhere after this line.
echo "Preparing the database role..."
OWNER_DATABASE_URL=$(node scripts/db-owner/cli.mjs bootstrap)
if [ -n "$OWNER_DATABASE_URL" ]; then
  export DATABASE_URL="$OWNER_DATABASE_URL"
fi
unset OWNER_DATABASE_URL

# Apply any pending database migrations
echo "Applying database migrations..."

# Try to migrate, capturing output
if ! ./node_modules/.bin/prisma migrate deploy > /tmp/migrate.log 2>&1; then
  cat /tmp/migrate.log
  
  # Check for P3009 (failed migrations): roll back the failed one and retry
  if grep -q "P3009" /tmp/migrate.log; then
    FAILED_MIGRATION=$(grep "The \`" /tmp/migrate.log | sed "s/.*The \`\(.*\)\` migration.*/\1/" | head -n 1)
    if [ -n "$FAILED_MIGRATION" ]; then
      echo "Found failed migration: $FAILED_MIGRATION. Rolling back and retrying..."
      ./node_modules/.bin/prisma migrate resolve --rolled-back "$FAILED_MIGRATION"
      ./node_modules/.bin/prisma migrate deploy
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
      if ./node_modules/.bin/prisma migrate resolve --applied "$FIRST_MIGRATION"; then
        echo "Baseline migration resolved. Retrying migrations..."
        ./node_modules/.bin/prisma migrate deploy
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

# Give the app role its privileges. A database restored from a dump made with
# --no-privileges has every table back with no grants, and its migration table
# says nothing is pending, so this runs on every start. Safe to repeat.
echo "Applying database grants..."
./node_modules/.bin/prisma db execute --file prisma/grants/app-role.sql

# The app gets an allowlisted environment: the names it reads, with
# DATABASE_URL as set above. POSTGRES_PASSWORD, the superuser's URL and
# anything else this container was given never reach it. Assigned first so a
# failure stops the start (a failing command inside eval would not).
APP_EXEC=$(node scripts/db-owner/cli.mjs app-exec)

echo "Starting application..."
eval "$APP_EXEC"
unset APP_EXEC
exec "$@"
