/**
 * @jest-environment node
 */
import config from "../app.config";

const { setMinSdk, MIN_SDK } = require("../plugins/with-android-min-sdk");

describe("Android min sdk plugin", () => {
	it("is registered", () => {
		expect(config.plugins).toContain("./plugins/with-android-min-sdk");
	});

	it("sets 26 before expo-root-project, once", () => {
		const source = 'buildscript {}\napply plugin: "expo-root-project"\n';
		const out = setMinSdk(source) as string;
		expect(MIN_SDK).toBe(26);
		expect(out.indexOf("ext.minSdkVersion = 26")).toBeLessThan(
			out.indexOf('apply plugin: "expo-root-project"'),
		);
		expect(setMinSdk(out)).toBe(out);
	});
});
