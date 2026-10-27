const mockStore = new Map<string, string>();
jest.mock("./secure-store", () => ({
	secureStore: {
		getItem: (key: string) => mockStore.get(key) ?? null,
		setItemAsync: async (key: string, value: string) => {
			mockStore.set(key, value);
		},
	},
}));

import {
	getLanguagePref,
	resetLanguagePrefCache,
	setLanguagePref,
} from "./language-pref";

beforeEach(() => {
	mockStore.clear();
	resetLanguagePrefCache();
});

describe("language preference", () => {
	it("follows the device until a language is chosen", () => {
		expect(getLanguagePref()).toBe("device");
	});

	it("applies at once and is kept on the device", async () => {
		setLanguagePref("es-AR");
		expect(getLanguagePref()).toBe("es-AR");
		await Promise.resolve();
		expect(mockStore.get("retrospend.language")).toBe("es-AR");

		resetLanguagePrefCache();
		expect(getLanguagePref()).toBe("es-AR");
	});

	it("goes back to the device language", () => {
		setLanguagePref("de");
		setLanguagePref("device");
		resetLanguagePrefCache();
		expect(getLanguagePref()).toBe("device");
	});

	it("ignores a stored value that is not an app language", () => {
		mockStore.set("retrospend.language", "tlh");
		expect(getLanguagePref()).toBe("device");
	});
});
