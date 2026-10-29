import {
	buildExpenseUpdate,
	buildExpenseWrite,
	expenseErrors,
	newExpenseDraft,
	sharedFromDetail,
} from "./draft";
import { partText, shareFields } from "./splitParts";
import type { EntryCatalog, EntryPerson } from "./types";

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const lucia: EntryPerson = {
	type: "user",
	id: "lucia1",
	name: "Lucía",
	imageUrl: null,
};
const catalog: EntryCatalog = {
	categories: [
		{
			id: "food",
			name: "Food",
			icon: null,
			tone: 3,
			uses: 1,
			excludeByDefault: false,
		},
	],
	people: [lucia],
	currencies: ["ARS"],
	recentCurrencies: [],
	places: [],
	projects: [],
	hasBudget: null,
};
const input = { locale: "en-US", meId: "me", catalog };
const draft = {
	...newExpenseDraft({ id: ID, currency: "ARS", date: "2026-10-25" }),
	amountText: "100",
	categoryId: "food",
	withKeys: ["user:lucia1"],
};

describe("shareFields", () => {
	it("reads an amount in the currency's decimals, and a zero part", () => {
		expect(shareFields("EXACT", "33.33", "en-US", "ARS")).toEqual({
			shareAmount: "33.33",
		});
		expect(shareFields("EXACT", "0", "en-US", "ARS")).toEqual({
			shareAmount: "0.00",
		});
		expect(shareFields("EXACT", "33.333", "en-US", "ARS")).toBeNull();
		expect(shareFields("EXACT", "", "en-US", "ARS")).toBeNull();
	});

	it("reads a percent with the locale's separator, never past 100", () => {
		expect(shareFields("PERCENTAGE", "33,3333", "es-AR", "ARS")).toEqual({
			sharePercentage: "33.3333",
		});
		expect(shareFields("PERCENTAGE", "100", "en-US", "ARS")).toEqual({
			sharePercentage: "100",
		});
		expect(shareFields("PERCENTAGE", "101", "en-US", "ARS")).toBeNull();
		expect(shareFields("PERCENTAGE", "abc", "en-US", "ARS")).toBeNull();
	});

	it("reads whole shares above zero", () => {
		expect(shareFields("SHARES", "3", "en-US", "ARS")).toEqual({
			shareUnits: 3,
		});
		expect(shareFields("SHARES", "0", "en-US", "ARS")).toBeNull();
		expect(shareFields("SHARES", "1.5", "en-US", "ARS")).toBeNull();
	});

	it("shows a saved part as text", () => {
		const saved = {
			share: { minor: 3_333, currency: "ARS" },
			percentage: "33.3333",
			units: 2,
		};
		expect(partText("EXACT", saved, "en-US")).toBe("33.33");
		expect(partText("PERCENTAGE", saved, "es-AR")).toBe("33,3333");
		expect(partText("SHARES", saved, "en-US")).toBe("2");
		expect(partText("EQUAL", saved, "en-US")).toBe("");
	});
});

describe("a new split with a payer and a mode", () => {
	it("is paid by you and equal unless told otherwise", () => {
		expect(buildExpenseWrite(draft, input)?.body).toMatchObject({
			paidBy: { type: "user", id: "me" },
			splitMode: "EQUAL",
			splitWith: [
				{ type: "user", id: "me" },
				{ type: "user", id: "lucia1" },
			],
		});
	});

	it("sends the person who paid, when they are on it", () => {
		const body = buildExpenseWrite(
			{ ...draft, paidByKey: "user:lucia1" },
			input,
		)?.body;
		expect(body).toMatchObject({ paidBy: { type: "user", id: "lucia1" } });
		// Taken off the split, they are no longer a payer.
		const off = buildExpenseWrite(
			{ ...draft, paidByKey: "user:other" },
			input,
		)?.body;
		expect(off).toMatchObject({ paidBy: { type: "user", id: "me" } });
	});

	it("sends each person's typed part and leaves the sum to the server", () => {
		const exact = buildExpenseWrite(
			{
				...draft,
				splitMode: "EXACT",
				parts: { "user:me": "30", "user:lucia1": "70.50" },
			},
			input,
		)?.body;
		expect(exact).toMatchObject({
			splitMode: "EXACT",
			splitWith: [
				{ type: "user", id: "me", shareAmount: "30.00" },
				{ type: "user", id: "lucia1", shareAmount: "70.50" },
			],
		});
		const shares = buildExpenseWrite(
			{
				...draft,
				splitMode: "SHARES",
				parts: { "user:me": "1", "user:lucia1": "2" },
			},
			input,
		)?.body;
		expect(shares).toMatchObject({
			splitWith: [
				{ type: "user", id: "me", shareUnits: 1 },
				{ type: "user", id: "lucia1", shareUnits: 2 },
			],
		});
	});

	it("does not save while a part is missing, and says so", () => {
		const open = {
			...draft,
			splitMode: "PERCENTAGE" as const,
			parts: { "user:me": "50" },
		};
		expect(buildExpenseWrite(open, input)).toBeNull();
		expect(expenseErrors(open, "en-US", undefined, "me").split).toBe(true);
		expect(
			expenseErrors(
				{ ...open, parts: { ...open.parts, "user:lucia1": "50" } },
				"en-US",
				undefined,
				"me",
			).split,
		).toBeUndefined();
		// An equal split has no parts to read.
		expect(
			expenseErrors(draft, "en-US", undefined, "me").split,
		).toBeUndefined();
	});
});

describe("editing who paid and how it divides", () => {
	const person = (id: string) => ({ type: "user" as const, id });
	const detail = {
		id: ID,
		title: "Dinner",
		amount: { minor: 10_000, currency: "ARS" },
		date: "2026-10-21",
		notes: null,
		splitMode: "PERCENTAGE" as const,
		project: null,
		category: { id: "food", name: "Food" },
		paidBy: { ...person("lucia1"), name: "Lucía", imageUrl: null },
		splits: [
			{
				...person("me"),
				name: "Sofía",
				share: { minor: 3_000, currency: "ARS" },
				percentage: "30",
				units: null,
			},
			{
				...person("lucia1"),
				name: "Lucía",
				share: { minor: 7_000, currency: "ARS" },
				percentage: "70",
				units: null,
			},
		],
	};

	it("opens with the saved payer, mode and parts", () => {
		const d = sharedFromDetail(detail, "en-US", "me");
		expect(d).toMatchObject({
			paidByKey: "user:lucia1",
			splitMode: "PERCENTAGE",
			withKeys: ["user:lucia1"],
			parts: { "user:me": "30", "user:lucia1": "70" },
			splitTouched: false,
		});
	});

	it("sends the saved payer and mode and no people until something changes", () => {
		const d = sharedFromDetail(detail, "en-US", "me");
		const body = buildExpenseUpdate(d, {
			locale: "en-US",
			catalog,
			meId: "me",
		})?.body;
		expect(body).toMatchObject({
			paidBy: person("lucia1"),
			splitMode: "PERCENTAGE",
		});
		expect(body).not.toHaveProperty("splitWith");
	});

	it("sends the whole split once it changed", () => {
		const d = sharedFromDetail(detail, "en-US", "me");
		const body = buildExpenseUpdate(
			{
				...d,
				splitTouched: true,
				paidByKey: null,
				parts: { "user:me": "60", "user:lucia1": "40" },
			},
			{ locale: "en-US", catalog, meId: "me" },
		)?.body;
		expect(body).toMatchObject({
			paidBy: person("me"),
			splitMode: "PERCENTAGE",
			splitWith: [
				{ ...person("me"), sharePercentage: "60" },
				{ ...person("lucia1"), sharePercentage: "40" },
			],
		});
	});

	it("keeps a payer who holds no share, and you off a split you are not on", () => {
		const d = sharedFromDetail(
			{
				...detail,
				splitMode: "EQUAL",
				splits: [detail.splits[1] as (typeof detail.splits)[number]],
			},
			"en-US",
			"me",
		);
		expect(d.editing?.split?.youOnSplit).toBe(false);
		const body = buildExpenseUpdate(
			{ ...d, splitTouched: true },
			{ locale: "en-US", catalog, meId: "me" },
		)?.body;
		expect(body?.splitWith).toEqual([person("lucia1")]);
	});
});
