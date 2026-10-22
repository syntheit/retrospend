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
 * them in (sumIn, the totals rule in ~/lib/money). Runs on whatever client it
 * is given, a preview's transaction included, so it never imports the db.
 */
import { getCurrentFiscalMonth, getFiscalMonthRange } from "~/lib/fiscal-month";
import {
	currencyDecimals,
	type MoneyItem,
	sumIn,
	toMinorUnits,
} from "~/lib/money";
import type {
	FigureDb,
	FigureDefinition,
	Money,
} from "~/server/figures/registry";
import { Prisma, type PrismaClient } from "~prisma";
import {
	getExcludedProjectIds,
	getSharedExpenseShares,
} from "../shared-expense-integration";
import {
	budgetRefundWhere,
	budgetSpendingWhere,
	type DateRange,
	reportRefundWhere,
	reportSpendingWhere,
} from "../spending";

type AppDb = PrismaClient | Prisma.TransactionClient;

export interface SpentFilter {
	userId: string;
	/** Inclusive bounds on the entry date; either may be left open. */
	date?: DateRange;
	categoryIds?: readonly string[];
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
}

/** How personal rows are grouped: per currency, per category, or per entry date and category. */
export type SpentGrouping = "currency" | "category" | "day";

/** A slice of spending. Refunds come as negative amounts, so a plain sum nets them. */
export interface SpentItem extends MoneyItem {
	categoryId: string | null;
	/** The entry date for "day" grouping and for shares; null otherwise. */
	date: Date | null;
	/** Rows behind this item (a refund counts as a row too). */
	count: number;
}

const GROUP_KEYS = {
	currency: ["currency"],
	category: ["categoryId", "currency"],
	day: ["date", "categoryId", "currency"],
} as const;

type GroupRow = {
	currency: string;
	categoryId?: string | null;
	date?: Date;
	_sum: { amount: Prisma.Decimal | null; amountInUSD: Prisma.Decimal | null };
	_count: { _all: number };
};

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
		...(filter.categoryIds
			? { categoryId: { in: [...filter.categoryIds] } }
			: {}),
	};
}

async function groupRows(
	db: AppDb,
	where: Prisma.ExpenseWhereInput,
	by: SpentGrouping,
): Promise<GroupRow[]> {
	// groupBy's types cannot follow a `by` chosen at runtime.
	const groupBy = (db as PrismaClient).expense.groupBy as unknown as (
		args: unknown,
	) => Promise<GroupRow[]>;
	return groupBy({
		by: [...GROUP_KEYS[by]],
		where,
		_sum: { amount: true, amountInUSD: true },
		_count: { _all: true },
	});
}

const toItem =
	(sign: 1 | -1) =>
	(row: GroupRow): SpentItem => ({
		currency: row.currency,
		amount: sign * Number(row._sum.amount ?? 0),
		amountInUSD: sign * Number(row._sum.amountInUSD ?? 0),
		categoryId: row.categoryId ?? null,
		date: row.date ?? null,
		count: row._count._all,
	});

async function sharesFor(db: AppDb, filter: SpentFilter) {
	if (filter.personalOnly) return [];
	const hidden =
		filter.basis === "budget"
			? []
			: (filter.excludedProjectIds ??
				(await getExcludedProjectIds(db, filter.userId)));
	const shares = await getSharedExpenseShares(
		db,
		filter.userId,
		filter.date,
		undefined,
		hidden,
	);
	return filter.categoryIds
		? shares.filter(
				(s) =>
					s.categoryId !== null && filter.categoryIds?.includes(s.categoryId),
			)
		: shares;
}

/** Your spending matching `filter`, as items to total with sumIn. */
export async function spentItems(
	db: AppDb,
	filter: SpentFilter,
	by: SpentGrouping = "currency",
): Promise<SpentItem[]> {
	const [spending, refunds, shares] = await Promise.all([
		groupRows(db, rowWhere(filter, "spending"), by),
		groupRows(db, rowWhere(filter, "refund"), by),
		sharesFor(db, filter),
	]);
	return [
		...spending.map(toItem(1)),
		...refunds.map(toItem(-1)),
		...shares.map((s) => ({ ...s, count: 1 })),
	];
}

/** Your spending matching `filter` in `currency` at `rate`, by the totals rule. */
export async function spentIn(
	db: AppDb,
	filter: SpentFilter,
	currency: string,
	rate: number | null | undefined,
): Promise<number> {
	return sumIn(await spentItems(db, filter), currency, rate);
}

/** A summed Decimal in minor units, rounded half up in Decimal (no float step). */
const decimalMinor = (value: Prisma.Decimal | null, currency: string) =>
	new Prisma.Decimal(value ?? 0)
		.mul(10 ** currencyDecimals(currency))
		.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
		.toNumber();

/**
 * Your spending matching `filter` per original currency, in minor units and
 * never converted (the figure shape, §2.2). Currencies that net to zero are
 * dropped, so "nothing spent" reads the same however it came about.
 */
export async function spentByCurrency(
	db: AppDb,
	filter: SpentFilter,
): Promise<Money[]> {
	const [spending, refunds, shares] = await Promise.all([
		groupRows(db, rowWhere(filter, "spending"), "currency"),
		groupRows(db, rowWhere(filter, "refund"), "currency"),
		sharesFor(db, filter),
	]);
	const minor = new Map<string, number>();
	const add = (currency: string, units: number) =>
		minor.set(currency, (minor.get(currency) ?? 0) + units);
	for (const row of spending)
		add(row.currency, decimalMinor(row._sum.amount, row.currency));
	for (const row of refunds)
		add(row.currency, -decimalMinor(row._sum.amount, row.currency));
	for (const share of shares)
		add(share.currency, toMinorUnits(share.amount, share.currency));
	return [...minor]
		.filter(([, units]) => units !== 0)
		.map(([currency, units]) => ({ minor: units, currency }));
}

/**
 * Figure `spent`: this fiscal month's spending per currency. The month uses
 * the user's start day in the server zone, the app's default when a request
 * carries no zone; the user's own zone is not stored yet.
 */
export const spentFigure: FigureDefinition<FigureDb> = {
	id: "spent",
	scope: [],
	compute: async (db, scope) => {
		const user = await db.user.findUnique({
			where: { id: scope.userId },
			select: { fiscalMonthStartDay: true },
		});
		const startDay = user?.fiscalMonthStartDay ?? 1;
		const month = getFiscalMonthRange(
			getCurrentFiscalMonth(new Date(), startDay),
			startDay,
		);
		return spentByCurrency(db, {
			userId: scope.userId,
			date: { gte: month.start, lte: month.end },
		});
	},
};
