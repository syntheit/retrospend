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
			exchangeRate: 0.92,
		});
		expect(rateInput(custom, "EUR", "custom")).toEqual({
			exchangeRateType: "custom",
			exchangeRate: 0.92,
		});
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
