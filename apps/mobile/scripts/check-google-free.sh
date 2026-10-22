#!/usr/bin/env bash
# Prints the resolved Android dependency tree (debug and release runtime
# classpaths) and fails if a Google services artifact is in it: any group
# that starts with a prefix in google-free.json (shared with the jest guard).
# Run after `expo prebuild -p android`, inside `nix develop .#android` or on
# any machine with JDK 17 and the Android SDK (CI).
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

# "com.google.android.gms" matches com.google.android.gms:play-services-base
# and com.google.android.gms.foo:bar, never com.google.android.material.
pattern=$(node -e '
  const rules = require(process.argv[1]);
  const prefixes = rules.mavenPrefixes.map((r) => r.prefix.replaceAll(".", "\\."));
  console.log("(^|[^A-Za-z0-9_.])(" + prefixes.join("|") + ")[.:]");
' "$app/google-free.json")

if hits=$(grep -E "$pattern" "$tree"); then
  echo >&2
  echo "FAIL: Google services artifacts in the Android dependency tree:" >&2
  echo "$hits" | sed -E 's/^[ |+\\-]*//' | sort -u >&2
  exit 1
fi
echo
echo "OK: no Google services artifacts (prefixes: $(node -p 'require(process.argv[1]).mavenPrefixes.map((r) => r.prefix).join(", ")' "$app/google-free.json"))"
