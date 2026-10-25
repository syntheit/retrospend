import { applyKey, TRIPLE_ZERO } from "@/ui/keypad";
import {
	amountMinor,
	buildExpenseWrite,
	buildIncomeWrite,
	expenseErrors,
	incomeErrors,
	newExpenseDraft,
	newIncomeDraft,
	splitRows,
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
		{ id: "food", name: "Food", uses: 12 },
		{ id: "home", name: "Home", uses: 3 },
	],
	people: [lucia, martin],
	currencies: ["ARS", "USD"],
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
