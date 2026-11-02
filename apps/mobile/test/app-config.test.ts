/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import config, {
	apnsEnvironment,
	assertBuildProfile,
	defaultServer,
	LINK_HOSTS,
	releaseVersion,
	WEB_LINK_PATHS,
} from "../app.config";
import { APP_LOCALES } from "../src/lib/locales";
import {
	WEB_LINK_HOSTS,
	WEB_LINK_PATHS as ROUTED_PATHS,
} from "../src/surfaces/links";

// Owner decision (2026-10-22): plain http servers are allowed after a
// warning, so release builds must not block them at the OS level.
describe("app config", () => {
	it("lets iOS release builds reach http servers", () => {
		expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
			NSAllowsArbitraryLoads: true,
		});
	});

	it("adds the Android network security config", () => {
		expect(config.plugins).toContain("./plugins/with-cleartext-servers");
	});

	it("leaves the connect address empty unless the build names a server", () => {
		expect(defaultServer({})).toBe("");
		expect(defaultServer({ RETROSPEND_DEFAULT_SERVER: " " })).toBe("");
		expect(
			defaultServer({
				RETROSPEND_DEFAULT_SERVER: "https://dev.retrospend.app",
			}),
		).toBe("https://dev.retrospend.app");
		expect(config.extra).toHaveProperty("defaultServer");
	});

	it("uses the production APNs host unless an Xcode debug build says otherwise", () => {
		// TestFlight and App Store builds set nothing: production tokens must
		// register with apnsSandbox false.
		expect(apnsEnvironment({})).toBe("production");
		expect(apnsEnvironment({ RETROSPEND_APNS_ENV: "" })).toBe("production");
		expect(apnsEnvironment({ RETROSPEND_APNS_ENV: "sandbox" })).toBe(
			"production",
		);
		expect(apnsEnvironment({ RETROSPEND_APNS_ENV: "development" })).toBe(
			"development",
		);
		expect(config.extra?.apnsSandbox).toBe(false);
		expect(config.plugins).toContainEqual([
			"./plugins/with-ios-push",
			{ mode: "production" },
		]);
	});

	it("keeps the agreed identity", () => {
		expect(config.ios?.bundleIdentifier).toBe("app.retrospend");
		expect(config.android?.package).toBe("app.retrospend");
		expect(config.scheme).toBe("retrospend");
		expect(config.android?.predictiveBackGestureEnabled).toBe(false);
	});

	it("ties the iOS app to both server domains for Password AutoFill", () => {
		expect(config.ios?.associatedDomains).toEqual(
			expect.arrayContaining([
				"webcredentials:dev.retrospend.app",
				"webcredentials:retrospend.app",
			]),
		);
	});

	it("opens the app for both server domains' links on iOS", () => {
		const domains = config.ios?.associatedDomains ?? [];
		for (const host of ["retrospend.app", "dev.retrospend.app"]) {
			expect(domains).toContain(`applinks:${host}`);
		}
	});

	it("verifies the same hosts and paths as app links on Android", () => {
		const filters = config.android?.intentFilters ?? [];
		expect(filters).toHaveLength(1);
		const [filter] = filters;
		expect(filter?.autoVerify).toBe(true);
		expect(filter?.action).toBe("VIEW");
		expect(filter?.category).toEqual(["BROWSABLE", "DEFAULT"]);
		const data = (filter?.data ?? []) as {
			scheme: string;
			host: string;
			pathPrefix: string;
		}[];
		expect(new Set(data.map((d) => d.scheme))).toEqual(new Set(["https"]));
		expect(new Set(data.map((d) => d.host))).toEqual(
			new Set(["retrospend.app", "dev.retrospend.app"]),
		);
		expect(new Set(data.map((d) => d.pathPrefix))).toEqual(
			new Set(WEB_LINK_PATHS.map((p) => `/${p}`)),
		);
	});

	it("keeps the link hosts and paths equal to the ones the router maps", () => {
		expect(LINK_HOSTS).toEqual([...WEB_LINK_HOSTS]);
		expect(WEB_LINK_PATHS).toEqual([...ROUTED_PATHS]);
	});

	it("tells Android and iOS which languages the app speaks", () => {
		const entry = config.plugins?.find(
			(p) => Array.isArray(p) && p[0] === "expo-localization",
		) as [string, { supportedLocales: string[] }] | undefined;
		expect(entry?.[1].supportedLocales).toEqual([...APP_LOCALES]);
		expect(entry?.[1].supportedLocales).toContain("es-AR");
	});

	it("words the photo and camera permissions in every language", () => {
		expect(Object.keys(config.locales ?? {}).sort()).toEqual(
			[...APP_LOCALES].sort(),
		);
		for (const code of APP_LOCALES) {
			const file = JSON.parse(
				readFileSync(join(__dirname, "..", "locales", `${code}.json`), "utf8"),
			) as { ios: Record<string, string> };
			// iOS only: Android lint refuses strings with no default locale.
			expect(Object.keys(file)).toEqual(["ios"]);
			expect(file.ios.NSPhotoLibraryUsageDescription).toBeTruthy();
			expect(file.ios.NSCameraUsageDescription).toBeTruthy();
			expect(file.ios.NSFaceIDUsageDescription).toBeTruthy();
			expect(config.locales?.[code]).toBe(`./locales/${code}.json`);
		}
		const picker = config.plugins?.find(
			(p) => Array.isArray(p) && p[0] === "expo-image-picker",
		) as [string, { microphonePermission: false }] | undefined;
		expect(picker?.[1].microphonePermission).toBe(false);
		const auth = config.plugins?.find(
			(p) => Array.isArray(p) && p[0] === "expo-local-authentication",
		) as [string, { faceIDPermission: string }] | undefined;
		expect(auth?.[1].faceIDPermission).toBeTruthy();
	});

	describe("assertBuildProfile", () => {
		it("allows a release build with no dev variables", () => {
			expect(() =>
				assertBuildProfile({ EXPO_PUBLIC_OTHER: "x" }),
			).not.toThrow();
		});

		it.each([
			{ EXPO_PUBLIC_DEV_PASSWORD: "secret" },
			{ EXPO_PUBLIC_DEV_SERVER: "http://x" },
			{ EXPO_PUBLIC_GALLERY: "1" },
		])("refuses %j in a release build", (env) => {
			expect(() => assertBuildProfile(env)).toThrow(/release build/);
			expect(() =>
				assertBuildProfile({ ...env, RETROSPEND_BUILD_PROFILE: "release" }),
			).toThrow();
		});

		it.each(["development", "simulator"])("allows them for %s", (profile) => {
			expect(() =>
				assertBuildProfile({
					EXPO_PUBLIC_DEV_PASSWORD: "secret",
					EXPO_PUBLIC_GALLERY: "1",
					RETROSPEND_BUILD_PROFILE: profile,
				}),
			).not.toThrow();
		});
	});

	describe("version", () => {
		const root = JSON.parse(
			readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8"),
		) as { version: string };

		it("is the Retrospend release version, not a number kept here", () => {
			expect(releaseVersion()).toBe(root.version);
			expect(config.version).toBe(root.version);
		});

		it("is the same one the server reports", () => {
			const server = readFileSync(
				join(__dirname, "..", "..", "..", "src", "lib", "version.ts"),
				"utf8",
			);
			expect(server).toContain(`"${root.version}"`);
		});

		it("hands the build number to the app next to it", () => {
			expect(config.extra?.buildNumber).toBe(
				Number(process.env.RETROSPEND_BUILD_NUMBER || 1),
			);
		});
	});
});
