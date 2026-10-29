import { rateTypeChanged, rateTypesOf, valuedAt } from "./rateType";
import type { Account, CurrencyInfo } from "./source";

const catalog = [
	{ code: "USD", rateTypes: ["official", "blue", "mep"] },
	{ code: "BRL", rateTypes: [] },
	{ code: "EUR", rateTypes: ["official", "custom"] },
] as unknown as CurrencyInfo[];

describe("rate types of a currency", () => {
	it("lists what the server stores, none for the home currency", () => {
		expect(rateTypesOf(catalog, "USD", "ARS")).toEqual([
			"official",
			"blue",
			"mep",
		]);
		expect(rateTypesOf(catalog, "ARS", "ARS")).toEqual([]);
		expect(rateTypesOf(catalog, "BRL", "ARS")).toEqual([]);
		expect(rateTypesOf(catalog, "XYZ", "ARS")).toEqual([]);
		expect(rateTypesOf(catalog, "EUR", "ARS")).toEqual(["official"]);
	});
});

describe("valued at", () => {
	const usd = (over: Partial<Account>) =>
		({
			balance: { minor: 100, currency: "USD" },
			value: { minor: 14_000, currency: "ARS" },
			rateType: "blue",
			...over,
		}) as unknown as Account;

	it("names the type for a foreign account with a rate", () => {
		expect(valuedAt(usd({}))).toBe("blue");
	});

	it("says nothing at home, with no rate, or on the default", () => {
		expect(
			valuedAt(usd({ value: { minor: 100, currency: "USD" } as never })),
		).toBeNull();
		expect(valuedAt(usd({ value: null }))).toBeNull();
		expect(valuedAt(usd({ rateType: null }))).toBeNull();
	});
});

describe("a changed rate type", () => {
	it("only counts when both are known and differ", () => {
		expect(rateTypeChanged("official", "blue")).toBe(true);
		expect(rateTypeChanged("blue", "blue")).toBe(false);
		expect(rateTypeChanged(null, "blue")).toBe(false);
		expect(rateTypeChanged("blue", null)).toBe(false);
	});
});
