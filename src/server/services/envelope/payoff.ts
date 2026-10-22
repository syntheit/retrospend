/**
 * Payoff projection (SPEC §5.11, D72; 02 §3.5): a pure month-by-month
 * schedule from today's balances. It never writes.
 *
 * Each month: interest = balance x APR / 12 (half-even, in the debt's own
 * minor units); every debt gets its minimum; the extra plus every freed
 * minimum goes to the target debt by strategy, then the next one. A debt in
 * another currency is projected in its own currency; money moving between
 * it and the pool (the extra, freed minimums) converts at today's rate.
 * Stops when every debt is 0 or after 50 years.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { addMonths } from "./calendar";
import type { DecimalLike, Minor, MonthKey, PayoffStrategy } from "./types";
import { dec, fromMinor, sumMinor, toMinor } from "./units";

export const PAYOFF_MAX_MONTHS = 600;

export interface PayoffDebt {
	id: string;
	currency: string;
	/** Today's balance owed, positive, in the debt currency's minor units. */
	balance: Minor;
	/** Annual rate in percent ("45.9" = 45.9%), as `interestRate` stores it. */
	aprPercent: DecimalLike;
	/** Minimum payment per month in the debt currency's minor units. */
	minimum: Minor;
	/** Book currency units per 1 unit of the debt currency today ("1" when it is H). */
	bookPerUnit: DecimalLike;
}

export interface PayoffInput {
	bookCurrency: string;
	debts: readonly PayoffDebt[];
	strategy: PayoffStrategy;
	/** CUSTOM: debt ids in payoff order; unlisted debts follow in input order. */
	customOrder?: readonly string[];
	/** Extra each month in H minor units. */
	extraMonthly: Minor;
	/** The current month; month 1 of the schedule is the next one. */
	startMonth: MonthKey;
}

export interface DebtOutcome {
	id: string;
	payoffMonth: MonthKey | null;
	/** Interest over the schedule in the debt's own minor units. */
	interest: Minor;
	/** Everything paid over the schedule (balance + interest once paid off). */
	paid: Minor;
	/** Next month's payment, in the debt's own minor units. */
	nextMinimum: Minor;
	nextExtra: Minor;
}

export interface PayoffResult {
	/** Null when the cap was reached first. */
	debtFreeMonth: MonthKey | null;
	months: number;
	capped: boolean;
	/** Σ interest in H at today's rate. */
	totalInterest: Minor;
	debts: DebtOutcome[];
}

interface Live {
	debt: PayoffDebt;
	index: number;
	balance: Minor;
	apr: Decimal;
	rate: Decimal;
	out: DebtOutcome;
}

function toBook(l: Live, own: Minor, H: string): Minor {
	if (l.debt.currency === H) return own;
	return toMinor(fromMinor(own, l.debt.currency).mul(l.rate), H);
}

function fromBook(l: Live, book: Minor, H: string): Minor {
	if (l.debt.currency === H) return book;
	return toMinor(fromMinor(book, H).div(l.rate), l.debt.currency);
}

/** Debts still owed, in the order the pool pays them this month. */
function payOrder(live: readonly Live[], p: PayoffInput): Live[] {
	const open = live.filter((l) => l.balance > 0);
	const value = (l: Live) => fromMinor(l.balance, l.debt.currency).mul(l.rate);
	if (p.strategy === "SNOWBALL") {
		return open.sort((a, b) => value(a).cmp(value(b)) || a.index - b.index);
	}
	if (p.strategy === "AVALANCHE")
		return open.sort((a, b) => b.apr.cmp(a.apr) || a.index - b.index);
	const rank = (l: Live) => {
		const i = p.customOrder?.indexOf(l.debt.id) ?? -1;
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	return open.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
}

/** Interest and minimums for one month; returns the freed minimums in H. */
function chargeAndPayMinimums(
	live: readonly Live[],
	month: number,
	H: string,
): Minor {
	let freed = 0;
	for (const l of live) {
		if (l.balance <= 0) {
			freed += toBook(l, l.debt.minimum, H);
			continue;
		}
		const interest = toMinor(
			fromMinor(l.balance, l.debt.currency).mul(l.apr).div(1200),
			l.debt.currency,
		);
		l.balance += interest;
		l.out.interest += interest;
		const pay = Math.min(l.balance, l.debt.minimum);
		l.balance -= pay;
		l.out.paid += pay;
		if (month === 1) l.out.nextMinimum = pay;
		freed += toBook(l, l.debt.minimum - pay, H);
	}
	return freed;
}

function payFromPool(
	order: readonly Live[],
	pool: Minor,
	month: number,
	H: string,
) {
	let left = pool;
	for (const l of order) {
		if (left <= 0) break;
		const offered = fromBook(l, left, H);
		const pay = Math.min(l.balance, offered);
		if (pay <= 0) continue;
		l.balance -= pay;
		l.out.paid += pay;
		if (month === 1) l.out.nextExtra += pay;
		left = pay === offered ? 0 : Math.max(0, left - toBook(l, pay, H));
	}
}

function startLive(debts: readonly PayoffDebt[]): Live[] {
	return debts.map((debt, index) => {
		if (debt.balance < 0 || debt.minimum < 0)
			throw new RangeError(`debt ${debt.id}: negative amounts`);
		const out = {
			id: debt.id,
			payoffMonth: null,
			interest: 0,
			paid: 0,
			nextMinimum: 0,
			nextExtra: 0,
		};
		return {
			debt,
			index,
			balance: debt.balance,
			apr: dec(debt.aprPercent),
			rate: dec(debt.bookPerUnit),
			out,
		};
	});
}

/** Debt-free month, total interest, payoff month per debt and next month's payments. */
export function projectPayoff(p: PayoffInput): PayoffResult {
	const H = p.bookCurrency;
	const live = startLive(p.debts);
	let month = 0;
	while (live.some((l) => l.balance > 0) && month < PAYOFF_MAX_MONTHS) {
		month++;
		const freed = chargeAndPayMinimums(live, month, H);
		payFromPool(payOrder(live, p), p.extraMonthly + freed, month, H);
		for (const l of live) {
			if (l.balance === 0 && l.out.payoffMonth === null)
				l.out.payoffMonth = addMonths(p.startMonth, month);
		}
	}
	for (const l of live) {
		if (l.debt.balance === 0) l.out.payoffMonth = p.startMonth;
	}
	const capped = live.some((l) => l.balance > 0);
	return {
		debtFreeMonth: capped ? null : addMonths(p.startMonth, month),
		months: month,
		capped,
		totalInterest: sumMinor(live.map((l) => toBook(l, l.out.interest, H))),
		debts: live.map((l) => l.out),
	};
}
