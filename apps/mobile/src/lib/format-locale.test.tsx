import type { ReactNode } from "react";
import { useFormatLocale } from "./intl";

// "Follow language" follows the app language, the locale the web formats in:
// the one chosen inside the app, else the catalog for the phone's languages.
// The phone's region alone never sets the separators.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockDevice = { tag: "es-AR", region: null as string | null };
const mockPref = { value: "device" as string };
jest.mock("expo-localization", () => ({
	useLocales: () => [
		{ languageTag: mockDevice.tag, regionCode: mockDevice.region },
	],
	useCalendars: () => [{ timeZone: "UTC" }],
}));
jest.mock("./language-pref", () => ({ useLanguagePref: () => mockPref.value }));
jest.mock("./plural-rules", () => ({}));
jest.mock("use-intl", () => ({ IntlProvider: () => null }));

function read(
	pref: string,
	device: string,
	region: string | null = null,
): string {
	mockPref.value = pref;
	mockDevice.tag = device;
	mockDevice.region = region;
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
	it("follows the catalog the phone's language picks, as the web does", () => {
		expect(read("device", "es-AR")).toBe("es-AR");
		expect(read("device", "en-US")).toBe("en");
		expect(read("device", "de-DE")).toBe("de");
	});

	it("keeps English separators for an English phone set to an Argentine region", () => {
		// Group and decimal marks follow the language, so this account reads
		// "1,545" here exactly as on the web.
		expect(read("device", "en-AR", "AR")).toBe("en");
		expect(read("device", "en-US", "AR")).toBe("en");
	});

	it("follows the app language over the phone", () => {
		expect(read("en", "es-AR")).toBe("en");
		expect(read("de", "en-US")).toBe("de");
	});
});
