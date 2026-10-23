#!/usr/bin/env bash
# Signing setup on the Mac mini, sourced by ios-mini.sh before a device
# build. Over ssh the login keychain is locked, so Xcode cannot store the
# development certificate's private key there ("User interaction is not
# allowed"). This keeps the Apple Development identity in a keychain of its
# own, unlocked with a random password that never leaves the mini:
#
#   ~/Library/Keychains/retrospend-signing.keychain-db
#   ~/rs-ios/signing/keychain.pass (mode 600)
#
# The certificate is requested and the iPhone registered through the App
# Store Connect API with the key in ~/.appstoreconnect/env. Xcode's automatic
# signing then finds the identity and only has to make the profile.

signing_dir=$HOME/rs-ios/signing
keychain=$HOME/Library/Keychains/retrospend-signing.keychain-db
wwdr_g3=https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer

# Calls the App Store Connect API: asc METHOD PATH [JSON]. Prints the
# response body; fails on an HTTP error. The token is an ES256 JWT, valid for
# ten minutes, signed in-process from the .p8.
asc() {
	(
		set -a
		# shellcheck disable=SC1091
		source "$HOME/.appstoreconnect/env"
		set +a
		node -e '
			const crypto = require("node:crypto");
			const fs = require("node:fs");
			const [method, path, body] = process.argv.slice(1);
			const env = process.env;
			const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
			const now = Math.floor(Date.now() / 1000);
			const head = enc({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" });
			const claims = enc({ iss: env.ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
			const sig = crypto.sign("sha256", Buffer.from(`${head}.${claims}`), {
				key: fs.readFileSync(env.ASC_KEY_PATH),
				dsaEncoding: "ieee-p1363",
			}).toString("base64url");
			fetch(`https://api.appstoreconnect.apple.com${path}`, {
				method,
				headers: { authorization: `Bearer ${head}.${claims}.${sig}`, "content-type": "application/json" },
				body: body || undefined,
			}).then(async (res) => {
				const text = await res.text();
				if (!res.ok) {
					console.error(`App Store Connect ${method} ${path}: ${res.status} ${text}`);
					process.exit(1);
				}
				process.stdout.write(text);
			});
		' "$@"
	)
}

json() { node -e "const d = JSON.parse(require('node:fs').readFileSync(0, 'utf8')); console.log($1)"; }

signing_keychain() {
	mkdir -p "$signing_dir" && chmod 700 "$signing_dir"
	local pass_file=$signing_dir/keychain.pass
	if [[ ! -f "$keychain" ]]; then
		(umask 077 && openssl rand -hex 24 >"$pass_file")
		security create-keychain -p "$(cat "$pass_file")" "$keychain"
		# No auto-lock: builds run at any hour.
		security set-keychain-settings "$keychain"
		curl -fsS -o "$signing_dir/AppleWWDRCAG3.cer" "$wwdr_g3"
		security import "$signing_dir/AppleWWDRCAG3.cer" -k "$keychain"
	fi
	security unlock-keychain -p "$(cat "$pass_file")" "$keychain"
	# Keep the user's keychains and add this one; the search list is how
	# Xcode and codesign find the identity.
	local -a list
	mapfile -t list < <(security list-keychains -d user | sed -e 's/^ *"//' -e 's/"$//')
	[[ " ${list[*]} " == *" $keychain "* ]] ||
		security list-keychains -d user -s "${list[@]}" "$keychain"
}

# The identity's SHA-1, if it exists and codesign can really sign with it.
# find-identity alone is not enough: it calls a key "valid" that codesign
# then refuses (errSecInternalComponent).
signing_usable() {
	local id probe
	id=$(security find-identity -v -p codesigning "$keychain" |
		awk '/Apple Development/ { print $2; exit }')
	[[ -n "$id" ]] || return 1
	probe=$(mktemp "$signing_dir/probe.XXXXXX")
	cp /usr/bin/true "$probe"
	codesign --force --sign "$id" "$probe" 2>/dev/null || id=
	rm -f "$probe"
	[[ -n "$id" ]] && echo "$id"
}

# An Apple Development identity in our keychain, or a new one: a fresh RSA
# key and CSR here, the certificate from the API, both imported as one
# PKCS#12 (a bare PEM key imports with attributes codesign rejects).
signing_identity() {
	signing_usable >/dev/null && return
	# An identity that exists but cannot sign is a session problem (plain
	# ssh, not launchctl asuser); a new certificate would not fix it.
	if security find-identity -p codesigning "$keychain" | grep -q "Apple Development"; then
		echo "codesign cannot use the identity in $keychain; run through ios-build.sh" >&2
		return 1
	fi
	echo "Requesting an Apple Development certificate"
	local tmp body p12pass
	tmp=$(mktemp -d "$signing_dir/new.XXXXXX")
	# The system's LibreSSL writes PKCS#12 that `security import` reads.
	local ssl=/usr/bin/openssl
	$ssl genrsa -out "$tmp/key.pem" 2048 2>/dev/null
	$ssl req -new -key "$tmp/key.pem" -subj "/CN=Retrospend Mac mini" -out "$tmp/req.csr"
	body=$(node -e 'console.log(JSON.stringify({ data: { type: "certificates",
		attributes: { certificateType: "DEVELOPMENT",
			csrContent: require("node:fs").readFileSync(process.argv[1], "utf8") } } }))' \
		"$tmp/req.csr")
	asc POST /v1/certificates "$body" |
		json 'd.data.attributes.certificateContent' | base64 -d >"$tmp/cert.cer"
	$ssl x509 -inform der -in "$tmp/cert.cer" -out "$tmp/cert.pem"
	p12pass=$($ssl rand -hex 16)
	$ssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
		-out "$tmp/id.p12" -passout "pass:$p12pass"
	security import "$tmp/id.p12" -k "$keychain" -P "$p12pass" -f pkcs12 \
		-T /usr/bin/codesign -T /usr/bin/security
	# Lets codesign use the key without a GUI prompt.
	security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
		-k "$(cat "$signing_dir/keychain.pass")" "$keychain" >/dev/null
	rm -rf "$tmp"
	signing_usable || {
		echo "The new identity cannot sign; see ~/rs-ios/signing" >&2
		return 1
	}
}

# The phone must be in the team's device list for the profile to include
# it. Xcode can register it too, but only for a connected destination.
signing_device() {
	local udid=$1 found
	found=$(asc GET "/v1/devices?filter%5Budid%5D=$udid" | json 'd.data.length')
	if [[ "$found" == 0 ]]; then
		echo "Registering device $udid"
		asc POST /v1/devices "{\"data\":{\"type\":\"devices\",\"attributes\":{\"name\":\"Daniel's iPhone 15\",\"udid\":\"$udid\",\"platform\":\"IOS\"}}}" >/dev/null
	fi
}
