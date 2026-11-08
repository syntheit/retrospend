#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Wait for database to be ready
while ! nc -z postgres 5432; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "Database is ready!"

# All the database work, in one step (scripts/db-owner):
#   - with a superuser URL, create the retrospend_owner role and hand it the
#     objects (prisma/bootstrap);
#   - run the migrations as that role, with the P3009 and P3005 recovery. The
#     role holds CREATE on the database for that long only;
#   - apply the grants file as that role. A database restored from a dump made
#     with --no-privileges has every table back with no grants, and its
#     migration table says nothing is pending, so this runs on every start.
# It prints the owner's URL, or nothing when DATABASE_URL should stay as it is
# (a URL that is not a superuser's, or a superuser with no password). A failure
# stops the start.
OWNER_DATABASE_URL=$(node scripts/db-owner/cli.mjs prepare)
if [ -n "$OWNER_DATABASE_URL" ]; then
  # Replaces the superuser's URL.
  export DATABASE_URL="$OWNER_DATABASE_URL"
fi
unset OWNER_DATABASE_URL
# Nothing below needs the superuser's credentials.
unset POSTGRES_PASSWORD POSTGRES_USER DATABASE_OWNER_PASSWORD

# The app gets an allowlisted environment: the names it reads, with
# DATABASE_URL as set above. POSTGRES_PASSWORD, the superuser's URL and
# anything else this container was given never reach it. Assigned first so a
# failure stops the start (a failing command inside eval would not).
APP_EXEC=$(node scripts/db-owner/cli.mjs app-exec)

echo "Starting application..."
eval "$APP_EXEC"
unset APP_EXEC
exec "$@"
