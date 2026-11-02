import {
	buildExpenseUpdate,
	buildExpenseWrite,
	type ExpenseDraft,
	expenseErrors,
	expenseFromEntry,
	isPersonal,
	knownPeople,
	newExpenseDraft,
	sharedFromDetail,
	splitRows,
} from "./draftExpense";
import type { EntryCatalog, EntryPerson } from "./types";

// The expense draft and the write it becomes, on their own: zero-decimal
// (JPY) and three-decimal (KWD) amounts, every way a split divides, custom
// rates, and a rate that has not been typed (never 1).

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const ME = "me1";
const lucia: EntryPerson = {
	type: "user",
	id: "lucia1",
	name: "Lucía",
	imageUrl: null,
};
const martin: EntryPerson = {
	type: "shadow",
	id: "martin1",
	name: "Martín",
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
	people: [lucia, martin],
	currencies: ["USD", "JPY", "KWD"],
	recentCurrencies: [],
	places: [],
	projects: [],
	hasBudget: null,
};
const input = { locale: "en-US", meId: ME, catalog };

function draft(over: Partial<ExpenseDraft> = {}): ExpenseDraft {
	return {
		...newExpenseDraft({ id: ID, currency: "JPY", date: "2026-11-02" }),
		amountText: "1,500",
		title: "Ramen",
		categoryId: "food",
		...over,
	};
}

describe("a personal expense", () => {
	it("writes yen as whole units", () => {
		expect(buildExpenseWrite(draft(), input)).toEqual({
			entity: "expenses",
			label: "Ramen",
			body: {
				id: ID,
				title: "Ramen",
				amount: "1500",
				currency: "JPY",
				date: "2026-11-02",
				categoryId: "food",
				excludeFromAnalytics: false,
			},
		});
	});

	it("writes dinars to the thousandth", () => {
		const write = buildExpenseWrite(
			draft({ currency: "KWD", amountText: "12.345" }),
			input,
		);
		expect(write?.body).toMatchObject({ amount: "12.345", currency: "KWD" });
	});

	it("keeps a trailing zero of a three-decimal amount", () => {
		const write = buildExpenseWrite(
			draft({ currency: "KWD", amountText: "12.500" }),
			input,
		);
		expect(write?.body).toMatchObject({ amount: "12.500" });
	});

	it("reads the amount in the person's marks", () => {
		const write = buildExpenseWrite(
			draft({ currency: "KWD", amountText: "1.234,567" }),
			{ ...input, locale: "es-AR" },
		);
		expect(write?.body).toMatchObject({ amount: "1234.567" });
	});

	it("is null until the amount reads, with a name and a category", () => {
		expect(buildExpenseWrite(draft({ amountText: "" }), input)).toBeNull();
		expect(buildExpenseWrite(draft({ amountText: "1.5" }), input)).toBeNull();
		expect(buildExpenseWrite(draft({ title: " " }), input)).toBeNull();
		expect(buildExpenseWrite(draft({ categoryId: null }), input)).toBeNull();
		expect(buildExpenseWrite(draft({ categoryId: "gone" }), input)).toBeNull();
	});

	it("names its details and leaves empty ones out", () => {
		const write = buildExpenseWrite(
			draft({
				location: " Ichiran ",
				note: " with Ana ",
				spread: 3,
				exclude: true,
			}),
			input,
		);
		expect(write?.body).toMatchObject({
			location: "Ichiran",
			description: "with Ana",
			amortizeOver: 3,
			excludeFromAnalytics: true,
		});
	});
});

describe("the rate of a foreign expense", () => {
	it("sends nothing by default: the server books your default type", () => {
		const body = buildExpenseWrite(draft(), input)?.body;
		expect(body).not.toHaveProperty("rateType");
		expect(body).not.toHaveProperty("customRate");
	});

	it("sends a typed rate as the plain decimal, not as 1", () => {
		const body = buildExpenseWrite(
			draft({ custom: true, customText: "0.0067" }),
			input,
		)?.body;
		expect(body).toMatchObject({ customRate: "0.0067" });
		expect(body).not.toHaveProperty("rateType");
	});

	it("sends a typed rate for dinars too", () => {
		const body = buildExpenseWrite(
			draft({
				currency: "KWD",
				amountText: "10",
				custom: true,
				customText: "3.25",
			}),
			input,
		)?.body;
		expect(body).toMatchObject({ amount: "10.000", customRate: "3.25" });
	});

	it("does not write while a typed rate is missing, and says so", () => {
		for (const customText of ["", "0", "x"]) {
			const d = draft({ custom: true, customText });
			expect(buildExpenseWrite(d, input)).toBeNull();
			expect(expenseErrors(d, "en-US").rate).toBe(true);
		}
	});
});

describe("expenseErrors", () => {
	it("flags a category outside the catalog unless the edit started with it", () => {
		const d = draft({ categoryId: "theirs" });
		expect(expenseErrors(d, "en-US", catalog.categories).category).toBe(true);
		const editing = draft({
			categoryId: "theirs",
			editing: {
				source: "shared",
				currency: "JPY",
				rateType: null,
				home: null,
				split: null,
				projectId: null,
				category: { id: "theirs", name: "Theirs" },
			},
		});
		expect(
			expenseErrors(editing, "en-US", catalog.categories).category,
		).toBeUndefined();
	});

	it("asks every person of a custom split for a part that reads", () => {
		const d = draft({
			withKeys: ["user:lucia1"],
			splitMode: "EXACT",
			parts: { [`user:${ME}`]: "700" },
		});
		expect(expenseErrors(d, "en-US", undefined, ME).split).toBe(true);
		const full = { ...d, parts: { ...d.parts, "user:lucia1": "800" } };
		expect(expenseErrors(full, "en-US", undefined, ME).split).toBeUndefined();
	});

	it("does not look at the split when there is none or it divides equally", () => {
		expect(expenseErrors(draft(), "en-US", undefined, ME).split).toBeUndefined();
		const equal = draft({ withKeys: ["user:lucia1"] });
		expect(expenseErrors(equal, "en-US", undefined, ME).split).toBeUndefined();
	});
});

describe("a split expense", () => {
	const withLucia = { withKeys: ["user:lucia1"] };

	it("goes to shared expenses, paid by you, split equally between you and them", () => {
		const write = buildExpenseWrite(draft(withLucia), input);
		expect(write?.entity).toBe("shared-expenses");
		expect(write?.body).toEqual({
			id: ID,
			description: "Ramen",
			amount: "1500",
			currency: "JPY",
			date: "2026-11-02",
			categoryId: "food",
			paidBy: { type: "user", id: ME },
			splitMode: "EQUAL",
			splitWith: [
				{ type: "user", id: ME },
				{ type: "user", id: "lucia1" },
			],
		});
	});

	it("is paid by another person on the split when picked", () => {
		const write = buildExpenseWrite(
			draft({ withKeys: ["user:lucia1", "shadow:martin1"], paidByKey: "shadow:martin1" }),
			input,
		);
		expect(write?.body).toMatchObject({
			paidBy: { type: "shadow", id: "martin1" },
		});
	});

	it("falls back to you when the payer is not on the split", () => {
		const write = buildExpenseWrite(
			draft({ ...withLucia, paidByKey: "shadow:martin1" }),
			input,
		);
		expect(write?.body).toMatchObject({ paidBy: { type: "user", id: ME } });
	});

	it("needs someone else, unless it is in a project", () => {
		expect(
			buildExpenseWrite(draft({ withKeys: ["user:nobody"] }), input),
		).toBeNull();
		const alone = buildExpenseWrite(draft({ projectId: "trip" }), input);
		expect(alone?.entity).toBe("shared-expenses");
		expect(alone?.body).toMatchObject({
			projectId: "trip",
			splitWith: [{ type: "user", id: ME }],
		});
	});

	it("sends the note as notes, and no place, spread or exclude", () => {
		const body = buildExpenseWrite(
			draft({ ...withLucia, note: " dinner ", location: "x", spread: 3 }),
			input,
		)?.body;
		expect(body).toMatchObject({ notes: "dinner" });
		expect(body).not.toHaveProperty("location");
		expect(body).not.toHaveProperty("amortizeOver");
	});

	it("sends no rate: a split books at your default type", () => {
		const body = buildExpenseWrite(
			draft({ ...withLucia, rateType: "mep", custom: true, customText: "2" }),
			input,
		)?.body;
		expect(body).not.toHaveProperty("rateType");
		expect(body).not.toHaveProperty("customRate");
	});

	it("is a split from the project's own people, who are not in the catalog", () => {
		const ana: EntryPerson = {
			type: "guest",
			id: "ana1",
			name: "Ana",
			imageUrl: null,
		};
		const write = buildExpenseWrite(
			draft({ projectId: "trip", projectPeople: [ana], withKeys: ["guest:ana1"] }),
			input,
		);
		expect(write?.body).toMatchObject({
			splitWith: [
				{ type: "user", id: ME },
				{ type: "guest", id: "ana1" },
			],
		});
	});
});

describe("a custom split", () => {
	const two = (
		splitMode: ExpenseDraft["splitMode"],
		mine: string,
		theirs: string,
		over: Partial<ExpenseDraft> = {},
	) =>
		draft({
			withKeys: ["user:lucia1"],
			splitMode,
			parts: { [`user:${ME}`]: mine, "user:lucia1": theirs },
			...over,
		});

	it("names each person's yen as whole units", () => {
		const write = buildExpenseWrite(two("EXACT", "700", "800"), input);
		expect(write?.body).toMatchObject({
			splitMode: "EXACT",
			splitWith: [
				{ type: "user", id: ME, shareAmount: "700" },
				{ type: "user", id: "lucia1", shareAmount: "800" },
			],
		});
	});

	it("names each person's dinars to the thousandth", () => {
		const write = buildExpenseWrite(
			two("EXACT", "6", "6.345", { currency: "KWD", amountText: "12.345" }),
			input,
		);
		expect(write?.body).toMatchObject({
			amount: "12.345",
			splitWith: [
				{ type: "user", id: ME, shareAmount: "6.000" },
				{ type: "user", id: "lucia1", shareAmount: "6.345" },
			],
		});
	});

	it("lets someone owe nothing", () => {
		const write = buildExpenseWrite(two("EXACT", "0", "1,500"), input);
		expect(write?.body).toMatchObject({
			splitWith: [
				{ type: "user", id: ME, shareAmount: "0" },
				{ type: "user", id: "lucia1", shareAmount: "1500" },
			],
		});
	});

	it("takes percentages and units as typed, leaving the arithmetic to the server", () => {
		expect(
			buildExpenseWrite(two("PERCENTAGE", "33.3333", "66.6667"), input)?.body,
		).toMatchObject({
			splitWith: [
				{ id: ME, sharePercentage: "33.3333" },
				{ id: "lucia1", sharePercentage: "66.6667" },
			],
		});
		expect(buildExpenseWrite(two("SHARES", "2", "1"), input)?.body).toMatchObject(
			{
				splitWith: [
					{ id: ME, shareUnits: 2 },
					{ id: "lucia1", shareUnits: 1 },
				],
			},
		);
	});

	it("is null while a part is missing or does not read", () => {
		expect(buildExpenseWrite(two("EXACT", "700", ""), input)).toBeNull();
		expect(buildExpenseWrite(two("EXACT", "700", "x"), input)).toBeNull();
		expect(buildExpenseWrite(two("EXACT", "700", "7.5"), input)).toBeNull();
		expect(buildExpenseWrite(two("PERCENTAGE", "60", "101"), input)).toBeNull();
		expect(buildExpenseWrite(two("SHARES", "2", "0"), input)).toBeNull();
		expect(buildExpenseWrite(two("SHARES", "2", "1.5"), input)).toBeNull();
	});

	it("reads parts in the person's marks", () => {
		const write = buildExpenseWrite(
			two("EXACT", "6", "6,345", { currency: "KWD", amountText: "12,345" }),
			{ ...input, locale: "es-AR" },
		);
		expect(write?.body).toMatchObject({
			splitWith: [
				{ id: ME, shareAmount: "6.000" },
				{ id: "lucia1", shareAmount: "6.345" },
			],
		});
	});
});

describe("splitRows", () => {
	const people = [lucia, martin];
	const rows = (d: ExpenseDraft, shares: Parameters<typeof splitRows>[1]["shares"]) =>
		splitRows(d, {
			locale: "en-US",
			meId: ME,
			people,
			youLabel: "You",
			shares,
		});

	it("is empty for a personal expense or an unreadable amount", () => {
		expect(rows(draft(), null)).toEqual([]);
		expect(rows(draft({ withKeys: ["user:lucia1"], amountText: "" }), null)).toEqual(
			[],
		);
	});

	it("names you first, then the others in the order picked", () => {
		const d = draft({ withKeys: ["shadow:martin1", "user:lucia1"] });
		expect(rows(d, null).map((r) => r.name)).toEqual(["You", "Martín", "Lucía"]);
	});

	it("shows each share as the server split it, in the currency's own units", () => {
		const d = draft({
			currency: "KWD",
			amountText: "10",
			withKeys: ["user:lucia1"],
		});
		const shared = rows(d, [
			{ key: `user:${ME}`, share: { minor: 3334, currency: "KWD" } },
			{ key: "user:lucia1", share: { minor: 6666, currency: "KWD" } },
		]);
		expect(shared.map((r) => r.share?.minor)).toEqual([3334, 6666]);
	});

	it("leaves a share empty until the server answers", () => {
		const d = draft({ withKeys: ["user:lucia1"] });
		expect(rows(d, null).map((r) => r.share)).toEqual([null, null]);
	});
});

describe("opening a saved expense", () => {
	const saved = (minor: number, currency: string, over = {}) => ({
		id: ID,
		title: "Ramen",
		amount: { minor, currency },
		rateType: null,
		date: "2026-11-01",
		categoryId: "food",
		location: null,
		description: null,
		amortizeOver: null,
		excludeFromAnalytics: false,
		...over,
	});

	it("shows yen and dinars in their own decimals", () => {
		expect(expenseFromEntry(saved(1500, "JPY"), "en-US").amountText).toBe("1,500");
		expect(expenseFromEntry(saved(12_345, "KWD"), "en-US").amountText).toBe(
			"12.345",
		);
		expect(expenseFromEntry(saved(12_345, "KWD"), "es-AR").amountText).toBe(
			"12,345",
		);
	});

	it("reads a saved refund's amount as its size", () => {
		expect(expenseFromEntry(saved(-1500, "JPY"), "en-US").amountText).toBe("1,500");
	});

	it("saves back the same amount it opened with", () => {
		for (const [minor, currency, amount] of [
			[1500, "JPY", "1500"],
			[12_345, "KWD", "12.345"],
			[12_300, "KWD", "12.300"],
			[1250, "USD", "12.50"],
		] as const) {
			const opened = expenseFromEntry(saved(minor, currency), "en-US");
			expect(buildExpenseUpdate(opened, input)?.body).toMatchObject({
				amount,
				currency,
			});
		}
	});

	it("keeps a saved custom rate exactly as stored", () => {
		const opened = expenseFromEntry(
			saved(1500, "JPY", { rateType: "custom", rate: "0.00671234" }),
			"en-US",
		);
		expect(opened.savedRate).toBe("0.00671234");
		const body = buildExpenseUpdate(
			{ ...opened, custom: true, customText: "149", customFlipped: true },
			input,
		)?.body;
		expect(body).toMatchObject({ customRate: "0.00671234" });
	});

	it("keeps the saved type of the rate and sends it back", () => {
		const opened = expenseFromEntry(
			saved(1500, "JPY", { rateType: "official" }),
			"en-US",
		);
		expect(buildExpenseUpdate(opened, input)).toMatchObject({
			kind: "update",
			entity: "expenses",
			body: { rateType: "official" },
		});
	});

	it("does not update without its edit, and an add refuses an edit", () => {
		expect(buildExpenseUpdate(draft(), input)).toBeNull();
		const opened = expenseFromEntry(saved(1500, "JPY"), "en-US");
		expect(buildExpenseWrite(opened, input)).toBeNull();
	});

	it("waits for a rate the person is typing instead of sending 1", () => {
		const opened = expenseFromEntry(saved(1500, "JPY"), "en-US");
		const typing = { ...opened, custom: true, customText: "", customEdited: true };
		expect(buildExpenseUpdate(typing, input)).toBeNull();
	});
});

describe("opening and saving a saved split", () => {
	const detail = (
		splitMode: "EXACT" | "PERCENTAGE" | "SHARES" | "EQUAL",
		currency = "JPY",
		minor = 1500,
	) => ({
		id: ID,
		title: "Ramen",
		amount: { minor, currency },
		date: "2026-11-01",
		notes: null,
		splitMode,
		project: null,
		category: { id: "food", name: "Food" },
		paidBy: { type: "user" as const, id: ME },
		splits: [
			{
				type: "user" as const,
				id: ME,
				share: { minor: Math.floor(minor / 3), currency },
				percentage: "33.3333",
				units: 1,
			},
			{
				type: "user" as const,
				id: "lucia1",
				name: "Lucía",
				share: { minor: minor - Math.floor(minor / 3), currency },
				percentage: "66.6667",
				units: 2,
			},
		],
	});

	it("opens an exact split with each part in the currency's decimals", () => {
		const d = sharedFromDetail(detail("EXACT", "KWD", 12_345), "en-US", ME);
		expect(d.amountText).toBe("12.345");
		expect(d.withKeys).toEqual(["user:lucia1"]);
		expect(d.parts).toEqual({
			[`user:${ME}`]: "4.115",
			"user:lucia1": "8.230",
		});
	});

	it("opens a percentage and a units split as the server states them", () => {
		expect(sharedFromDetail(detail("PERCENTAGE"), "en-US", ME).parts).toEqual({
			[`user:${ME}`]: "33.3333",
			"user:lucia1": "66.6667",
		});
		expect(sharedFromDetail(detail("SHARES"), "en-US", ME).parts).toEqual({
			[`user:${ME}`]: "1",
			"user:lucia1": "2",
		});
		expect(sharedFromDetail(detail("PERCENTAGE"), "es-AR", ME).parts).toEqual({
			[`user:${ME}`]: "33,3333",
			"user:lucia1": "66,6667",
		});
	});

	it("leaves the people out of an untouched save, so the server keeps them", () => {
		const d = sharedFromDetail(detail("EXACT"), "en-US", ME);
		const update = buildExpenseUpdate(d, input);
		expect(update).toMatchObject({
			entity: "shared-expenses",
			kind: "update",
			body: {
				amount: "1500",
				currency: "JPY",
				paidBy: { type: "user", id: ME },
				splitMode: "EXACT",
			},
		});
		expect(update?.body).not.toHaveProperty("splitWith");
		expect(expenseErrors(d, "en-US", undefined, ME).split).toBeUndefined();
	});

	it("sends the whole split once it was touched", () => {
		const d = {
			...sharedFromDetail(detail("EXACT", "KWD", 12_345), "en-US", ME),
			splitTouched: true,
		};
		expect(buildExpenseUpdate(d, input)?.body).toMatchObject({
			splitMode: "EXACT",
			splitWith: [
				{ id: ME, shareAmount: "4.115" },
				{ id: "lucia1", shareAmount: "8.230" },
			],
		});
	});

	it("needs the person's id to send a touched split", () => {
		const d = {
			...sharedFromDetail(detail("EXACT"), "en-US", ME),
			splitTouched: true,
		};
		expect(
			buildExpenseUpdate(d, { locale: "en-US", catalog }),
		).toBeNull();
	});

	it("keeps a payer who holds no share pickable and flags a part that stopped reading", () => {
		const d = sharedFromDetail(
			{ ...detail("EXACT"), paidBy: { type: "shadow", id: "martin1", name: "Martín" } },
			"en-US",
			ME,
		);
		expect(d.paidByKey).toBe("shadow:martin1");
		expect(d.projectPeople.map((p) => p.id)).toContain("martin1");
		const broken = {
			...d,
			splitTouched: true,
			parts: { ...d.parts, "user:lucia1": "" },
		};
		expect(expenseErrors(broken, "en-US", undefined, ME).split).toBe(true);
		expect(buildExpenseUpdate(broken, input)).toBeNull();
	});
});

describe("who an expense names", () => {
	it("is personal without people or a project, and for an edit by its source", () => {
		expect(isPersonal(draft())).toBe(true);
		expect(isPersonal(draft({ withKeys: ["user:lucia1"] }))).toBe(false);
		expect(isPersonal(draft({ projectId: "trip" }))).toBe(false);
		const shared = sharedFromDetail(
			{
				id: ID,
				title: "x",
				amount: { minor: 100, currency: "JPY" },
				date: "2026-11-01",
				notes: null,
				splitMode: "EQUAL",
				project: null,
				category: null,
				paidBy: { type: "user", id: ME },
			},
			"en-US",
			ME,
		);
		expect(isPersonal(shared)).toBe(false);
	});

	it("knows the catalog's people and the project's own, once each", () => {
		const ana: EntryPerson = {
			type: "guest",
			id: "ana1",
			name: "Ana",
			imageUrl: null,
		};
		const known = knownPeople({ projectPeople: [ana, lucia] }, [lucia, martin]);
		expect(known.map((p) => p.id)).toEqual(["lucia1", "martin1", "ana1"]);
	});
});
