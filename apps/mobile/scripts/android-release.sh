#!/usr/bin/env bash
# Builds a signed Android release APK and publishes it into the private
# F-Droid repo ("Retrospend dev"). Run from the repo root on harbor, in the
# flake's android shell (the NixOS command `retrospend-fdroid-release` wraps it):
#
#   nix develop .#android -c bash apps/mobile/scripts/android-release.sh
#
# Needs (all outside git; secrets by file, never by argument):
#   FDROID_DIR              repo working dir; the served repo is $FDROID_DIR/repo.
#                           Set up on first run.
#   KEYSTORE_FILE           the app signing keystore
#   KEYSTORE_PASSWORD_FILE  file holding its password
#   KEY_ALIAS               key alias inside it (default retrospend)
#   KEY_PASSWORD_FILE       file holding the key password
# Optional:
#   FDROID_REPO_URL         where phones fetch the repo
#                           (default https://fdroid.retrospend.app/repo)
#   RETROSPEND_ABIS         native ABIs to build (default arm64-v8a: phones only)
set -euo pipefail
# Never trace: signing passwords live in files and reach tools through file
# options or a child's environment, never through argv or trace output.
set +o xtrace
# The served repo must stay readable by the web server; secrets below are
# created with 077.
umask 022

app=$(cd "$(dirname "$0")/.." && pwd)
tree=$(git -C "$app" rev-parse --show-toplevel)
: "${FDROID_DIR:?set FDROID_DIR}" "${KEYSTORE_FILE:?set KEYSTORE_FILE}"
: "${KEYSTORE_PASSWORD_FILE:?set KEYSTORE_PASSWORD_FILE}" "${KEY_PASSWORD_FILE:?set KEY_PASSWORD_FILE}"
export KEYSTORE_FILE KEYSTORE_PASSWORD_FILE KEY_PASSWORD_FILE
export KEY_ALIAS=${KEY_ALIAS:-retrospend}

# Secrets and published output stay out of the git tree, where `git add -A`
# would pick them up.
for p in "$FDROID_DIR" "$KEYSTORE_FILE" "$KEYSTORE_PASSWORD_FILE" "$KEY_PASSWORD_FILE"; do
	case "$(realpath -m "$p")/" in "$tree"/*)
		echo "refusing $p: it is inside the repository ($tree)" >&2
		exit 1
		;;
	esac
done
repo_url=${FDROID_REPO_URL:-https://fdroid.retrospend.app/repo}
app_id=app.retrospend

# The commit count is the build number, so every commit that ships is newer
# than the last (app.config.ts reads it as versionCode).
export RETROSPEND_BUILD_NUMBER
RETROSPEND_BUILD_NUMBER=$(git -C "$tree" rev-list --count HEAD)
echo "building $app_id build $RETROSPEND_BUILD_NUMBER"

cd "$app"
# android/ is generated (continuous native generation) and never committed.
CI=1 pnpm exec expo prebuild --platform android --clean --no-install

# One ABI by default: the Pixel is arm64, and each extra ABI doubles the
# native compile. Gradle's memory stays bounded on shared machines.
(cd android && ./gradlew --no-daemon -Dorg.gradle.jvmargs=-Xmx4g \
	"-PreactNativeArchitectures=${RETROSPEND_ABIS:-arm64-v8a}" assembleRelease)

# Release must stay free of Google services, like the debug build.
bash "$app/scripts/check-google-free.sh" >/dev/null

apk=$app/android/app/build/outputs/apk/release/app-release.apk
[[ -f "$apk" ]] || { echo "no APK at $apk" >&2; exit 1; }
certs=$(apksigner verify --print-certs "$apk")
if grep -q "Android Debug" <<<"$certs"; then
	echo "the APK is signed with the debug key: is the signing plugin active?" >&2
	exit 1
fi
grep -E "Signer #1 certificate (DN|SHA-256)" <<<"$certs"

# First run only: the repo gets its own signing key (not the app key) and the
# app's metadata.
mkdir -p "$FDROID_DIR/repo" "$FDROID_DIR/metadata"
if [[ ! -f "$FDROID_DIR/config.yml" ]]; then
	echo "initialising $FDROID_DIR"
	passfile=$(mktemp "$FDROID_DIR/.pass.XXXXXX")
	trap 'rm -f "$passfile"' EXIT
	openssl rand -hex 24 >"$passfile"
	(umask 077 && keytool -genkeypair -noprompt -keystore "$FDROID_DIR/repo-keystore.p12" \
		-storetype PKCS12 -storepass:file "$passfile" -keypass:file "$passfile" \
		-alias retrospend-repo -keyalg RSA -keysize 4096 -validity 36500 \
		-dname "CN=Retrospend dev fdroid repo" 2>/dev/null)
	pass=$(cat "$passfile")
	rm -f "$passfile"
	# fdroid reads the passwords from here (mode 600) and hands them to its
	# tools through their environment.
	(umask 077 && cat >"$FDROID_DIR/config.yml" <<YML
repo_url: $repo_url
repo_name: Retrospend dev
repo_description: Private dev builds of the Retrospend app.
archive_older: 0
keystore: repo-keystore.p12
repo_keyalias: retrospend-repo
keystorepass: $pass
keypass: $pass
keydname: CN=Retrospend dev fdroid repo
YML
	)
	unset pass
fi
if [[ ! -f "$FDROID_DIR/metadata/$app_id.yml" ]]; then
	cat >"$FDROID_DIR/metadata/$app_id.yml" <<YML
Categories:
  - Money
License: Unknown
Name: Retrospend
Summary: Retrospend dev builds
Description: |-
  Native Retrospend client for the dev server. Signed with the Retrospend
  Android app key; updates arrive through this repo.
YML
fi

install -m 644 "$apk" "$FDROID_DIR/repo/${app_id}_$RETROSPEND_BUILD_NUMBER.apk"
(cd "$FDROID_DIR" && fdroid update)
echo "Repo signing key (add the repo by URL, check this fingerprint):"
keytool -list -keystore "$FDROID_DIR/repo-keystore.p12" -storetype PKCS12 \
	-storepass:file <(grep '^keystorepass:' "$FDROID_DIR/config.yml" | cut -d' ' -f2) \
	-alias retrospend-repo 2>/dev/null | grep -i "fingerprint" || true
echo "published $app_id build $RETROSPEND_BUILD_NUMBER to $FDROID_DIR/repo ($repo_url)"
ls -l "$FDROID_DIR/repo" | grep -E "index|entry|apk"
