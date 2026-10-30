const mockConfig: { value: unknown } = { value: null };
jest.mock("expo-constants", () => ({
	__esModule: true,
	default: {
		get expoConfig() {
			return mockConfig.value;
		},
	},
}));

import { appBuild } from "./appVersion";

describe("appBuild", () => {
	it("reads the release version and the build number from the config", () => {
		mockConfig.value = { version: "0.5.0", extra: { buildNumber: 1847 } };
		expect(appBuild()).toEqual({ version: "0.5.0", build: "1847" });
	});

	it("calls a plain build number 1", () => {
		mockConfig.value = { version: "0.5.0", extra: {} };
		expect(appBuild()).toEqual({ version: "0.5.0", build: "1" });
	});

	it("does not throw without a config", () => {
		mockConfig.value = null;
		expect(appBuild()).toEqual({ version: "", build: "1" });
	});
});
