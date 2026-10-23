/**
 * Budget income (SPEC §12.3): income rows entering To assign, at book value.
 * It is the base for % group targets and the "usual income" plan cost is
 * judged against.
 *
 * - This month's income comes from the engine input (rows after the
 *   checkpoint, which the current and next month always are).
 * - Typical income is the median of the last 3 closed months. A checkpoint
 *   may sit after them, so their rows are read here and valued by the
 *   load's own valuer (frozen values first, never today's rate).
 */
import type { Prisma } from "~prisma";
import { budgetMoneyInWhere } from "../spending";
import { addMonths } from "./calendar";
import { moneyInEntries } from "./entries";
import type { GroupBase } from "./group-view";
import { percentBase } from "./groups";
import type { LoadedBook } from "./inputs";
import { freeze } from "./load-state";
import { monthStart } from "./months";
import type { Minor, MonthKey } from "./types";
import { sumMinor } from "./units";

type Tx = Prisma.TransactionClient;

const SLACK_MS = 2 * 86_400_000;

/** Σ budget income dated in `month`, from the engine input. */
export function incomeIn(loaded: LoadedBook, month: MonthKey): Minor {
	return sumMinor(
		loaded.input.moneyIn
			.filter((m) => m.source === "INCOME" && m.month === month)
			.map((m) => m.minor),
	);
}

export interface ClosedIncomes {
	/** Oldest first, one per closed month (0 for a month without income). */
	months: Minor[];
	/** A row had no rate: left out, so typical income is flagged. */
	incomplete: boolean;
}

/** Budget income of the last 3 closed months before the current one, oldest first. */
export async function closedIncomes(
	tx: Tx,
	loaded: LoadedBook,
): Promise<ClosedIncomes> {
	const c = loaded.input.currentMonth;
	const first = Math.max(loaded.book.startMonth, addMonths(c, -3));
	if (first >= c) return { months: [], incomplete: false };
	const from = new Date(
		Math.max(
			new Date(`${monthStart(first, loaded.periods)}T00:00:00Z`).getTime() -
				SLACK_MS,
			loaded.row.startDate.getTime(),
		),
	);
	const to = new Date(
		new Date(`${monthStart(c, loaded.periods)}T00:00:00Z`).getTime() + SLACK_MS,
	);
	const rows = await tx.expense.findMany({
		where: {
			...budgetMoneyInWhere(loaded.row.createdById, from),
			entryKind: "STANDARD",
			date: { gte: from, lt: to },
		},
		select: {
			id: true,
			amount: true,
			currency: true,
			amountInUSD: true,
			date: true,
			categoryId: true,
			recurringTemplateId: true,
			direction: true,
			entryKind: true,
			homeCurrency: true,
			homeAmount: true,
		},
	});
	const missingBefore = loaded.valuer.missingRates.length;
	const entries = moneyInEntries(rows, loaded.valuer);
	await freeze(tx, loaded.row.id, loaded.valuer);
	const months: Minor[] = [];
	for (let m = first; m < c; m = addMonths(m, 1))
		months.push(
			sumMinor(
				entries
					.filter((e) => e.source === "INCOME" && e.month === m)
					.map((e) => e.minor),
			),
		);
	return {
		months,
		incomplete: loaded.valuer.missingRates.length > missingBefore,
	};
}

/** Does any group of the book size itself as a percent of income? */
export function hasPercentGroup(loaded: LoadedBook): boolean {
	return loaded.book.groups.some((g) => g.target?.kind === "PERCENT_OF_INCOME");
}

/** The % base for `month` (SPEC §5.9): its own income, else typical income. */
export async function groupBaseFor(
	tx: Tx,
	loaded: LoadedBook,
	month: MonthKey,
): Promise<GroupBase | null> {
	const own = incomeIn(loaded, month);
	const incompleteNow = loaded.missingRates.length > 0;
	if (own > 0)
		return { base: own, source: "THIS_MONTH", incomplete: incompleteNow };
	const closed = await closedIncomes(tx, loaded);
	const base = percentBase({
		thisMonthIncome: 0,
		closedMonthIncomes: closed.months,
	});
	return base
		? { ...base, incomplete: incompleteNow || closed.incomplete }
		: null;
}
