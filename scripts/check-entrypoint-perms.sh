#!/bin/sh
# Run inside the built image, as its default user (nextjs):
#   docker run --rm --entrypoint sh <image> scripts/check-entrypoint-perms.sh
#
# The entrypoint holds the database superuser's credentials while it prepares
# the database, and a container restart keeps the writable layer. So every file
# it runs must belong to root and be unwritable by the user the app runs as.
# Prints each offending path and exits 1; prints nothing and exits 0 when clean.
set -u

cd /app || exit 2

if [ "$(id -u)" = "0" ]; then
  echo "Run this as the image's default user, not root: it asks what that user can write." >&2
  exit 2
fi

paths="node_modules prisma scripts package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts tsconfig.json docker-entrypoint.sh"
bad=""

for path in $paths; do
  # Not owned by root.
  not_root=$(find "$path" ! -user root 2>/dev/null)
  [ -n "$not_root" ] && bad="$bad
$not_root"
  # Writable by the current user (symlinks are followed by test -w, so skip them).
  writable=$(find "$path" ! -type l 2>/dev/null | while read -r file; do
    [ -w "$file" ] && echo "$file"
  done)
  [ -n "$writable" ] && bad="$bad
$writable"
done

if [ -n "$bad" ]; then
  echo "Not root-owned, or writable by $(id -un):$bad" | sort -u
  exit 1
fi
