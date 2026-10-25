// Lets release builds reach plain http servers. Self-hosters often run
// Retrospend on a LAN address without TLS; the owner's call is that they own
// that risk, and the connect screen warns before it saves an http server.
// Android gets a network security config (system and user-installed CAs,
// cleartext allowed); the iOS side is NSAllowsArbitraryLoads in app.config.ts.
const fs = require("node:fs");
const path = require("node:path");
const {
	withAndroidManifest,
	withDangerousMod,
} = require("expo/config-plugins");

const FILE = "network_security_config";
const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

function withSecurityConfigFile(config) {
	return withDangerousMod(config, [
		"android",
		(mod) => {
			const dir = path.join(
				mod.modRequest.platformProjectRoot,
				"app/src/main/res/xml",
			);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, `${FILE}.xml`), XML);
			return mod;
		},
	]);
}

function withSecurityConfigAttribute(config) {
	return withAndroidManifest(config, (mod) => {
		const application = mod.modResults.manifest.application?.[0];
		if (!application) throw new Error("AndroidManifest has no <application>");
		application.$["android:networkSecurityConfig"] = `@xml/${FILE}`;
		return mod;
	});
}

module.exports = (config) =>
	withSecurityConfigAttribute(withSecurityConfigFile(config));
