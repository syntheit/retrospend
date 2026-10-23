import { describe, expect, it } from "vitest";
import { lineIds } from "./category-line";
import { type ExpenseDraft, personalInput, sharedInput, validate } from "./draft";

const you = { participantType: "user" as const, participantId: "me" };
const martin = {
	participantType: "user" as const,
	participantId: "martin",
	name: "Martín Acosta",
};

const base: ExpenseDraft = {
	editing: null,
	newId: "new-1",
	currency: "ARS",
	amountText: "3,500",
	minor: 350_000,
	title: "",
	categoryId: "cafe",
	categoryTouched: true,
	date: "2026-10-22",
	rateType: null,
	custom: false,
	customText: "",
	customRate: null,
	projectId: null,
	youIncluded: true,
	others: [],
	paidBy: you,
	outsidePayer: null,
	split: "even",
	by: "amount",
	exact: {},
	pct: {},
	shares: {},
	spread: "one",
	exclude: false,
	excludeTouched: false,
	excludeAuto: false,
	note: "",
	location: "",
};
const ctx = { home: "ARS", you, rateMissing: false };

describe("Add expense draft", () => {
	it("an empty title saves as the category name; amounts go as decimal strings", () => {
		expect(personalInput(base, { home: "ARS", categoryName: "Cafe" })).toEqual({
			id: "new-1",
			title: "Cafe",
			amount: "3500.00",
			currency: "ARS",
			date: "2026-10-22",
			categoryId: "cafe",
			excludeFromAnalytics: false,
		});
	});

	it("a foreign amount sends the picked type, or the typed rate; the server books it", () => {
		const usd = { ...base, currency: "USD", minor: 1200, rateType: "blue" };
		expect(personalInput(usd, { home: "ARS", categoryName: "x" })).toMatchObject({
			amount: "12.00",
			rateType: "blue",
		});
		const custom = { ...usd, custom: true, customRate: "1475" };
		expect(personalInput(custom, { home: "ARS", categoryName: "x" })).toMatchObject({
			customRate: "1475",
		});
		expect(
			personalInput(custom, { home: "ARS", categoryName: "x" }),
		).not.toHaveProperty("rateType");
	});

	it("a missing rate blocks saving, never converted at 1", () => {
		const usd = { ...base, currency: "USD", minor: 1200 };
		expect(validate(usd, { ...ctx, rateMissing: true })).toEqual({ rate: true });
		expect(validate({ ...usd, custom: true }, ctx)).toEqual({ rate: true });
		expect(validate({ ...usd, custom: true, customRate: "1475" }, ctx)).toEqual({});
	});

	it("amount and category are required; a custom split must add up", () => {
		expect(validate({ ...base, minor: null, categoryId: null }, ctx)).toEqual({
			amount: true,
			category: true,
		});
		const custom: ExpenseDraft = {
			...base,
			others: [martin],
			split: "custom",
			by: "amount",
			exact: { "user:me": 100_000, "user:martin": 200_000 },
		};
		expect(validate(custom, ctx)).toEqual({ split: true });
		expect(
			validate({ ...custom, exact: { "user:me": 150_000, "user:martin": 200_000 } }, ctx),
		).toEqual({});
	});

	it("a shared expense sends the split rows; Martín owes all becomes one EXACT row", () => {
		const shared = { ...base, others: [martin], title: "Dinner" };
		expect(sharedInput(shared, { you, categoryName: "x" })).toMatchObject({
			amount: "3500.00",
			description: "Dinner",
			splitMode: "EQUAL",
			splitWith: [you, { participantType: "user", participantId: "martin" }],
		});
		expect(
			sharedInput({ ...shared, split: "full" }, { you, categoryName: "x" }),
		).toMatchObject({
			splitMode: "EXACT",
			splitWith: [{ participantId: "martin", shareAmount: 3500 }],
		});
	});
});

describe("category recents line", () => {
	const cats = ["a", "b", "c", "d", "e", "f"].map((id) => ({
		id,
		name: id,
		icon: null,
		tone: 1,
		kind: "EXPENSE" as const,
		excludeByDefault: false,
	}));
	it("shows the recents first, then the most used, n at most", () => {
		expect(lineIds(["c", "a"], cats, null, 4)).toEqual(["c", "a", "b", "d"]);
	});
	it("a picked category outside the line takes the first slot; nothing else moves", () => {
		expect(lineIds(["c", "a"], cats, "f", 4)).toEqual(["f", "c", "a", "b"]);
		expect(lineIds(["c", "a"], cats, "a", 4)).toEqual(["c", "a", "b", "d"]);
	});
});
