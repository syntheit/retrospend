import type { ReactNode } from "react";
import {
	type MoneyPrefs,
	MoneyPrefsValue,
	useFormatMoney,
	useMoneyLocale,
} from "./money";

// The phone formats with the account's settings the same way the web does:
// the number format and the home currency ride on the locale.
// Expected strings are written out by hand (U+00A0 follows a code, U+202F is
// the space_comma group mark).
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockLocale = { current: "en-US" };
jest.mock("@/auth/session", () => ({ useSession: () => ({}) }));
jest.mock("./intl", () => ({ useFormatLocale: () => mockLocale.current }));

const usd = { minor: 123456, currency: "USD" };
const ars = { minor: 123456700, currency: "ARS" };

function read(
	prefs: MoneyPrefs,
	locale: string,
	ask: (api: ReturnType<typeof useFormatMoney>, tag: string) => string[],
): string[] {
	mockLocale.current = locale;
	let out: string[] = [];
	function Probe(): ReactNode {
		const api = useFormatMoney();
		out = ask(api, useMoneyLocale());
		return null;
	}
	act(() => {
		create(
			<MoneyPrefsValue value={prefs}>
				<Probe />
			</MoneyPrefsValue>,
		);
	});
	return out;
}

const follow: MoneyPrefs = { numberFormat: null, homeCurrency: null };

describe("useFormatMoney", () => {
	it("follows the language when no number format is set", () => {
		expect(read(follow, "en-US", (m) => [m.format(usd) ?? ""])).toEqual([
			"USD\u00a01,234.56",
		]);
		expect(read(follow, "es-AR", (m) => [m.format(usd) ?? ""])).toEqual([
			"USD\u00a01.234,56",
		]);
	});

	it("keeps the account's format across a language change", () => {
		const dotComma: MoneyPrefs = { ...follow, numberFormat: "dot_comma" };
		const commaDot: MoneyPrefs = { ...follow, numberFormat: "comma_dot" };
		expect(read(dotComma, "en-US", (m) => [m.format(usd) ?? ""])).toEqual([
			"USD\u00a01.234,56",
		]);
		// A Spanish phone that wants 1,234.56.
		expect(read(commaDot, "es-AR", (m) => [m.format(usd) ?? ""])).toEqual([
			"USD\u00a01,234.56",
		]);
		expect(
			read({ ...follow, numberFormat: "space_comma" }, "en-US", (m) => [
				m.format(usd) ?? "",
			]),
		).toEqual(["USD\u00a01\u202f234,56"]);
	});

	it("types in the same format: the locale carries the setting", () => {
		const [tag] = read(
			{ ...follow, numberFormat: "dot_comma" },
			"en-US",
			(_m, locale) => [locale],
		);
		expect(tag).toBe("en-US-x-nf-dc");
	});

	it("shows the home currency as a symbol and every other as its code", () => {
		const home: MoneyPrefs = { ...follow, homeCurrency: "USD" };
		expect(
			read(home, "en-US", (m) => [
				m.format(usd) ?? "",
				m.format({ minor: -1200, currency: "USD" }) ?? "",
				m.format(ars) ?? "",
			]),
		).toEqual(["$1,234.56", "-$12.00", "ARS\u00a01,234,567"]);
		// An ARS home shows $ too: it is the home currency.
		expect(
			read({ ...follow, homeCurrency: "ARS" }, "en-US", (m) => [
				m.format(ars) ?? "",
				m.format(usd) ?? "",
			]),
		).toEqual(["$1,234,567", "USD\u00a01,234.56"]);
	});

	it("carries the home currency and the number format on one locale", () => {
		const [tag] = read(
			{ numberFormat: "dot_comma", homeCurrency: "EUR" },
			"en-US",
			(_m, locale) => [locale],
		);
		expect(tag).toBe("en-US-x-nf-dc-hc-eur");
	});

	it("formats a pair with the same settings", () => {
		const [original, home] = read(
			{ ...follow, numberFormat: "dot_comma" },
			"en-US",
			(m) => {
				const p = m.pair({ minor: 5190, currency: "BRL" }, ars);
				return [p.original, p.home ?? ""];
			},
		);
		expect(original).toBe("BRL\u00a051,90");
		expect(home).toBe("ARS\u00a01.234.567");
	});
});
