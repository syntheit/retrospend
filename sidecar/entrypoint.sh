#!/bin/sh
# The sidecar's entrypoint. The container is given the database superuser's
# URL (DATABASE_URL, POSTGRES_PASSWORD); the sidecar itself only needs the
# owner role's. This script asks `sidecar owner-url` for the URL to use (it
# derives the owner's password, waits for the app to create the role and hand
# over the objects), then replaces itself with the sidecar and an environment
# of only the names the sidecar reads, with DATABASE_URL set to that URL. The
# superuser's credentials are not in the sidecar's /proc/1/environ.
#
# `sidecar owner-url` falls back to the URL as given only when the owner role
# does not exist (an app image that never creates it), or when the URL is not
# a superuser's. It never falls back on a timeout: the container stops and
# restarts instead.
#
# Everything this script runs is root-owned and not writable by the sidecar's
# user (see the Dockerfile), because a restart keeps the writable layer.
set -eu

here=$(dirname "$0")

echo "Preparing the database connection..." >&2
if ! owner_url=$("$here/sidecar" owner-url); then
  echo "Could not prepare the database connection. The sidecar is not started." >&2
  exit 1
fi
if [ -z "$owner_url" ]; then
  echo "No database URL was produced. The sidecar is not started." >&2
  exit 1
fi

# The names the sidecar and pg_dump read, and what the platform needs.
ALLOWED="PATH HOME HOSTNAME TZ LANG LC_ALL
SSL_CERT_FILE SSL_CERT_DIR
HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy
PGSSLMODE PGSSLROOTCERT PGSSLCERT PGSSLKEY PGSSLCRL PGCONNECT_TIMEOUT
WORKER_API_KEY DEFAULT_TIME_ZONE LOG_LEVEL
BACKUP_DIR BACKUP_RETENTION_DAYS BACKUP_CRON BACKUP_AGE_RECIPIENT
OLLAMA_ENDPOINT LLM_MODEL ENRICH_BATCH_SIZE ENRICH_CONCURRENCY PDF_CONCURRENCY
OPENROUTER_API_KEY OPENROUTER_MODEL
SCHEMA_CACHE_PATH ENRICHMENT_CACHE_PATH"
# Dropped without a mention: the superuser's settings and shell bookkeeping.
QUIET="DATABASE_URL DATABASE_OWNER_PASSWORD POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB_NAME POSTGRES_DB
SIDECAR_OWNER_ROLE_WAIT_SECONDS SIDECAR_OWNER_READY_WAIT_SECONDS PWD OLDPWD SHLVL _"

# One space between names, so the case patterns below match.
ALLOWED=$(echo $ALLOWED)
QUIET=$(echo $QUIET)

# Prepend each assignment to the command (the positional parameters), so the
# command stays last: `env -i NAME=value ... command args`.
for name in $ALLOWED; do
  eval "present=\${$name+yes}"
  if [ -n "$present" ]; then
    eval "value=\$$name"
    set -- "$name=$value" "$@"
  fi
done

dropped=""
for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
  case " $ALLOWED $QUIET " in
    *" $name "*) ;;
    *) dropped="$dropped $name" ;;
  esac
done
if [ -n "$dropped" ]; then
  echo "Not passed to the sidecar (names only; add one to ALLOWED in entrypoint.sh if it reads it):$dropped" >&2
fi

echo "Starting the sidecar..." >&2
exec env -i "DATABASE_URL=$owner_url" "$@"
