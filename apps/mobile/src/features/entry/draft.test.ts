import { applyKey, TRIPLE_ZERO } from "@/ui/keypad";
import {
	amountMinor,
	buildExpenseUpdate,
	buildExpenseWrite,
	buildIncomeWrite,
	buildTransferWrite,
	expenseErrors,
	expenseFromEntry,
	incomeErrors,
	newExpenseDraft,
	newIncomeDraft,
	newTransferDraft,
	splitRows,
	transferErrors,
} from "./draft";
import type { EntryCatalog, EntryPerson } from "./types";

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
		{ id: "food", name: "Food", icon: "Utensils", tone: 3, uses: 12 },
		{ id: "home", name: "Home", icon: null, tone: 7, uses: 3 },
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
	it("asks for an amount and a category", () => {
		const d = newExpenseDraft(base);
		expect(expenseErrors(d, "en-US")).toEqual({ amount: true, category: true });
		expect(
			expenseErrors({ ...d, amountText: "10", categoryId: "food" }, "en-US"),
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
	};
	const input = { locale: "en-US", meId: "me1", catalog };

	it("is null until the amount and category are there", () => {
		expect(buildExpenseWrite(newExpenseDraft(base), input)).toBeNull();
		expect(
			buildExpenseWrite({ ...filled, categoryId: null }, input),
		).toBeNull();
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
			},
		});
	});

	it("saves an empty title as the category name", () => {
		const write = buildExpenseWrite(filled, input);
		expect(write?.body.title).toBe("Food");
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
	const rows = (amountText: string, currency: string, keys: string[]) =>
		splitRows(
			{
				...newExpenseDraft({ ...base, currency }),
				amountText,
				withKeys: keys,
			},
			{ locale: "en-US", meId: "me1", people: catalog.people, youLabel: "You" },
		).map((r) => [r.name, r.minor]);

	it("is empty for a personal expense or no amount", () => {
		expect(rows("12,500", "ARS", [])).toEqual([]);
		expect(rows("", "ARS", ["user:lucia1"])).toEqual([]);
	});

	it("halves an even amount in minor units", () => {
		expect(rows("12,500", "ARS", ["user:lucia1"])).toEqual([
			["You", 625_000],
			["Lucía", 625_000],
		]);
	});

	it("gives the leftover minor unit to the payer", () => {
		expect(rows("100.01", "ARS", ["user:lucia1"])).toEqual([
			["You", 5001],
			["Lucía", 5000],
		]);
	});

	it("splits three ways without losing a cent", () => {
		const out = rows("10", "USD", ["user:lucia1", "shadow:martin1"]);
		expect(out).toEqual([
			["You", 334],
			["Lucía", 333],
			["Martín", 333],
		]);
		expect(out.reduce((sum, [, minor]) => sum + Number(minor), 0)).toBe(1000);
	});

	it("splits a currency without decimals in whole units", () => {
		const out = rows("1,000", "JPY", ["user:lucia1", "shadow:martin1"]);
		expect(out.map(([, minor]) => minor)).toEqual([334, 333, 333]);
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
			{ ...d, currency: "USD", amountText: "5" },
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
