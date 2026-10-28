// Turns on remote notifications for iOS: the aps-environment entitlement.
// expo-notifications' own config plugin is not used because it also writes
// Android manifest entries and its Android half is Firebase Cloud Messaging
// (banned in google-free.json); the library itself is linked on iOS only
// (package.json, expo.autolinking.android.exclude).
//
// "development" is the APNs sandbox (Xcode debug builds). Release archives
// and TestFlight builds use "production": Xcode re-signs with the
// distribution profile, and their device tokens belong to the production APNs
// host. The environment comes from RETROSPEND_APNS_ENV (ios-mini.sh sets it
// for debug builds), so the entitlement and the apnsSandbox flag the app
// registers with (app.config.ts, extra.apnsSandbox) can never disagree.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withIosPush(config, props = {}) {
	const mode = props.mode === "development" ? "development" : "production";
	return withEntitlementsPlist(config, (c) => {
		c.modResults["aps-environment"] = mode;
		return c;
	});
};
