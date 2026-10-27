// Signs the Android release build with the app key when scripts/android-release.sh
// provides one. The key and its passwords never enter the generated project:
// Gradle reads KEYSTORE_FILE, KEY_ALIAS and the two *_PASSWORD_FILE paths from
// the environment while it runs. Without KEYSTORE_FILE the release build keeps
// the template's debug signing, so a plain `assembleRelease` still works.
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING_CONFIG = `        release {
            def keystoreFile = System.getenv('KEYSTORE_FILE')
            if (keystoreFile) {
                storeFile file(keystoreFile)
                storePassword new File(System.getenv('KEYSTORE_PASSWORD_FILE')).text.trim()
                keyAlias System.getenv('KEY_ALIAS')
                keyPassword new File(System.getenv('KEY_PASSWORD_FILE')).text.trim()
            }
        }
`;
const DEBUG_SIGNING_BLOCK =
	/(    signingConfigs \{\n        debug \{[\s\S]*?\n        \}\n)/;
const RELEASE_USES_DEBUG =
	/(        release \{\n[^\n]*\n[^\n]*\n)            signingConfig signingConfigs\.debug\n/;

function addReleaseSigning(src) {
	if (src.includes("System.getenv('KEYSTORE_FILE')")) return src;
	if (!DEBUG_SIGNING_BLOCK.test(src) || !RELEASE_USES_DEBUG.test(src)) {
		throw new Error(
			"android/app/build.gradle no longer matches the Expo template; update plugins/with-android-release-signing.js",
		);
	}
	return src
		.replace(DEBUG_SIGNING_BLOCK, `$1${SIGNING_CONFIG}`)
		.replace(
			RELEASE_USES_DEBUG,
			"$1            signingConfig System.getenv('KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug\n",
		);
}

function withAndroidReleaseSigning(config) {
	return withAppBuildGradle(config, (mod) => {
		if (mod.modResults.language !== "groovy") {
			throw new Error("Expected a Groovy app build.gradle");
		}
		mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
		return mod;
	});
}

module.exports = withAndroidReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
