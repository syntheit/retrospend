#!/usr/bin/env bash
# The TestFlight half of ios-mini.sh, sourced by it for the `testflight`
# target: Release archive, export for App Store Connect, upload. Needs
# $app, $work, $logs, $workspace, $scheme, $bundle_id and scrub() from there.
#
# Signing is Xcode automatic signing driven by the App Store Connect API key
# (~/.appstoreconnect/env), like the device build. The distribution
# certificate and profile come from Apple's cloud signing, so the key's role
# must be Admin or App Manager. The key's values live in subshells only.

archive_dir=$work/archive
archive_path=$archive_dir/Retrospend.xcarchive
export_dir=$archive_dir/export

# Runs xcodebuild with the API key, logs to $logs/xcodebuild-$1.log scrubbed.
xcodebuild_keyed() {
	local name=$1 log=$logs/xcodebuild-$1.log status=0
	shift
	echo "xcodebuild $name ($log)"
	(
		# shellcheck disable=SC1091
		source "$HOME/.appstoreconnect/env"
		RCT_NO_LAUNCH_PACKAGER=1 xcodebuild "$@" \
			-allowProvisioningUpdates \
			-authenticationKeyPath "$ASC_KEY_PATH" \
			-authenticationKeyID "$ASC_KEY_ID" \
			-authenticationKeyIssuerID "$ASC_ISSUER_ID"
	) >"$log" 2>&1 || status=$?
	scrub_all "$log"
	if ((status)); then
		grep -E 'error:|\*\* .* FAILED|Error Domain|NSLocalizedDescription|Could not|No (profile|signing)' "$log" |
			sort -u | head -30 >&2
		return "$status"
	fi
}

# scrub() in ios-mini.sh reads the key values from the caller's environment,
# which holds none; read them here, once, and hide them in the log.
scrub_all() {
	(
		# shellcheck disable=SC1091
		source "$HOME/.appstoreconnect/env"
		scrub "$1"
	)
}

# Does App Store Connect know the bundle id? Without an app record the upload
# is refused, so say so before building for twenty minutes.
asc_app_record() {
	local count
	count=$(asc GET "/v1/apps?filter%5BbundleId%5D=$bundle_id&limit=1" | json 'd.data.length') || return 2
	[[ "$count" != 0 ]]
}

write_export_options() {
	local destination=$1 team
	# Prebuild wrote the team (ios.appleTeamId in app.config.ts) into the project.
	team=$(grep -m1 DEVELOPMENT_TEAM "$(dirname "$workspace")/$scheme.xcodeproj/project.pbxproj" |
		sed -E 's/.*= ([A-Z0-9]+);.*/\1/')
	cat >"$archive_dir/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>$destination</string>
	<key>teamID</key><string>$team</string>
	<key>signingStyle</key><string>automatic</string>
	<key>uploadSymbols</key><true/>
	<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
}

archive_testflight() {
	# shellcheck source=ios-signing.sh
	source "$app/scripts/ios-signing.sh"
	signing_keychain
	signing_identity

	# Only a heads-up here: the record is checked again right before the
	# upload, since it may be created while the build runs.
	asc_app_record || echo "No app record for $bundle_id in App Store Connect yet (Apps, +, New App). The build continues." >&2

	rm -rf "$archive_dir"
	mkdir -p "$archive_dir"
	# Release builds embed the production JS bundle; no Metro, no dev menu.
	xcodebuild_keyed archive archive -workspace "$workspace" -scheme "$scheme" \
		-configuration Release -destination "generic/platform=iOS" \
		-derivedDataPath "$derived" -archivePath "$archive_path"
	echo "Archived: $archive_path"

	# Export to an .ipa first; upload is a separate step so a missing app
	# record or API role leaves a signed .ipa behind to inspect.
	write_export_options export
	retry 4 xcodebuild_keyed export -exportArchive -archivePath "$archive_path" \
		-exportPath "$export_dir" -exportOptionsPlist "$archive_dir/ExportOptions.plist"
	local ipa
	ipa=$(ls "$export_dir"/*.ipa | head -1)
	echo "Exported: $ipa ($(du -h "$ipa" | cut -f1))"

	if ! retry 3 asc_app_record; then
		echo "NOT UPLOADED: no app record for $bundle_id in App Store Connect (or the API key cannot read apps)." >&2
		return 3
	fi
	retry 6 altool_upload "$ipa"
}

# Apple's tools fail now and then on this machine with "Could not connect to
# the server" or a missing Defaults.properties, and succeed on the next try.
retry() {
	local tries=$1 i status=0
	shift
	for ((i = 1; i <= tries; i++)); do
		"$@" && return 0
		status=$?
		((i < tries)) && echo "attempt $i of $tries failed ($status), retrying" >&2 && sleep 20
	done
	return "$status"
}

altool_upload() {
	local log=$logs/altool-upload.log status=0
	(
		# shellcheck disable=SC1091
		source "$HOME/.appstoreconnect/env"
		# altool finds AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys.
		xcrun altool --upload-app -f "$1" -t ios \
			--apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
	) >"$log" 2>&1 || status=$?
	scrub_all "$log"
	grep -E "UPLOAD SUCCEEDED|Delivery UUID|ERROR: .*altool|^Error" "$log" | tail -5
	return "$status"
}
