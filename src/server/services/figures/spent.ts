/**
 * `spent(filter)`: the one spending definition (IMPLEMENTATION §1.4, §2.4).
 *
 * Your spending = your personal rows that count (spending.ts filters) plus
 * your share of shared expenses, minus refunds. Never transfers, income,
 * adjustments, starting balances, reimbursements (settlements are not rows
 * here), rejected shares, projects you hide from analytics (reports), or
 * rows filed under an income category (the categories that never count).
 *
 * Every reader (dashboard, stats, budget page, runway, profile, suggestions)
 * takes its items from here and only picks the currency and rate to total
 * them in (sumInDec, the totals rule in @retrospend/domain/money-dec). A personal row saved with
 * a booked home value (M2) counts that value in its home currency, so it
 * never moves with later rates; rows with none, and shares, keep the period
 * rate. Runs on whatever client it is given, a preview's transaction
 * included, so it never imports the db.
 */

import { type RateInput, sumInDec } from "@retrospend/domain/money-dec";
import type { Decimal } from "@retrospend/domain/precise-decimal";
import {
	type SpentGroup,
	type SpentInputs,
	type SpentItem,
	spentItemsOf,
	spentMinorByCurrency,
	spentRange,
} from "@retrospend/domain/spent";
import type {
	FigureDb,
	FigureDefinition,
	Money,
} from "~/server/figures/registry";
import { Prisma, type PrismaClient } from "~prisma";
import {
	getExcludedProjectIds,
	getSharedExpenseShares,
	type ShareNarrowing,
} from "../shared-expense-integration";
import {
	budgetRefundWhere,
	budgetSpendingWhere,
	type DateRange,
	reportRefundWhere,
	reportSpendingWhere,
} from "../spending";
import { resolveTimeZone } from "../user-time-zone";

type AppDb = PrismaClient | Prisma.TransactionClient;

export interface SpentFilter {
	userId: string;
	/** Inclusive bounds on the entry date; either may be left open. */
	date?: DateRange;
	categoryIds?: readonly string[];
	/** Only entries in these original currencies (a share by its own currency). */
	currencies?: readonly string[];
	/** Also counts spending and refunds with no category (with or without categoryIds). */
	uncategorized?: boolean;
	/**
	 * "report" (default): stats, dashboard, Insights; honors Hide from reports
	 * and hidden projects. "budget": the envelope engine; counts hidden rows
	 * and, until project budget routing lands (M7), every share.
	 */
	basis?: "report" | "budget";
	/** Hidden project ids when the caller already has them; looked up otherwise. */
	excludedProjectIds?: string[];
	/**
	 * Leaves shares out. Only for the readers that never counted them
	 * (lifetime totals and budget suggestions), so their numbers stay put.
	 */
	personalOnly?: boolean;
	/**
	 * Insights filters: only shares in these projects, or in expenses with
	 * these people. A personal row has neither a project nor a person, so
	 * either filter leaves personal rows out.
	 */
	projectIds?: readonly string[];
	withPeople?: ShareNarrowing["withPeople"];
}

/** How personal rows are grouped: per currency, per category, or per entry date and category. */
export type SpentGrouping = "currency" | "category" | "day";

export type { SpentItem };

// homeCurrency splits rows booked when saved (M2) from rows with no booked
// value, so each slice is either all booked or all on the period rate.
const GROUP_KEYS = {
	currency: ["currency", "homeCurrency"],
	category: ["categoryId", "currency", "homeCurrency"],
	day: ["date", "categoryId", "currency", "homeCurrency"],
} as const;

type GroupRow = {
	currency: string;
	homeCurrency: string | null;
	categoryId?: string | null;
	date?: Date;
	_sum: {
		amount: Prisma.Decimal | null;
		amountInUSD: Prisma.Decimal | null;
		homeAmount: Prisma.Decimal | null;
	};
	_count: { _all: number };
};

function categoryWhere(filter: SpentFilter): Prisma.ExpenseWhereInput {
	const ids = filter.categoryIds ? [...filter.categoryIds] : undefined;
	if (!filter.uncategorized) return ids ? { categoryId: { in: ids } } : {};
	return {
		AND: [
			{
				OR: [
					{ categoryId: null },
					...(ids ? [{ categoryId: { in: ids } }] : []),
				],
			},
		],
	};
}

/** Whether a share's category passes the category part of the filter. */
function categoryPasses(filter: SpentFilter, id: string | null): boolean {
	if (!filter.categoryIds && !filter.uncategorized) return true;
	if (id === null) return filter.uncategorized === true;
	return filter.categoryIds?.includes(id) === true;
}

function rowWhere(
	filter: SpentFilter,
	kind: "spending" | "refund",
): Prisma.ExpenseWhereInput {
	const budget = filter.basis === "budget";
	const build =
		kind === "spending"
			? budget
				? budgetSpendingWhere
				: reportSpendingWhere
			: budget
				? budgetRefundWhere
				: reportRefundWhere;
	return {
		...build(filter.userId, filter.date),
		// An import or an old client can still file a row under an income category.
		NOT: { category: { is: { kind: "INCOME" } } },
		...categoryWhere(filter),
		...(filter.currencies ? { currency: { in: [...filter.currencies] } } : {}),
	};
}

const sharesOnly = (filter: SpentFilter) =>
	filter.projectIds !== undefined || filter.withPeople !== undefined;

async function groupRows(
	db: AppDb,
	filter: SpentFilter,
	kind: "spending" | "refund",
	by: SpentGrouping,
): Promise<GroupRow[]> {
	if (sharesOnly(filter)) return [];
	// groupBy's types cannot follow a `by` chosen at runtime.
	const groupBy = (db as PrismaClient).expense.groupBy as unknown as (
		args: unknown,
	) => Promise<GroupRow[]>;
	return groupBy({
		by: [...GROUP_KEYS[by]],
		where: rowWhere(filter, kind),
		_sum: { amount: true, amountInUSD: true, homeAmount: true },
		_count: { _all: true },
	});
}

/** A SQL group as the domain's group (the exact sums stay Decimals until used). */
const toGroup = (row: GroupRow): SpentGroup => ({
	currency: row.currency,
	homeCurrency: row.homeCurrency,
	categoryId: row.categoryId ?? null,
	date: row.date ?? null,
	amount: row._sum.amount ?? 0,
	amountInUSD: row._sum.amountInUSD ?? 0,
	homeAmount: row._sum.homeAmount ?? 0,
	count: row._count._all,
});

async function sharesFor(db: AppDb, filter: SpentFilter) {
	if (filter.personalOnly) return [];
	const hidden =
		filter.basis === "budget"
			? []
			: (filter.excludedProjectIds ??
				(await getExcludedProjectIds(db, filter.userId)));
	const base = [db, filter.userId, filter.date, undefined, hidden] as const;
	const shares = await (sharesOnly(filter)
		? getSharedExpenseShares(...base, {
				projectIds: filter.projectIds,
				withPeople: filter.withPeople,
			})
		: getSharedExpenseShares(...base));
	return shares.filter(
		(s) =>
			categoryPasses(filter, s.categoryId) &&
			(!filter.currencies || filter.currencies.includes(s.currency)),
	);
}

/** Your spending matching `filter`, as items to total with sumInDec. */
export async function spentItems(
	db: AppDb,
	filter: SpentFilter,
	by: SpentGrouping = "currency",
): Promise<SpentItem[]> {
	return spentItemsOf(await loadSpentInputs(db, filter, by));
}

/** Your spending matching `filter` in `currency` at `rate`, by the totals rule: an exact Decimal, rounded once by whoever shows it. */
export async function spentIn(
	db: AppDb,
	filter: SpentFilter,
	currency: string,
	rate: RateInput,
): Promise<Decimal> {
	return sumInDec(await spentItems(db, filter), currency, rate);
}

/** The figure's inputs, read with SQL: the server loader (spentInputsFromRows is the device's). By currency unless a reader buckets differently. */
export async function loadSpentInputs(
	db: AppDb,
	filter: SpentFilter,
	by: SpentGrouping = "currency",
): Promise<SpentInputs> {
	const [spending, refunds, shares] = await Promise.all([
		groupRows(db, filter, "spending", by),
		groupRows(db, filter, "refund", by),
		sharesFor(db, filter),
	]);
	return {
		spending: spending.map(toGroup),
		refunds: refunds.map(toGroup),
		shares,
	};
}

/**
 * Your spending matching `filter` per original currency, in minor units and
 * never converted (the figure shape, §2.2). The rounding and netting are the
 * domain's (spentMinorByCurrency), shared with the device.
 */
export async function spentByCurrency(
	db: AppDb,
	filter: SpentFilter,
): Promise<Money[]> {
	return spentMinorByCurrency(await loadSpentInputs(db, filter));
}

/** The figure at `now`: the user's fiscal month, start day and saved zone. */
export async function spentAt(
	db: FigureDb,
	userId: string,
	now: Date,
): Promise<Money[]> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { fiscalMonthStartDay: true, timeZone: true },
	});
	const month = spentRange(
		now,
		user?.fiscalMonthStartDay ?? 1,
		resolveTimeZone(user?.timeZone),
	);
	return spentByCurrency(db, {
		userId,
		date: { gte: month.start, lte: month.end },
	});
}

/**
 * Figure `spent`: this fiscal month's spending per currency. The month uses
 * the user's start day in their stored zone (resolveTimeZone): a figure read
 * has no request, so the device's zone is not known here.
 */
export const spentFigure: FigureDefinition<FigureDb> = {
	id: "spent",
	scope: [],
	compute: (db, scope) => spentAt(db, scope.userId, new Date()),
};
