/**
 * The budget row filters on hand-made rows. The cross product against the
 * server's Prisma filters is budget-rows.pg.test.ts; these are the rules read
 * off the spec, one case each, with the window of March 2026 in Buenos Aires.
 */
import { describe, expect, it } from "vitest";
import {
	amortizationBranch,
	type BudgetRowFields,
	isBudgetMoneyIn,
	isBudgetRefund,
	isBudgetSpending,
	isClosedIncome,
	type ParentOf,
	whyNotClosedIncome,
	whyNotSpending,
} from "./budget-rows";

const FROM = new Date("2026-03-01T03:00:00.000Z");
const TO = new Date("2026-04-01T03:00:00.000Z");
const ms = (d: Date, n: number) => new Date(d.getTime() + n);

const row = (o: Partial<BudgetRowFields> = {}): BudgetRowFields => ({
	status: "FINALIZED",
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	keepInWealth: false,
	isAmortizedParent: false,
	isAmortizedChild: false,
	parentId: null,
	amortizeMode: "INSTALLMENTS",
	categoryKind: "EXPENSE",
	date: FROM,
	...o,
});

const parents: Record<string, "INSTALLMENTS" | "REPORTS_ONLY"> = {
	inst: "INSTALLMENTS",
	rep: "REPORTS_ONLY",
};
const parentOf: ParentOf = (id) => {
	const amortizeMode = parents[id];
	return amortizeMode ? { amortizeMode } : undefined;
};

describe("budget spending", () => {
	it("opens at the first instant of the window and has no end", () => {
		expect(isBudgetSpending(row(), parentOf, FROM)).toBe(true);
		expect(isBudgetSpending(row({ date: ms(FROM, -1) }), parentOf, FROM)).toBe(
			false,
		);
		expect(isBudgetSpending(row({ date: ms(TO, 1) }), parentOf, FROM)).toBe(
			true,
		);
	});

	it("counts an expense with no category, and not one in an income category", () => {
		expect(isBudgetSpending(row({ categoryKind: null }), parentOf, FROM)).toBe(
			true,
		);
		expect(
			isBudgetSpending(row({ categoryKind: "INCOME" }), parentOf, FROM),
		).toBe(false);
		expect(
			whyNotSpending(row({ categoryKind: "INCOME" }), parentOf, FROM),
		).toBe("INCOME_CATEGORY");
	});

	it("counts the parts of an INSTALLMENTS purchase and the whole of a REPORTS_ONLY one", () => {
		const part = { isAmortizedChild: true, parentId: "inst" };
		expect(isBudgetSpending(row(part), parentOf, FROM)).toBe(true);
		expect(
			isBudgetSpending(row({ ...part, parentId: "rep" }), parentOf, FROM),
		).toBe(false);
		expect(
			isBudgetSpending(
				row({ isAmortizedParent: true, amortizeMode: "REPORTS_ONLY" }),
				parentOf,
				FROM,
			),
		).toBe(true);
		expect(
			isBudgetSpending(row({ isAmortizedParent: true }), parentOf, FROM),
		).toBe(false);
	});

	it("leaves out a part whose parent is not among the person's rows, or that has none", () => {
		const part = { isAmortizedChild: true };
		expect(
			isBudgetSpending(row({ ...part, parentId: "gone" }), parentOf, FROM),
		).toBe(false);
		expect(
			isBudgetSpending(row({ ...part, parentId: null }), parentOf, FROM),
		).toBe(false);
		expect(
			amortizationBranch(row({ ...part, parentId: "inst" }), parentOf),
		).toBe("INSTALLMENT_PART");
	});

	it("leaves out drafts, money in and transfers", () => {
		for (const o of [
			{ status: "DRAFT" },
			{ direction: "IN", inType: "REFUND" },
			{ entryKind: "NOT_SPENDING" },
			{ entryKind: "ADJUSTMENT" },
		])
			expect(isBudgetSpending(row(o), parentOf, FROM)).toBe(false);
	});
});

describe("budget refunds", () => {
	const refund = { direction: "IN", inType: "REFUND" };

	it("net in their own month, with or without a category", () => {
		expect(isBudgetRefund(row(refund), FROM)).toBe(true);
		expect(isBudgetRefund(row({ ...refund, categoryKind: null }), FROM)).toBe(
			true,
		);
		expect(isBudgetRefund(row({ ...refund, date: ms(FROM, -1) }), FROM)).toBe(
			false,
		);
		expect(
			isBudgetRefund(row({ ...refund, categoryKind: "INCOME" }), FROM),
		).toBe(false);
	});

	it("are not income, spending or drafts", () => {
		expect(isBudgetRefund(row({ ...refund, inType: "INCOME" }), FROM)).toBe(
			false,
		);
		expect(isBudgetRefund(row(), FROM)).toBe(false);
		expect(isBudgetRefund(row({ ...refund, status: "DRAFT" }), FROM)).toBe(
			false,
		);
	});
});

describe("budget money in", () => {
	const income = { direction: "IN", inType: "INCOME" };

	it("is income, the starting balance and adjustments of either direction", () => {
		expect(isBudgetMoneyIn(row(income), FROM)).toBe(true);
		expect(
			isBudgetMoneyIn(
				row({ direction: "IN", entryKind: "STARTING_BALANCE" }),
				FROM,
			),
		).toBe(true);
		expect(isBudgetMoneyIn(row({ entryKind: "ADJUSTMENT" }), FROM)).toBe(true);
	});

	it("is not income kept in Wealth, a refund, a transfer, a draft or before the window", () => {
		for (const o of [
			{ ...income, keepInWealth: true },
			{ direction: "IN", inType: "REFUND" },
			{ entryKind: "NOT_SPENDING" },
			{ ...income, status: "DRAFT" },
			{ ...income, date: ms(FROM, -1) },
		])
			expect(isBudgetMoneyIn(row(o), FROM)).toBe(false);
	});
});

describe("income of the closed months", () => {
	const income = { direction: "IN", inType: "INCOME" };

	it("reads [from, to): the first instant in, the last out", () => {
		const at = (date: Date) =>
			isClosedIncome(row({ ...income, date }), FROM, TO);
		expect(at(ms(FROM, -1))).toBe(false);
		expect(at(FROM)).toBe(true);
		expect(at(ms(TO, -1))).toBe(true);
		expect(at(TO)).toBe(false);
	});

	it("never counts a starting balance or an adjustment, nor income kept in Wealth", () => {
		expect(
			isClosedIncome(
				row({ direction: "IN", entryKind: "STARTING_BALANCE" }),
				FROM,
				TO,
			),
		).toBe(false);
		expect(isClosedIncome(row({ entryKind: "ADJUSTMENT" }), FROM, TO)).toBe(
			false,
		);
		expect(
			isClosedIncome(row({ ...income, keepInWealth: true }), FROM, TO),
		).toBe(false);
		expect(
			whyNotClosedIncome(row({ ...income, keepInWealth: true }), FROM, TO),
		).toBe("KEPT_IN_WEALTH");
	});
});
