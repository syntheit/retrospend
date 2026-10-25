import { describe, expect, it } from "vitest";
import { USER_TEXT_FIELDS } from "../common/user-text";
import "../index";
import { amountTextSchema, rateTextSchema } from "../ledger";
import { parseActivityFilter, withDefaultRange } from "./filter";

describe("parseActivityFilter", () => {
	it("reads the web's Activity URL grammar", () => {
		const parsed = parseActivityFilter(
			"from=2026-10-01&to=2026-10-31&cat=c1,c2&project=p1&person=user:u1,shadow:s-2&paidby=me,user:u1&kind=expense,in&q=caf%C3%A9+con+leche",
		);
		expect(parsed).toEqual({
			ok: true,
			value: {
				from: "2026-10-01",
				to: "2026-10-31",
				categoryIds: ["c1", "c2"],
				projectIds: ["p1"],
				people: ["user:u1", "shadow:s-2"],
				paidBy: ["me", "user:u1"],
				kinds: ["expense", "in"],
				q: "café con leche",
			},
		});
	});

	it("is empty when there is no filter, and reads range=all", () => {
		expect(parseActivityFilter(undefined)).toEqual({ ok: true, value: {} });
		expect(parseActivityFilter("")).toEqual({ ok: true, value: {} });
		expect(parseActivityFilter("range=all")).toEqual({
			ok: true,
			value: { rangeAll: true },
		});
	});

	it("keeps the search text as sent", () => {
		const parsed = parseActivityFilter("q=%20Mixed%20CASE%20");
		expect(parsed).toEqual({ ok: true, value: { q: " Mixed CASE " } });
	});

	it.each([
		["unknown key", "nope=1"],
		["a key twice", "kind=in&kind=expense"],
		["a bad day", "from=2026-02-30"],
		["a day with a time", "to=2026-10-01T00:00"],
		["an unknown kind", "kind=gift"],
		["a bad person key", "person=someone"],
		["an empty list", "cat="],
		[
			"too many ids",
			`cat=${Array.from({ length: 51 }, (_, i) => `c${i}`).join(",")}`,
		],
		["an empty search", "q="],
		["a long search", `q=${"x".repeat(101)}`],
		["range other than all", "range=week"],
	])("refuses %s", (_name, raw) => {
		const parsed = parseActivityFilter(raw);
		expect(parsed.ok).toBe(false);
	});
});

describe("withDefaultRange", () => {
	const TODAY = "2026-02-14";

	it("reads no dates as this month, like the web", () => {
		expect(withDefaultRange({ kinds: ["expense"] }, TODAY)).toEqual({
			kinds: ["expense"],
			from: "2026-02-01",
			to: "2026-02-28",
		});
		expect(withDefaultRange({}, "2028-02-29")).toMatchObject({
			from: "2028-02-01",
			to: "2028-02-29",
		});
		expect(withDefaultRange({}, "2026-12-31")).toMatchObject({
			to: "2026-12-31",
		});
	});

	it("leaves a filter with dates, a search, a category or range=all as it is", () => {
		expect(withDefaultRange({ from: "2026-01-01" }, TODAY)).toEqual({
			from: "2026-01-01",
		});
		expect(withDefaultRange({ to: "2026-01-31" }, TODAY)).toEqual({
			to: "2026-01-31",
		});
		expect(withDefaultRange({ q: "cafe" }, TODAY)).toEqual({ q: "cafe" });
		expect(withDefaultRange({ categoryIds: ["c1"] }, TODAY)).toEqual({
			categoryIds: ["c1"],
		});
		expect(withDefaultRange({ rangeAll: true }, TODAY)).toEqual({});
	});
});

describe("amount text", () => {
	it("takes positive decimals with at most 8 decimals", () => {
		for (const ok of ["1", "0.5", "1234.56", "99999999999.12345678"])
			expect(amountTextSchema.safeParse(ok).success, ok).toBe(true);
		for (const bad of [
			"0",
			"0.00",
			"-1",
			"1.123456789",
			"1e3",
			"",
			"1,5",
			" 1",
		])
			expect(amountTextSchema.safeParse(bad).success, bad).toBe(false);
	});

	it("never takes a JSON number", () => {
		expect(amountTextSchema.safeParse(12.5).success).toBe(false);
		expect(rateTextSchema.safeParse(1468.5).success).toBe(false);
	});

	it("takes rates with up to 12 decimals", () => {
		expect(rateTextSchema.safeParse("1.083412345678").success).toBe(true);
		expect(rateTextSchema.safeParse("1.0834123456789").success).toBe(false);
		expect(rateTextSchema.safeParse("0").success).toBe(false);
	});
});

describe("user text", () => {
	it("declares the ledger's free text", () => {
		for (const field of [
			"expense.title",
			"expense.location",
			"expense.description",
			"income.title",
			"income.description",
			"transfer.note",
			"recurring.name",
			"recurring.paymentSource",
			"recurring.websiteUrl",
		])
			expect(USER_TEXT_FIELDS.has(field), field).toBe(true);
	});
});
