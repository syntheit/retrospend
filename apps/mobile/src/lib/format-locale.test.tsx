import type { ReactNode } from "react";
import { useFormatLocale } from "./intl";

// "Follow language" follows the language chosen inside the app, and the
// device's region only while the app follows the phone.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockDevice = { tag: "es-AR" };
const mockPref = { value: "device" as string };
jest.mock("expo-localization", () => ({
	useLocales: () => [{ languageTag: mockDevice.tag }],
	useCalendars: () => [{ timeZone: "UTC" }],
}));
jest.mock("./language-pref", () => ({ useLanguagePref: () => mockPref.value }));
jest.mock("./plural-rules", () => ({}));
jest.mock("use-intl", () => ({ IntlProvider: () => null }));

function read(pref: string, device: string): string {
	mockPref.value = pref;
	mockDevice.tag = device;
	let out = "";
	function Probe(): ReactNode {
		out = useFormatLocale();
		return null;
	}
	act(() => {
		create(<Probe />);
	});
	return out;
}

describe("useFormatLocale", () => {
	it("follows the phone's region until a language is chosen in the app", () => {
		expect(read("device", "es-AR")).toBe("es-AR");
		expect(read("device", "en-US")).toBe("en-US");
	});

	it("follows the app language over the phone", () => {
		expect(read("en", "es-AR")).toBe("en");
		expect(read("de", "en-US")).toBe("de");
	});
});
