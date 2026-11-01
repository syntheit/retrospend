import { applyKey, TRIPLE_ZERO } from "@/ui/keypad";
import {
	amountMinor,
	buildExpenseUpdate,
	buildExpenseWrite,
	buildIncomeWrite,
	buildTransferWrite,
	DEFAULT_RATE,
	expenseErrors,
	expenseFromEntry,
	incomeErrors,
	isPersonal,
	newExpenseDraft,
	newIncomeDraft,
	newTransferDraft,
	pickCategory,
	rateFields,
	sharedFromDetail,
	splitRows,
	transferErrors,
} from "./draft";
import type { EntryCatalog, EntryPerson, EntryPlace } from "./types";

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
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
			icon: "Utensils",
			tone: 3,
			uses: 12,
			excludeByDefault: false,
		},
		{
			id: "home",
			name: "Home",
			icon: null,
			tone: 7,
			uses: 3,
			excludeByDefault: true,
		},
	],
	people: [lucia, martin],
	currencies: ["ARS", "USD"],
	recentCurrencies: ["USD"],
	places: [
		{ id: "cash", name: "Cash", type: "CASH", currency: "ARS" },
		{ id: "bank", name: "Bank", type: "CHECKING", currency: "ARS" },
		{ id: "usd", name: "Dollars", type: "CASH", currency: "USD" },
	],
	projects: [],
	hasBudget: true,
};

function type(keys: string[], currency = "ARS", locale = "en-US") {
	return keys.reduce(
		(draft, key) => applyKey(draft, key, locale, currency),
		"",
	);
}

const base = { id: ID, currency: "ARS", date: "2026-10-25" };

describe("the keypad to minor units", () => {
	it("reads 12,500 pesos typed with five keys as 1,250,000 minor units", () => {
		const text = type(["1", "2", "5", "0", "0"]);
		expect(text).toBe("12,500");
		expect(amountMinor(text, "en-US", "ARS")).toBe(1_250_000);
	});

	it("reads es-AR input with the decimal comma", () => {
		const text = type(["3", "5", "0", ",", "5", "0"], "ARS", "es-AR");
		expect(amountMinor(text, "es-AR", "ARS")).toBe(35_050);
	});

	it("takes the 000 key as three zeros", () => {
		const text = type(["3", TRIPLE_ZERO]);
		expect(amountMinor(text, "en-US", "ARS")).toBe(300_000);
	});

	it("reads nothing from an empty or zero draft", () => {
		expect(amountMinor("", "en-US", "ARS")).toBeNull();
		expect(amountMinor("0", "en-US", "ARS")).toBeNull();
	});
});

describe("validation", () => {
	it("asks for an amount, a name and a category", () => {
		const d = newExpenseDraft(base);
		expect(expenseErrors(d, "en-US")).toEqual({
			amount: true,
			title: true,
			category: true,
		});
		expect(
			expenseErrors(
				{ ...d, amountText: "10", categoryId: "food", title: "  " },
				"en-US",
			),
		).toEqual({ title: true });
		expect(
			expenseErrors(
				{ ...d, amountText: "10", categoryId: "food", title: "Lunch" },
				"en-US",
			),
		).toEqual({});
	});

	it("asks income for an amount and who paid", () => {
		const d = newIncomeDraft({ ...base, usePlan: true });
		expect(incomeErrors(d, "en-US")).toEqual({ amount: true, source: true });
		expect(
			incomeErrors({ ...d, amountText: "5", source: "  " }, "en-US"),
		).toEqual({ source: true });
	});
});

describe("buildExpenseWrite", () => {
	const filled = {
		...newExpenseDraft(base),
		amountText: "12,500",
		categoryId: "food",
		title: "Lunch",
	};
	const input = { locale: "en-US", meId: "me1", catalog };

	it("is null until the amount, the name and the category are there", () => {
		expect(buildExpenseWrite(newExpenseDraft(base), input)).toBeNull();
		expect(
			buildExpenseWrite({ ...filled, categoryId: null }, input),
		).toBeNull();
		expect(buildExpenseWrite({ ...filled, title: "  " }, input)).toBeNull();
	});

	it("writes a personal expense with the client id and a decimal string", () => {
		expect(buildExpenseWrite({ ...filled, title: "Coffee " }, input)).toEqual({
			entity: "expenses",
			label: "Coffee",
			body: {
				id: ID,
				title: "Coffee",
				amount: "12500.00",
				currency: "ARS",
				date: "2026-10-25",
				categoryId: "food",
				excludeFromAnalytics: false,
			},
		});
	});

	it("saves the trimmed title", () => {
		const write = buildExpenseWrite({ ...filled, title: " Lunch " }, input);
		expect(write?.body.title).toBe("Lunch");
	});

	it("splits with a person: you pay, equal shares, you and them", () => {
		const write = buildExpenseWrite(
			{ ...filled, title: "Coffee", withKeys: ["user:lucia1"] },
			input,
		);
		expect(write).toEqual({
			entity: "shared-expenses",
			label: "Coffee",
			body: {
				id: ID,
				description: "Coffee",
				amount: "12500.00",
				currency: "ARS",
				date: "2026-10-25",
				categoryId: "food",
				paidBy: { type: "user", id: "me1" },
				splitMode: "EQUAL",
				splitWith: [
					{ type: "user", id: "me1" },
					{ type: "user", id: "lucia1" },
				],
			},
		});
	});

	it("writes zero-decimal and foreign currencies in their own units", () => {
		const jpy = buildExpenseWrite(
			{ ...filled, currency: "JPY", amountText: "1,200" },
			input,
		);
		expect(jpy?.body.amount).toBe("1200");
		const usd = buildExpenseWrite(
			{ ...filled, currency: "USD", amountText: "4.5" },
			input,
		);
		expect(usd?.body.amount).toBe("4.50");
	});
});

describe("splitRows", () => {
	const usd = (minor: number) => ({ minor, currency: "USD" });
	const rows = (
		amountText: string,
		keys: string[],
		shares:
			| { key: string; share: { minor: number; currency: string } }[]
			| null,
	) =>
		splitRows(
			{
				...newExpenseDraft({ ...base, currency: "USD" }),
				amountText,
				withKeys: keys,
			},
			{
				locale: "en-US",
				meId: "me1",
				people: catalog.people,
				youLabel: "You",
				shares,
			},
		).map((r) => [r.name, r.share]);

	it("is empty for a personal expense or no amount", () => {
		expect(rows("10", [], null)).toEqual([]);
		expect(rows("", ["user:lucia1"], null)).toEqual([]);
	});

	it("names you, then the people picked, with no share until the server's", () => {
		expect(rows("10", ["user:lucia1", "shadow:martin1"], null)).toEqual([
			["You", null],
			["Lucía", null],
			["Martín", null],
		]);
	});

	it("shows each share as the server's dry run split it", () => {
		const out = rows(
			"10",
			["user:lucia1", "shadow:martin1"],
			[
				{ key: "shadow:martin1", share: usd(333) },
				{ key: "user:me1", share: usd(334) },
				{ key: "user:lucia1", share: usd(333) },
			],
		);
		expect(out).toEqual([
			["You", usd(334)],
			["Lucía", usd(333)],
			["Martín", usd(333)],
		]);
	});
});

describe("buildIncomeWrite", () => {
	const filled = {
		...newIncomeDraft({ ...base, usePlan: true }),
		amountText: "2,950,000",
		source: " Grupo Andino ",
	};

	it("writes income with no account and Use my plan when there is a budget", () => {
		expect(
			buildIncomeWrite(filled, { locale: "en-US", hasBudget: true }),
		).toEqual({
			entity: "income",
			label: "Grupo Andino",
			body: {
				id: ID,
				title: "Grupo Andino",
				amount: "2950000.00",
				currency: "ARS",
				date: "2026-10-25",
				usePlan: true,
			},
		});
	});

	it("never asks for a plan without an envelope budget", () => {
		for (const hasBudget of [false, null]) {
			const write = buildIncomeWrite(filled, { locale: "en-US", hasBudget });
			expect(write?.body.usePlan).toBe(false);
		}
	});

	it("honors a person who chose to decide later", () => {
		const write = buildIncomeWrite(
			{ ...filled, usePlan: false },
			{ locale: "en-US", hasBudget: true },
		);
		expect(write?.body.usePlan).toBe(false);
	});

	it("sends keep only when the account's budget side is known", () => {
		const into = (inBudget?: boolean) =>
			buildIncomeWrite(
				{ ...filled, into: "acc-1" },
				{
					locale: "en-US",
					hasBudget: true,
					places: [{ id: "acc-1", inBudget } as EntryPlace],
				},
			)?.body;
		expect(into(false)).toMatchObject({ keep: true, usePlan: false });
		expect(into(true)).toMatchObject({ keep: false, usePlan: true });
		const unknown = into(undefined);
		expect(unknown).not.toHaveProperty("keep");
		expect(unknown?.usePlan).toBe(false);
	});

	it("is null without an amount or a source", () => {
		const input = { locale: "en-US", hasBudget: true };
		expect(buildIncomeWrite({ ...filled, amountText: "" }, input)).toBeNull();
		expect(buildIncomeWrite({ ...filled, source: " " }, input)).toBeNull();
	});
});

describe("editing a saved expense", () => {
	const saved = {
		id: ID,
		title: "Lunch",
		amount: { minor: 1_250_050, currency: "ARS" },
		rateType: null,
		date: "2026-10-20",
		categoryId: "food",
		location: "Cafe Tortoni",
		description: "with the team",
		amortizeOver: null,
		excludeFromAnalytics: true,
	};

	it("keeps a saved custom rate to start Custom from, as stored", () => {
		const d = expenseFromEntry(
			{ ...saved, rateType: "custom", rate: "0.000647165415" },
			"en-US",
		);
		expect(d.savedRate).toBe("0.000647165415");
		expect(
			expenseFromEntry({ ...saved, rate: "1450" }, "en-US").savedRate,
		).toBeNull();
	});

	it("opens with the saved values in the person's own separators", () => {
		const d = expenseFromEntry(saved, "es-AR");
		expect(d.amountText).toBe("12.500,50");
		expect(amountMinor(d.amountText, "es-AR", "ARS")).toBe(1_250_050);
		expect(d).toMatchObject({ id: ID, title: "Lunch", categoryId: "food" });
	});

	it("sends every field back, keeping what it has no field for", () => {
		const d = { ...expenseFromEntry(saved, "en-US"), title: "Team lunch" };
		const write = buildExpenseUpdate(d, { locale: "en-US", catalog });
		expect(write).toEqual({
			entity: "expenses",
			kind: "update",
			label: "Team lunch",
			body: {
				id: ID,
				title: "Team lunch",
				amount: "12500.50",
				currency: "ARS",
				date: "2026-10-20",
				categoryId: "food",
				excludeFromAnalytics: true,
				location: "Cafe Tortoni",
				description: "with the team",
			},
		});
	});

	it("keeps the rate type only while the currency is the saved one", () => {
		const d = expenseFromEntry({ ...saved, rateType: "blue" }, "en-US");
		const same = buildExpenseUpdate(d, { locale: "en-US", catalog });
		expect(same?.body.rateType).toBe("blue");
		const other = buildExpenseUpdate(
			// A new currency clears the picked rate, as the composer does.
			{ ...d, ...DEFAULT_RATE, currency: "USD", amountText: "5" },
			{ locale: "en-US", catalog },
		);
		expect(other?.body.rateType).toBeUndefined();
	});

	it("is not an add: the add builder refuses an edit", () => {
		const d = expenseFromEntry(saved, "en-US");
		expect(
			buildExpenseWrite(d, { locale: "en-US", meId: "me", catalog }),
		).toBeNull();
	});
});

describe("a project expense", () => {
	const draft = {
		...newExpenseDraft(base),
		amountText: "100",
		categoryId: "food",
		title: "Dinner",
		projectId: "trip",
	};

	it("goes to shared expenses with the project, even alone", () => {
		const write = buildExpenseWrite(draft, {
			locale: "en-US",
			meId: "me",
			catalog,
		});
		expect(write?.entity).toBe("shared-expenses");
		expect(write?.body).toMatchObject({
			projectId: "trip",
			splitWith: [{ type: "user", id: "me" }],
		});
	});

	it("splits with the project's people, who need not be in the catalog", () => {
		const ana: EntryPerson = {
			type: "guest",
			id: "ana1",
			name: "Ana",
			imageUrl: null,
		};
		const write = buildExpenseWrite(
			{ ...draft, projectPeople: [ana], withKeys: ["guest:ana1"] },
			{ locale: "en-US", meId: "me", catalog },
		);
		expect(write?.body.splitWith).toEqual([
			{ type: "user", id: "me" },
			{ type: "guest", id: "ana1" },
		]);
	});

	it("leaves projectId out of an expense without one", () => {
		const write = buildExpenseWrite(
			{ ...draft, projectId: null, withKeys: ["user:lucia1"] },
			{ locale: "en-US", meId: "me", catalog },
		);
		expect(write?.body).not.toHaveProperty("projectId");
	});
});

describe("a transfer", () => {
	const input = { locale: "en-US", places: catalog.places };
	const draft = {
		...newTransferDraft({
			id: ID,
			date: "2026-10-25",
			currency: "ARS",
			places: catalog.places,
		}),
		amountText: "1,500",
	};

	it("flags a received amount that does not read, and allows it empty", () => {
		const exchange = { ...draft, toId: "usd" };
		expect(transferErrors(exchange, input).received).toBeUndefined();
		expect(
			transferErrors({ ...exchange, receivedText: "abc" }, input).received,
		).toBe(true);
		expect(
			buildTransferWrite({ ...exchange, receivedText: "abc" }, input),
		).toBeNull();
		expect(
			transferErrors({ ...exchange, receivedText: "1.50" }, input).received,
		).toBeUndefined();
		// One currency has no received amount to check.
		expect(
			transferErrors({ ...draft, receivedText: "abc" }, input).received,
		).toBeUndefined();
	});

	it("starts from an account in your currency to another one", () => {
		expect(draft).toMatchObject({ fromId: "cash", toId: "bank" });
	});

	it("moves money in one currency with one amount", () => {
		expect(buildTransferWrite(draft, input)).toEqual({
			entity: "transfers",
			label: "Cash > Bank",
			body: {
				id: ID,
				fromAccountId: "cash",
				toAccountId: "bank",
				fromCurrency: "ARS",
				toCurrency: "ARS",
				fromAmount: "1500.00",
				date: "2026-10-25",
			},
		});
	});

	it("is an exchange across currencies: what arrived is optional", () => {
		const across = { ...draft, toId: "usd", note: " trip " };
		expect(buildTransferWrite(across, input)?.body).not.toHaveProperty(
			"toAmount",
		);
		const typed = buildTransferWrite(
			{ ...across, receivedText: "1.25" },
			input,
		);
		expect(typed?.body).toMatchObject({
			toCurrency: "USD",
			toAmount: "1.25",
			note: "trip",
		});
	});

	it("needs two different accounts and an amount", () => {
		expect(transferErrors({ ...draft, toId: "cash" }, input)).toEqual({
			same: true,
		});
		expect(transferErrors({ ...draft, amountText: "" }, input)).toEqual({
			amount: true,
		});
		expect(buildTransferWrite({ ...draft, toId: null }, input)).toBeNull();
	});
});

describe("the details fields", () => {
	const filled = {
		...newExpenseDraft(base),
		amountText: "12,500.00",
		categoryId: "food",
		title: "Lunch",
	};
	const details = {
		location: " Cafe Tortoni ",
		note: " with the team ",
		spread: 6,
		exclude: true,
	};

	it("adds place, note, spread and exclude to a personal expense", () => {
		const write = buildExpenseWrite(
			{ ...filled, ...details },
			{
				locale: "en-US",
				meId: "me",
				catalog,
			},
		);
		expect(write?.body).toMatchObject({
			location: "Cafe Tortoni",
			description: "with the team",
			amortizeOver: 6,
			excludeFromAnalytics: true,
		});
	});

	it("leaves empty details out of the body", () => {
		const write = buildExpenseWrite(filled, {
			locale: "en-US",
			meId: "me",
			catalog,
		});
		expect(write?.body).not.toHaveProperty("location");
		expect(write?.body).not.toHaveProperty("description");
		expect(write?.body).not.toHaveProperty("amortizeOver");
	});

	it("sends the note of a split as its notes, and no place or spread", () => {
		const write = buildExpenseWrite(
			{ ...filled, ...details, withKeys: ["user:lucia1"] },
			{ locale: "en-US", meId: "me", catalog },
		);
		expect(write?.entity).toBe("shared-expenses");
		expect(write?.body.notes).toBe("with the team");
		expect(write?.body.description).toBe("Lunch");
		for (const key of ["location", "amortizeOver", "excludeFromAnalytics"]) {
			expect(write?.body).not.toHaveProperty(key);
		}
		expect(isPersonal({ ...filled, withKeys: ["user:lucia1"] })).toBe(false);
	});

	it("round-trips on an edit, and an emptied field is cleared", () => {
		const saved = {
			id: ID,
			title: "Lunch",
			amount: { minor: 1_250_000, currency: "ARS" },
			rateType: null,
			date: "2026-10-20",
			categoryId: "food",
			location: "Cafe Tortoni",
			description: "with the team",
			amortizeOver: 3,
			excludeFromAnalytics: true,
		};
		const d = expenseFromEntry(saved, "en-US");
		expect(d).toMatchObject({
			location: "Cafe Tortoni",
			note: "with the team",
			spread: 3,
			exclude: true,
		});
		const same = buildExpenseUpdate(d, { locale: "en-US", catalog });
		expect(same?.body).toMatchObject({
			location: "Cafe Tortoni",
			description: "with the team",
			amortizeOver: 3,
			excludeFromAnalytics: true,
		});
		const cleared = buildExpenseUpdate(
			{ ...d, location: "", note: "", spread: null, exclude: false },
			{ locale: "en-US", catalog },
		);
		expect(cleared?.body).toEqual(
			expect.objectContaining({ excludeFromAnalytics: false }),
		);
		for (const key of ["location", "description", "amortizeOver"]) {
			expect(cleared?.body).not.toHaveProperty(key);
		}
	});

	it("keeps the date an edit opened with", () => {
		const d = expenseFromEntry(
			{
				id: ID,
				title: "Lunch",
				amount: { minor: 100, currency: "ARS" },
				rateType: null,
				date: "2026-01-31",
				categoryId: "food",
				location: null,
				description: null,
				amortizeOver: null,
				excludeFromAnalytics: false,
			},
			"en-US",
		);
		expect(d.date).toBe("2026-01-31");
		expect(buildExpenseUpdate(d, { locale: "en-US", catalog })?.body.date).toBe(
			"2026-01-31",
		);
	});
});

describe("editing a split expense", () => {
	const person = (id: string) => ({ type: "user" as const, id });
	const detail = (mode: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES") => ({
		id: ID,
		title: "Dinner",
		amount: { minor: 10_000, currency: "ARS" },
		date: "2026-10-21",
		notes: "birthday",
		splitMode: mode,
		project: { id: "trip" },
		category: { id: "food", name: "Food" },
		paidBy: person("me"),
		splits: [
			{
				...person("me"),
				share: { minor: 7_000, currency: "ARS" },
				percentage: "70",
				units: 7,
			},
			{
				...person("lucia1"),
				share: { minor: 3_000, currency: "ARS" },
				percentage: "30",
				units: 3,
			},
		],
	});

	it("opens as a split edit with the notes and project", () => {
		const d = sharedFromDetail(detail("EQUAL"), "en-US");
		expect(d).toMatchObject({
			note: "birthday",
			projectId: "trip",
			amountText: "100",
		});
		expect(d.editing?.source).toBe("shared");
		expect(isPersonal(d)).toBe(false);
	});

	it("leaves the people out, so the server keeps them", () => {
		const d = sharedFromDetail(detail("EQUAL"), "en-US");
		const write = buildExpenseUpdate(d, { locale: "en-US", catalog });
		expect(write).toEqual({
			entity: "shared-expenses",
			kind: "update",
			label: "Dinner",
			body: {
				id: ID,
				description: "Dinner",
				amount: "100.00",
				currency: "ARS",
				date: "2026-10-21",
				categoryId: "food",
				paidBy: person("me"),
				splitMode: "EQUAL",
				notes: "birthday",
				projectId: "trip",
			},
		});
	});

	it("keeps the mode of a custom split and lets the server split a new amount", () => {
		for (const mode of ["EXACT", "PERCENTAGE", "SHARES"] as const) {
			const d = sharedFromDetail(detail(mode), "en-US");
			const body = buildExpenseUpdate(
				{ ...d, amountText: "120" },
				{ locale: "en-US", catalog },
			)?.body;
			expect(body).toMatchObject({ amount: "120.00", splitMode: mode });
			expect(body).not.toHaveProperty("splitWith");
		}
	});

	it("never drops the saved project, whatever the draft holds", () => {
		const d = sharedFromDetail(detail("EQUAL"), "en-US");
		const body = buildExpenseUpdate(
			{ ...d, projectId: null, projectPeople: [], date: "2026-10-20" },
			{ locale: "en-US", catalog },
		)?.body;
		expect(body).toMatchObject({ projectId: "trip", date: "2026-10-20" });
	});

	it("keeps someone else's category, which is not in your catalog", () => {
		const d = sharedFromDetail(
			{ ...detail("EQUAL"), category: { id: "theirs", name: "Gifts" } },
			"en-US",
		);
		expect(expenseErrors(d, "en-US", catalog.categories)).toEqual({});
		const write = buildExpenseUpdate(d, { locale: "en-US", catalog });
		expect(write?.body).toMatchObject({ categoryId: "theirs" });
		// Picking one of yours replaces it.
		expect(
			buildExpenseUpdate(
				{ ...d, categoryId: "home" },
				{ locale: "en-US", catalog },
			)?.body,
		).toMatchObject({ categoryId: "home" });
	});

	it("flags a category it can not send, so Save is never a silent no-op", () => {
		const d = sharedFromDetail(detail("EQUAL"), "en-US");
		const stray = { ...d, categoryId: "gone" };
		expect(expenseErrors(stray, "en-US", catalog.categories)).toEqual({
			category: true,
		});
		expect(buildExpenseUpdate(stray, { locale: "en-US", catalog })).toBeNull();
	});
});

describe("the exchange rate of a write", () => {
	const usd = {
		...newExpenseDraft({ ...base, currency: "USD" }),
		amountText: "12",
		categoryId: "food",
		title: "Coffee",
	};
	const input = { locale: "en-US", meId: "me", catalog };

	it("sends nothing until a rate is picked: the server books your default type", () => {
		expect(rateFields(usd, "en-US")).toEqual({});
		const body = buildExpenseWrite(usd, input)?.body;
		expect(body).not.toHaveProperty("rateType");
		expect(body).not.toHaveProperty("customRate");
	});

	it("sends the picked type", () => {
		const body = buildExpenseWrite({ ...usd, rateType: "mep" }, input)?.body;
		expect(body).toMatchObject({ rateType: "mep" });
	});

	it("sends a typed rate as plain decimal text, read in the person's marks", () => {
		const typed = { ...usd, custom: true, customText: "1.465,5" };
		expect(rateFields(typed, "es-AR")).toEqual({ customRate: "1465.5" });
		const body = buildExpenseWrite(typed, { ...input, locale: "es-AR" })?.body;
		expect(body).toMatchObject({ customRate: "1465.5" });
		expect(body).not.toHaveProperty("rateType");
	});

	it("stores a weak currency's typed rate the other way: the >= 1 number is what is typed", () => {
		// USD home, ARS spent: the person types 1,545.2 (1 USD = 1,545.20 ARS).
		const typed = {
			...usd,
			custom: true,
			customText: "1545.2",
			customFlipped: true,
		};
		expect(rateFields(typed, "en-US")).toEqual({
			customRate: "0.000647165415",
		});
		// Garbage and zero still wait, flipped or not.
		for (const customText of ["", "0", "abc"]) {
			expect(rateFields({ ...typed, customText }, "en-US")).toBeNull();
		}
	});

	it("books a saved custom rate exactly as stored until the person types", () => {
		// EUR home, a USD expense saved at 0.923: Custom prefills the number it
		// reads as (1.0834, rounded for the eye), and Save without typing must
		// not rebuild the rate from that prefill.
		const opened = {
			...usd,
			custom: true,
			customText: "1.0834",
			customFlipped: true,
			savedRate: "0.923",
			customEdited: false,
		};
		expect(rateFields(opened, "en-US")).toEqual({ customRate: "0.923" });
		expect(buildExpenseWrite(opened, input)?.body).toMatchObject({
			customRate: "0.923",
		});
		// Typing takes over, even the same digits again.
		const typed = { ...opened, customEdited: true };
		expect(rateFields(typed, "en-US")).toEqual({
			customRate: "0.923020121839",
		});
		// Emptying the field waits for a rate: the saved one is not a fallback.
		expect(rateFields({ ...typed, customText: "" }, "en-US")).toBeNull();
	});

	it("waits for a typed rate that reads as one: never 1, never zero", () => {
		for (const customText of ["", "0", "abc"]) {
			const typed = { ...usd, custom: true, customText };
			expect(rateFields(typed, "en-US")).toBeNull();
			expect(buildExpenseWrite(typed, input)).toBeNull();
			expect(expenseErrors(typed, "en-US").rate).toBe(true);
		}
	});

	it("leaves the rate out of a split: it books at your default type", () => {
		const body = buildExpenseWrite(
			{ ...usd, rateType: "mep", withKeys: ["user:lucia1"] },
			input,
		)?.body;
		expect(body).not.toHaveProperty("rateType");
	});

	it("sends income's picked rate and its note", () => {
		const income = {
			...newIncomeDraft({ ...base, currency: "USD", usePlan: false }),
			amountText: "500",
			source: "Client",
			note: " March invoice ",
			rateType: "official",
		};
		expect(
			buildIncomeWrite(income, { locale: "en-US", hasBudget: false })?.body,
		).toMatchObject({ rateType: "official", description: "March invoice" });
		const typed = { ...income, rateType: null, custom: true, customText: "x" };
		expect(
			buildIncomeWrite(typed, { locale: "en-US", hasBudget: false }),
		).toBeNull();
		expect(incomeErrors(typed, "en-US").rate).toBe(true);
	});
});

describe("picking a category", () => {
	const fresh = newExpenseDraft(base);
	const [food, home] = catalog.categories;

	it("turns Exclude on for a category that starts excluded, and off again", () => {
		expect(pickCategory(fresh, home, "home")).toEqual({
			categoryId: "home",
			exclude: true,
			excludeAuto: true,
		});
		expect(pickCategory(fresh, food, "food")).toEqual({
			categoryId: "food",
			exclude: false,
			excludeAuto: false,
		});
	});

	it("leaves Exclude alone once the person flipped it, and on an edit", () => {
		expect(
			pickCategory({ ...fresh, excludeTouched: true }, home, "home"),
		).toEqual({ categoryId: "home" });
		const saved = expenseFromEntry(
			{
				id: ID,
				title: "Rent",
				amount: { minor: 100, currency: "ARS" },
				rateType: null,
				date: "2026-10-20",
				categoryId: "food",
				location: null,
				description: null,
				amortizeOver: null,
				excludeFromAnalytics: false,
			},
			"en-US",
		);
		expect(pickCategory(saved, home, "home")).toEqual({ categoryId: "home" });
	});
});
