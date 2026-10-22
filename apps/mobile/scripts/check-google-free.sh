#!/usr/bin/env bash
# Prints the resolved Android dependency tree (debug and release runtime
# classpaths) and fails if a Google services artifact is in it. The banned
# Maven groups live in google-free.json, shared with the jest guard.
# Run after `expo prebuild -p android`, inside `nix develop .#android`.
set -euo pipefail

app=$(cd "$(dirname "$0")/.." && pwd)
cd "$app/android"

tree=$(mktemp)
trap 'rm -f "$tree"' EXIT
for configuration in debugRuntimeClasspath releaseRuntimeClasspath; do
  echo "== :app:dependencies --configuration $configuration" >>"$tree"
  ./gradlew -q :app:dependencies --configuration "$configuration" >>"$tree"
done
cat "$tree"

pattern=$(node -e '
  const rules = require(process.argv[1]);
  console.log(rules.maven.map((r) => r.group.replaceAll(".", "\\.") + ":").join("|"));
' "$app/google-free.json")

if hits=$(grep -E "$pattern" "$tree"); then
  echo >&2
  echo "FAIL: Google services artifacts in the Android dependency tree:" >&2
  echo "$hits" | sed -E 's/^[ |+\\-]*//' | sort -u >&2
  exit 1
fi
echo
echo "OK: no Google services artifacts (groups: ${pattern//\\/})"
