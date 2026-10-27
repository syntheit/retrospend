/**
 * @jest-environment node
 */
import config, { buildNumber } from "../app.config";

const {
	addReleaseSigning,
} = require("../plugins/with-android-release-signing");

// The signing and build type blocks of Expo SDK 58's app/build.gradle.
const TEMPLATE = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
`;

describe("release channel config", () => {
	it("registers the signing plugin", () => {
		expect(config.plugins).toContain("./plugins/with-android-release-signing");
	});

	it("declares no non-exempt encryption for App Store Connect", () => {
		expect(config.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
	});

	it("numbers both platforms from one value", () => {
		expect(buildNumber({ RETROSPEND_BUILD_NUMBER: "412" })).toBe(412);
		expect(buildNumber({})).toBe(1);
		expect(buildNumber({ RETROSPEND_BUILD_NUMBER: "" })).toBe(1);
		expect(config.android?.versionCode).toBe(buildNumber(process.env));
		expect(config.ios?.buildNumber).toBe(String(buildNumber(process.env)));
	});

	it("rejects a build number that is not a positive integer", () => {
		for (const bad of ["0", "-3", "1.5", "abc"]) {
			expect(() => buildNumber({ RETROSPEND_BUILD_NUMBER: bad })).toThrow();
		}
	});

	describe("addReleaseSigning", () => {
		const out = addReleaseSigning(TEMPLATE);

		it("adds a release config read from the environment", () => {
			expect(out).toContain("System.getenv('KEYSTORE_FILE')");
			expect(out).toContain("System.getenv('KEYSTORE_PASSWORD_FILE')");
			expect(out).toContain("System.getenv('KEY_PASSWORD_FILE')");
			expect(out).toContain("System.getenv('KEY_ALIAS')");
		});

		it("signs release with it only when a keystore is given", () => {
			expect(out).toContain(
				"signingConfig System.getenv('KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug",
			);
			// The debug build type keeps the debug key.
			expect(out).toContain(
				"debug {\n            signingConfig signingConfigs.debug",
			);
		});

		it("is idempotent", () => {
			expect(addReleaseSigning(out)).toBe(out);
		});

		it("fails loudly when the template changes", () => {
			expect(() => addReleaseSigning("android {}")).toThrow(/no longer matches/);
		});
	});
});
