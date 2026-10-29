import { formatMoney } from "@retrospend/domain/format";
import { withMoneyContext } from "@retrospend/domain/format-locale";
import { minorOf, readAmount, wireAmount } from "./amount";

describe("keypad amounts", () => {
	it("reads typed money in the locale and currency", () => {
		expect(readAmount("1,234.50", "en-US", "USD")).toEqual({
			state: "ok",
			minor: 123450,
		});
		expect(readAmount("1.234,50", "es-AR", "ARS")).toEqual({
			state: "ok",
			minor: 123450,
		});
		expect(readAmount("5000", "en-US", "JPY")).toEqual({
			state: "ok",
			minor: 5000,
		});
	});

	// A home amount shows its symbol ("$1,500.00"); pasting it back reads.
	it.each([
		["en-US", null, "USD"],
		["es-AR", null, "ARS"],
		["de", null, "EUR"],
		["fr", null, "EUR"],
		["pt-BR", null, "BRL"],
		["ru", null, "RUB"],
		["es-AR", "comma_dot", "USD"],
	] as const)(
		"reads a shown home amount back (%s, %s, %s)",
		(language, numberFormat, currency) => {
			const locale = withMoneyContext(language, {
				numberFormat,
				homeCurrency: currency,
			});
			const shown = formatMoney({ minor: 150050, currency }, { locale });
			expect(readAmount(shown, locale, currency)).toEqual({
				state: "ok",
				minor: 150050,
			});
		},
	);

	it("refuses a symbol on a currency that is not home", () => {
		const locale = withMoneyContext("en-US", { homeCurrency: "USD" });
		expect(readAmount("$1,500", locale, "CAD")).toEqual({ state: "invalid" });
	});

	it("tells nothing, a real zero and nonsense apart", () => {
		expect(readAmount("", "en-US", "USD")).toEqual({ state: "empty" });
		expect(readAmount("0", "en-US", "USD")).toEqual({ state: "zero" });
		expect(readAmount("12.345", "en-US", "USD")).toEqual({ state: "invalid" });
		expect(readAmount("abc", "en-US", "USD")).toEqual({ state: "invalid" });
	});

	it("takes zero only where a write allows it", () => {
		expect(minorOf({ state: "zero" })).toBeNull();
		expect(minorOf({ state: "zero" }, true)).toBe(0);
		expect(minorOf({ state: "ok", minor: 7 })).toBe(7);
		expect(minorOf({ state: "invalid" }, true)).toBeNull();
		expect(minorOf({ state: "empty" }, true)).toBeNull();
	});

	it("writes decimal text with the currency's own decimals", () => {
		expect(wireAmount(123450, "ARS")).toBe("1234.50");
		expect(wireAmount(5000, "JPY")).toBe("5000");
		expect(wireAmount(400000, "ETH")).toBe("0.00400000");
		expect(wireAmount(5, "USD")).toBe("0.05");
	});
});
