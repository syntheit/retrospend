import { describe, expect, it } from "vitest";
import { MissingRateError } from "../money";
import { RateInputError } from "../rate-booking";
import {
	deleteExpense,
	type EditInput,
	editExpense,
	savedRateOf,
} from "./edit";
import { arsRow, DAY, fakePort, table } from "./fake-port";
import { ANY_POLICY, ENTRY_POLICY } from "./policy";
import {
	AMOUNT_ABOVE_ZERO,
	AmountRefusedError,
	CategoryNotFoundError,
	EditRefusal,
	EXPENSE_NOT_FOUND,
	LEG_DELETE_REFUSED,
	LEG_EDIT_REFUSED,
} from "./refusals";

const food = { id: "c-new", kind: "EXPENSE", excludeByDefault: false };
const hold = { id: "c-hold", kind: "EXPENSE", excludeByDefault: true };
const income = { id: "c-inc", kind: "INCOME", excludeByDefault: false };

/** The row's own values: an edit that changes nothing. */
const same: EditInput = {
	id: "e1",
	title: "Lunch",
	amount: "100",
	currency: "USD",
	date: DAY,
	categoryId: "c-old",
};
const edit = (input: Partial<EditInput>, p = fakePort(arsRow)) =>
	editExpense(p.port, { ...same, ...input }, ENTRY_POLICY);

describe("editExpense read order", () => {
	it("a missing row is not found and nothing else is read", async () => {
		const p = fakePort(null);
		await expect(edit({ categoryId: "zzz", amount: "0" }, p)).rejects.toThrow(
			EXPENSE_NOT_FOUND,
		);
		expect(p.log).toEqual(["expense"]);
	});

	it("afterRead runs before the leg check, the leg check before the category", async () => {
		const leg = { ...arsRow, hasLegs: true };
		const seen: string[] = [];
		const p = fakePort(leg);
		await expect(
			editExpense(
				p.port,
				{ ...same, amount: "5", categoryId: "zzz" },
				ENTRY_POLICY,
				{ afterRead: async () => void seen.push("hook") },
			),
		).rejects.toThrow(LEG_EDIT_REFUSED);
		expect(seen).toEqual(["hook"]);
		expect(p.log).toEqual(["expense"]);
		const hookRefuses = fakePort(leg);
		await expect(
			editExpense(hookRefuses.port, { ...same, amount: "5" }, ENTRY_POLICY, {
				afterRead: async () => {
					throw new RateInputError("other home");
				},
			}),
		).rejects.toThrow("other home");
	});

	it("a bad category is refused before the amount, the amount before the rate", async () => {
		const p = fakePort(arsRow, { categories: [income] });
		await expect(
			edit({ categoryId: "c-inc", amount: "0", currency: "CLP" }, p),
		).rejects.toBeInstanceOf(CategoryNotFoundError);
		expect(p.log).toEqual(["expense", "category"]);
		const q = fakePort(arsRow, { categories: [food] });
		await expect(
			edit({ categoryId: "c-new", amount: "0", currency: "CLP" }, q),
		).rejects.toBeInstanceOf(AmountRefusedError);
		expect(q.log).toEqual(["expense", "category"]);
	});

	it("a missing rate throws MissingRateError, nothing is written", async () => {
		const p = fakePort(arsRow);
		await expect(
			edit({ currency: "CLP", amount: "10" }, p),
		).rejects.toBeInstanceOf(MissingRateError);
		expect(p.written).toEqual([]);
		expect(p.log).toEqual(["expense", "rateBook"]);
	});
});

describe("editExpense combined refusals: the transport picks the order", () => {
	// PR0's pins: v1 checks the category first, tRPC and legacy the row first.
	const fee = { ...arsRow, hasLegs: true };
	const cases = [
		["an unknown id and an unknown category", null, {}, EXPENSE_NOT_FOUND],
		[
			"a fee with its amount changed and an unknown category",
			fee,
			{ amount: "101" },
			LEG_EDIT_REFUSED,
		],
		[
			"an income row and an unknown category",
			{ ...arsRow, direction: "IN" },
			{},
			EXPENSE_NOT_FOUND,
		],
	] as const;

	it.each(cases)("%s", async (_n, row, change, rowMessage) => {
		const input = { ...same, ...change, categoryId: "unknown" };
		const rowFirst = fakePort(row);
		await expect(
			editExpense(rowFirst.port, input, ENTRY_POLICY),
		).rejects.toThrow(rowMessage);
		const categoryFirst = fakePort(row);
		await expect(
			editExpense(categoryFirst.port, input, ENTRY_POLICY, {
				categoryFirst: true,
			}),
		).rejects.toBeInstanceOf(CategoryNotFoundError);
	});

	it("categoryFirst leaves an unchanged category alone, so the row's refusal stands", async () => {
		const p = fakePort({ ...arsRow, direction: "IN" });
		await expect(
			editExpense(p.port, same, ENTRY_POLICY, { categoryFirst: true }),
		).rejects.toThrow(EXPENSE_NOT_FOUND);
		expect(p.log).toEqual(["expense"]);
	});

	it("categoryFirst applies the new category's default and keeps the rest of the order", async () => {
		const p = fakePort(arsRow, { categories: [hold] });
		await editExpense(p.port, { ...same, categoryId: "c-hold" }, ENTRY_POLICY, {
			categoryFirst: true,
		});
		expect(p.written[0]?.excludeFromAnalytics).toBe(true);
		const q = fakePort({ ...arsRow, hasLegs: true }, { categories: [food] });
		await expect(
			editExpense(
				q.port,
				{ ...same, categoryId: "c-new", amount: "101" },
				ENTRY_POLICY,
				{ categoryFirst: true },
			),
		).rejects.toThrow(LEG_EDIT_REFUSED);
	});
});

describe("policy", () => {
	const rows = [
		["income", { ...arsRow, direction: "IN" }],
		["a spread part", { ...arsRow, isAmortizedChild: true }],
	] as const;

	it.each(rows)(
		"ENTRY_POLICY does not find %s, ANY_POLICY edits it",
		async (_n, row) => {
			await expect(edit({}, fakePort(row))).rejects.toMatchObject({
				kind: "notFound",
				message: EXPENSE_NOT_FOUND,
			});
			await expect(
				editExpense(fakePort(row).port, same, ANY_POLICY),
			).resolves.toBeDefined();
			await expect(
				deleteExpense(fakePort(row).port, "e1", ENTRY_POLICY),
			).rejects.toBeInstanceOf(EditRefusal);
			await expect(
				deleteExpense(fakePort(row).port, "e1", ANY_POLICY),
			).resolves.toBe(row);
		},
	);
});

describe("editExpense patch", () => {
	it("empty location and description and a missing category clear to null", async () => {
		const p = fakePort({ ...arsRow, location: "x", description: "y" });
		await edit(
			{ location: "", description: undefined, categoryId: undefined },
			p,
		);
		expect(p.written[0]).toMatchObject({
			location: null,
			description: null,
			categoryId: null,
		});
	});

	it("pricingSource and excludeFromAnalytics are left alone when the form says nothing", async () => {
		const p = fakePort(arsRow);
		await edit({}, p);
		expect(p.written[0]?.pricingSource).toBeUndefined();
		expect(p.written[0]?.excludeFromAnalytics).toBeUndefined();
		const q = fakePort(arsRow);
		await edit({ pricingSource: "official", excludeFromAnalytics: false }, q);
		expect(q.written[0]).toMatchObject({
			pricingSource: "official",
			excludeFromAnalytics: false,
		});
	});

	it("amortizeOver above 1 makes a spread parent; none clears it; afterWrite gets the count", async () => {
		const seen: number[] = [];
		const run = async (amortizeOver: number | undefined) => {
			const p = fakePort(arsRow);
			await editExpense(p.port, { ...same, amortizeOver }, ENTRY_POLICY, {
				afterWrite: async (_after, n) => void seen.push(n),
			});
			return p.written[0]?.isAmortizedParent;
		};
		expect(await run(3)).toBe(true);
		expect(await run(1)).toBe(false);
		expect(await run(undefined)).toBe(false);
		expect(seen).toEqual([3, 1, 0]);
	});

	it.each(["0", "-5", "0.000000004", "abc"])(
		"amount %s is refused",
		async (amount) => {
			const p = fakePort(arsRow);
			await expect(edit({ amount }, p)).rejects.toThrow(AMOUNT_ABOVE_ZERO);
			expect(p.written).toEqual([]);
		},
	);
});

describe("editExpense category", () => {
	it("an edit that keeps an old category of another kind passes", async () => {
		const p = fakePort(arsRow, { categories: [{ ...income, id: "c-old" }] });
		await edit({ title: "Lunch 2" }, p);
		expect(p.log).not.toContain("category");
		expect(p.written[0]?.categoryId).toBe("c-old");
	});

	it("a changed category must be the person's expense category", async () => {
		const p = fakePort(arsRow, { categories: [income] });
		await expect(edit({ categoryId: "c-inc" }, p)).rejects.toMatchObject({
			message: "Category not found",
			v1Code: "not_found",
		});
		await expect(edit({ categoryId: "gone" }, p)).rejects.toBeInstanceOf(
			CategoryNotFoundError,
		);
	});

	it("a new category's default excludes only when the form left the flag unset", async () => {
		const flag = async (excludeFromAnalytics?: boolean) => {
			const p = fakePort(arsRow, { categories: [hold] });
			await edit({ categoryId: "c-hold", excludeFromAnalytics }, p);
			return p.written[0]?.excludeFromAnalytics;
		};
		expect(await flag()).toBe(true);
		expect(await flag(false)).toBe(false);
	});
});

describe("editExpense money", () => {
	it("ARS blue 1545: USD 100 edited to 120 books 185400.00, the home amount moves by 30900.00", async () => {
		const p = fakePort(arsRow);
		await edit({ amount: "120" }, p);
		expect(p.written[0]).toMatchObject({
			amount: "120",
			amountInUSD: "120.00",
			homeAmount: "185400.00",
			homeRate: "1545",
		});
	});

	it("an edit that moves no money keeps the saved figures, not today's rate", async () => {
		const p = fakePort(arsRow, {
			book: table({ ARS: { rate: 1550, type: "blue" } }, "ARS", "blue"),
		});
		await edit({ title: "Dinner" }, p);
		expect(p.written[0]).toMatchObject({
			homeAmount: "154500.00",
			homeRate: "1545",
			amountInUSD: "100.00",
		});
	});

	it("an edit that moves no money never re-rounds a stored figure", async () => {
		// A row booked before half-to-even: a rebook would give 100.00 and 154500.00.
		const old = { ...arsRow, amountInUSD: "100.01", homeAmount: "154500.01" };
		const p = fakePort(old);
		await edit({ title: "Dinner" }, p);
		expect(p.written[0]).toMatchObject({
			amountInUSD: "100.01",
			homeAmount: "154500.01",
		});
	});

	it("a date edit books again at the kept rate", async () => {
		const p = fakePort(arsRow, {
			book: table({ ARS: { rate: 1550, type: "blue" } }, "ARS", "blue"),
		});
		await edit({ date: new Date("2026-03-06T15:00:00Z") }, p);
		expect(p.written[0]).toMatchObject({
			homeAmount: "154500.00",
			homeRate: "1545",
		});
	});

	it("the amount is stored at 8 decimals, half to even, before it is booked", async () => {
		const p = fakePort(arsRow);
		await edit({ amount: "1.000000015" }, p);
		expect(p.written[0]?.amount).toBe("1.00000002");
	});

	it.each([
		["JPY tie 1252.5 books 1252", "JPY", 125, "10.02", "1252"],
		["JPY tie 1257.5 books 1258", "JPY", 125, "10.06", "1258"],
		["KWD 2.5025 books 2.502", "KWD", 0.25, "10.01", "2.502"],
	])("%s", async (_n, home, rate, amount, expected) => {
		const row = {
			...arsRow,
			homeCurrency: home,
			homeRate: String(rate),
			homeAmount: "1",
		};
		const p = fakePort(row, {
			book: table({ [home]: { rate, type: "official" } }, home),
		});
		await edit({ amount }, p);
		expect(p.written[0]?.homeAmount).toBe(expected);
	});

	it("an undo's signed figures are written as they were, without reading the rate table", async () => {
		const p = fakePort(arsRow);
		const figures = {
			exchangeRate: "1",
			amountInUSD: "99.99",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: "1545.5",
			homeAmount: "154530.45",
		};
		await editExpense(p.port, { ...same, amount: "120" }, ENTRY_POLICY, {
			restoredFigures: async () => figures,
		});
		expect(p.written[0]).toMatchObject(figures);
		expect(p.log).not.toContain("rateBook");
	});

	it("savedRateOf reads the row's rate columns as text", () => {
		expect(savedRateOf(arsRow)).toMatchObject({
			exchangeRate: 1,
			homeRate: "1545",
			amount: "100",
			homeAmount: "154500.00",
			date: DAY,
		});
	});
});

describe("leg-pinned rows", () => {
	const fee = { ...arsRow, hasLegs: true };

	it("title and category stay editable; amount, currency and date are refused", async () => {
		const p = fakePort(fee, { categories: [food] });
		await edit({ title: "Fee", categoryId: "c-new" }, p);
		expect(p.written).toHaveLength(1);
		for (const change of [
			{ amount: "101" },
			{ currency: "EUR" },
			{ date: new Date("2026-03-06T15:00:00Z") },
		]) {
			await expect(edit(change, fakePort(fee))).rejects.toMatchObject({
				kind: "badRequest",
				message: LEG_EDIT_REFUSED,
			});
		}
	});

	it("the same amount typed another way is no change", async () => {
		await edit({ amount: "100.000" }, fakePort(fee));
	});
});

describe("deleteExpense", () => {
	it("a transfer's fee cannot be deleted under ENTRY_POLICY, any row can under ANY_POLICY", async () => {
		const fee = { ...arsRow, hasLegs: true };
		const p = fakePort(fee);
		await expect(
			deleteExpense(p.port, "e1", ENTRY_POLICY),
		).rejects.toMatchObject({
			kind: "badRequest",
			message: LEG_DELETE_REFUSED,
		});
		expect(p.log).toEqual(["expense"]);
		await expect(deleteExpense(p.port, "e1", ANY_POLICY)).resolves.toBe(fee);
		expect(p.log).toEqual(["expense", "expense", "remove"]);
	});

	it("beforeRemove runs after the checks and before the row goes", async () => {
		const p = fakePort(arsRow);
		const row = await deleteExpense(p.port, "e1", ENTRY_POLICY, {
			beforeRemove: async () => void p.log.push("hook"),
		});
		expect(row).toBe(arsRow);
		expect(p.log).toEqual(["expense", "hook", "remove"]);
	});

	it("a missing row is not found", async () => {
		await expect(
			deleteExpense(fakePort(null).port, "e1", ENTRY_POLICY),
		).rejects.toMatchObject({ kind: "notFound", message: EXPENSE_NOT_FOUND });
	});
});
