// The Android minimum is 26, not the 24 React Native's catalog declares.
// expo-modules-core uses java.nio.file.Path (API 26) while it installs its
// modules, so on Android 7 the app installs and then crashes at launch with
// "Cannot find native module". Declaring 26 stops those devices from
// installing it. expo-root-project keeps a minSdkVersion that is already set
// on the root project, so the line goes in front of that plugin in the root
// build.gradle.
const { withProjectBuildGradle } = require("expo/config-plugins");

const MIN_SDK = 26;
const MARKER = "// retrospend: min sdk (plugins/with-android-min-sdk.js)";

/** The root build.gradle's text with the minimum set once, before expo-root-project. */
function setMinSdk(source) {
	if (source.includes(MARKER)) return source;
	const apply = 'apply plugin: "expo-root-project"';
	if (!source.includes(apply)) {
		throw new Error("root build.gradle has no expo-root-project plugin");
	}
	return source.replace(
		apply,
		`${MARKER}\next.minSdkVersion = ${MIN_SDK}\n\n${apply}`,
	);
}

module.exports = (config) =>
	withProjectBuildGradle(config, (mod) => {
		mod.modResults.contents = setMinSdk(mod.modResults.contents);
		return mod;
	});
module.exports.setMinSdk = setMinSdk;
module.exports.MIN_SDK = MIN_SDK;
