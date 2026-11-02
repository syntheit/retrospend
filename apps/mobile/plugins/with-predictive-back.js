// Predictive back only where React Native can serve it.
//
// With android:enableOnBackInvokedCallback on, React Native 0.88 registers
// its back callback only on Android 16 (API 36) and up. On Android 15 the
// flag turns the system Back into "leave the app", and the framework's old
// back path (onBackPressed) is off. So the flag cannot be a constant: the
// manifest points at a boolean resource that is false by default and true in
// values-v36, and Android picks the value for the device. Every older
// version keeps today's back exactly.
//
// Expo writes the attribute itself from android.predictiveBackGestureEnabled
// (false in app.config.ts); this plugin replaces its value with the resource.
const fs = require("node:fs");
const path = require("node:path");
const {
	withAndroidManifest,
	withDangerousMod,
} = require("expo/config-plugins");

const NAME = "retrospend_predictive_back";
const ATTRIBUTE = "android:enableOnBackInvokedCallback";

/** A values file holding the one boolean. */
function valuesXml(value) {
	return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <bool name="${NAME}">${value}</bool>
</resources>
`;
}

function withResources(config) {
	return withDangerousMod(config, [
		"android",
		(mod) => {
			const res = path.join(
				mod.modRequest.platformProjectRoot,
				"app/src/main/res",
			);
			for (const [dir, value] of [
				["values", "false"],
				["values-v36", "true"],
			]) {
				fs.mkdirSync(path.join(res, dir), { recursive: true });
				fs.writeFileSync(path.join(res, dir, `${NAME}.xml`), valuesXml(value));
			}
			return mod;
		},
	]);
}

/** Points the application's flag at the resource. */
function setAttribute(manifest) {
	const application = manifest.manifest.application?.[0];
	if (!application) throw new Error("AndroidManifest has no <application>");
	application.$[ATTRIBUTE] = `@bool/${NAME}`;
	return manifest;
}

function withAttribute(config) {
	return withAndroidManifest(config, (mod) => {
		mod.modResults = setAttribute(mod.modResults);
		return mod;
	});
}

module.exports = (config) => withAttribute(withResources(config));
module.exports.setAttribute = setAttribute;
module.exports.valuesXml = valuesXml;
module.exports.NAME = NAME;
