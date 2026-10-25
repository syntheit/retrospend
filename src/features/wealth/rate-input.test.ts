import { describe, expect, it } from "vitest";
import { rateInput } from "./rate-input";
import type { WealthAccount } from "./types";

const account = (valuation: WealthAccount["valuation"]): WealthAccount => ({
	id: "eur",
	name: "Euro cash",
	type: "CASH",
	kind: "cash",
	group: "cash",
	amount: { minor: 10000, currency: "EUR" },
	storedSign: 1,
	home: { minor: 15000000, currency: "ARS" },
	liquid: true,
	rateType: null,
	rateTypes: ["official"],
	valuation,
	apr: null,
	updated: "2026-10-20",
	closedOn: null,
});

describe("rateInput", () => {
	const custom = account({ type: "custom", customRate: "0.92" });

	it("an edit that keeps the currency keeps a custom rate as typed", () => {
		// Only the name changed: no rate type picked in the sheet.
		expect(rateInput(custom, "EUR", null)).toEqual({
			exchangeRateType: "custom",
			exchangeRate: "0.92",
		});
		expect(rateInput(custom, "EUR", "custom")).toEqual({
			exchangeRateType: "custom",
			exchangeRate: "0.92",
		});
	});

	it("sends the stored rate as decimal text, never through a number", () => {
		// 1,234,567.123456 is 13 digits: as a float it would stay, but the text
		// must be what the column holds, with its trailing zeros dropped.
		const long = account({ type: "custom", customRate: "1234567.123456" });
		expect(rateInput(long, "EUR", null).exchangeRate).toBe("1234567.123456");
		const padded = account({ type: "custom", customRate: "1468.500000" });
		expect(rateInput(padded, "EUR", null).exchangeRate).toBe("1468.5");
		// A rate this reader refuses goes as stored, so the server says so
		// instead of looking a table rate up behind the user's back.
		const odd = account({ type: "custom", customRate: "12345678901234.5" });
		expect(rateInput(odd, "EUR", null).exchangeRate).toBe("12345678901234.5");
	});

	it("keeps a table rate's type, so the server looks the same type up", () => {
		const blue = account({ type: "blue", customRate: null });
		expect(rateInput(blue, "EUR", null)).toEqual({ exchangeRateType: "blue" });
	});

	it("a newly picked type or a new currency drops the stored rate", () => {
		expect(rateInput(custom, "EUR", "official")).toEqual({
			exchangeRateType: "official",
		});
		expect(rateInput(custom, "USD", null)).toEqual({});
	});

	it("a new account sends only the picked type", () => {
		expect(rateInput(null, "EUR", "blue")).toEqual({
			exchangeRateType: "blue",
		});
		expect(rateInput(null, "EUR", null)).toEqual({});
	});
});
