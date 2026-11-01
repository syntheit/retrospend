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
	getShowConverter,
	resetShowConverterCache,
	setShowConverter,
} from "./converter-pref";

beforeEach(() => {
	mockStore.clear();
	resetShowConverterCache();
});

describe("converter preference", () => {
	it("is off until it is turned on", () => {
		expect(getShowConverter()).toBe(false);
	});

	it("applies at once and is kept on the device", async () => {
		setShowConverter(true);
		expect(getShowConverter()).toBe(true);
		await Promise.resolve();
		expect(mockStore.get("retrospend.show-converter")).toBe("1");

		resetShowConverterCache();
		expect(getShowConverter()).toBe(true);
	});

	it("turns off again", async () => {
		setShowConverter(true);
		setShowConverter(false);
		await Promise.resolve();
		resetShowConverterCache();
		expect(getShowConverter()).toBe(false);
	});
});
