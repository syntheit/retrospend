import { TRPCError } from "@trpc/server";
import {
	budgetPeriod,
	budgetPeriodRange,
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "~/lib/fiscal-month";
import {
	fromUSD,
	type MoneyItem,
	periodRateDate,
	roundMoney,
	sumIn,
	toUSD,
} from "~/lib/money";
import { toNumberWithDefault as toNumber } from "~/lib/utils";
import type { db as PrismaClient } from "~/server/db";
import {
	getBestExchangeRate,
	sumExpensesForCurrency,
} from "../api/routers/shared-currency";
import type { RateCache } from "./rate-cache";
import { getSharedExpenseShares } from "./shared-expense-integration";
import { spendingWhere } from "./spending";

export interface BudgetWithStats {
	id: string;
	userId: string;
	categoryId: string | null;
	amount: number;
	amountInUSD: number;
	currency: string;
	period: Date;
	isRollover: boolean;
	rolloverAmount: number;
	pegToActual: boolean;
	type: "FIXED" | "PEG_TO_ACTUAL" | "PEG_TO_LAST_MONTH";
	actualSpend: number;
	actualSpendInUSD: number;
	effectiveAmount: number;
	effectiveAmountInUSD: number;
	/** The same figures in the home currency, by the totals rule (~/lib/money). */
	amountInHome: number;
	actualSpendInHome: number;
	effectiveAmountInHome: number;
	category?: {
		id: string;
		name: string;
		color: string;
		icon?: string | null;
		isFixed: boolean;
	} | null;
}

type CategoryItem = MoneyItem & { categoryId: string | null };

function groupByCategory(items: CategoryItem[]) {
	const map = new Map<string | null, CategoryItem[]>();
	for (const item of items) {
		const list = map.get(item.categoryId) ?? [];
		list.push(item);
		map.set(item.categoryId, list);
	}
	return map;
}

/** Personal expenses plus shared shares in a fiscal range. */
async function spendingInRange(
	db: typeof PrismaClient,
	userId: string,
	range: { start: Date; end: Date },
	excludedProjectIds?: string[],
): Promise<CategoryItem[]> {
	const date = { gte: range.start, lte: range.end };
	const [personal, shared] = await Promise.all([
		db.expense.findMany({
			where: spendingWhere(userId, date),
			select: {
				amount: true,
				currency: true,
				amountInUSD: true,
				categoryId: true,
			},
		}),
		getSharedExpenseShares(db, userId, date, undefined, excludedProjectIds),
	]);
	return [
		...personal.map((e) => ({
			amount: Number(e.amount),
			currency: e.currency,
			amountInUSD: Number(e.amountInUSD),
			categoryId: e.categoryId,
		})),
		...shared,
	];
}

/**
 * Fetches budgets for a given month with calculated spend statistics.
 *
 * Spend in a budget's own currency follows the totals rule: expenses in that
 * currency count as entered, others convert from amountInUSD at the budget
 * currency's rate for the period. The *InHome fields do the same for the
 * home currency, so the budget page and the dashboard show the same numbers.
 */
export async function getBudgets(
	db: typeof PrismaClient,
	userId: string,
	month: Date,
	options: {
		includeGlobal?: boolean;
		fiscalMonthStartDay?: number;
		rateCache?: RateCache;
		excludedProjectIds?: string[];
		homeCurrency?: string;
		timeZone?: string;
	} = {},
): Promise<BudgetWithStats[]> {
	const fiscalStartDay = options.fiscalMonthStartDay ?? 1;
	const tz = options.timeZone;
	const homeCurrency = options.homeCurrency ?? "USD";
	// Budget period lookup: always calendar month. Expenses: fiscal month.
	const fiscal = getFiscalMonthRange(month, fiscalStartDay, tz);
	const lastFiscal = getFiscalMonthRange(
		shiftMonth(month, -1, tz),
		fiscalStartDay,
		tz,
	);

	const budgets = await db.budget.findMany({
		where: {
			userId,
			...(options.includeGlobal ? {} : { categoryId: { not: null } }),
			period: budgetPeriodRange(month, tz),
		},
		include: {
			category: {
				select: {
					id: true,
					name: true,
					color: true,
					icon: true,
					isFixed: true,
				},
			},
		},
		orderBy: [{ category: { name: "asc" } }, { createdAt: "asc" }],
	});

	const expenses = await spendingInRange(
		db,
		userId,
		fiscal,
		options.excludedProjectIds,
	);
	const categoryExpensesMap = groupByCategory(expenses);

	// Last month's spending (personal and shared) only if a budget pegs to it
	const hasPegToLastMonth = budgets.some((b) => b.type === "PEG_TO_LAST_MONTH");
	const lastMonthExpensesMap = hasPegToLastMonth
		? groupByCategory(
				await spendingInRange(
					db,
					userId,
					lastFiscal,
					options.excludedProjectIds,
				),
			)
		: new Map<string | null, CategoryItem[]>();

	// Rates for the period; a currency without any rate stays null and only
	// fails if something actually needs converting (never a silent 1).
	const rates = new Map<string, Promise<number | null>>();
	const getRate = (currency: string, date: Date) => {
		const key = `${currency}:${date.toISOString()}`;
		let rate = rates.get(key);
		if (!rate) {
			rate = options.rateCache
				? options.rateCache.rate(currency, date)
				: getBestExchangeRate(db, currency, date).then((r) => r?.rate ?? null);
			rates.set(key, rate);
		}
		return rate;
	};
	const rateDate = periodRateDate(fiscal.end);
	const lastRateDate = periodRateDate(lastFiscal.end);
	const homeRate = await getRate(homeCurrency, rateDate);

	return Promise.all(
		budgets.map(async (budget): Promise<BudgetWithStats> => {
			const catExpenses =
				budget.categoryId === null
					? expenses
					: (categoryExpensesMap.get(budget.categoryId) ?? []);
			const rate = await getRate(budget.currency, rateDate);

			const actualSpend = sumIn(catExpenses, budget.currency, rate);
			const actualSpendInUSD = catExpenses.reduce(
				(sum, e) => sum + e.amountInUSD,
				0,
			);
			const actualSpendInHome = sumIn(catExpenses, homeCurrency, homeRate);

			const budgetAmount = toNumber(budget.amount);
			const amountInUSD = toUSD(budgetAmount, budget.currency, rate);
			const amountInHome =
				budget.currency === homeCurrency
					? budgetAmount
					: fromUSD(amountInUSD, homeCurrency, homeRate);

			let effectiveAmount = budgetAmount;
			let effectiveAmountInUSD = amountInUSD;
			let effectiveAmountInHome = amountInHome;

			if (budget.type === "PEG_TO_ACTUAL" || budget.pegToActual) {
				effectiveAmount = actualSpend;
				effectiveAmountInUSD = actualSpendInUSD;
				effectiveAmountInHome = actualSpendInHome;
			} else if (budget.type === "PEG_TO_LAST_MONTH") {
				// If current month has spend, show last month's actuals as the budget
				if (actualSpend > 0) {
					const lastMonthExpenses =
						lastMonthExpensesMap.get(budget.categoryId) ?? [];
					const [lastRate, lastHomeRate] = await Promise.all([
						getRate(budget.currency, lastRateDate),
						getRate(homeCurrency, lastRateDate),
					]);
					effectiveAmount = sumIn(lastMonthExpenses, budget.currency, lastRate);
					effectiveAmountInUSD = lastMonthExpenses.reduce(
						(sum, e) => sum + e.amountInUSD,
						0,
					);
					effectiveAmountInHome = sumIn(
						lastMonthExpenses,
						homeCurrency,
						lastHomeRate,
					);
				} else {
					// Hide/zero-out if no spend yet
					effectiveAmount = 0;
					effectiveAmountInUSD = 0;
					effectiveAmountInHome = 0;
				}
			}

			return {
				...budget,
				amount: budgetAmount,
				amountInUSD,
				actualSpend,
				actualSpendInUSD,
				effectiveAmount,
				effectiveAmountInUSD,
				amountInHome,
				actualSpendInHome,
				effectiveAmountInHome,
				rolloverAmount: toNumber(budget.rolloverAmount),
				type: budget.type as BudgetWithStats["type"],
			};
		}),
	);
}

/**
 * Generates budget suggestions from the last 3 complete fiscal months of
 * spending in the category (the running month is left out).
 */
export async function getSuggestions(
	db: typeof PrismaClient,
	userId: string,
	categoryId: string,
	currency = "USD",
	fiscalMonthStartDay = 1,
	timeZone?: string,
) {
	const category = await db.category.findFirst({
		where: { id: categoryId, userId },
	});

	if (!category) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Category not found",
		});
	}

	const currentMonth = getCurrentFiscalMonth(
		new Date(),
		fiscalMonthStartDay,
		timeZone,
	);
	// Oldest first, so the last entry is last month
	const ranges = [3, 2, 1].map((i) =>
		getFiscalMonthRange(
			shiftMonth(currentMonth, -i, timeZone),
			fiscalMonthStartDay,
			timeZone,
		),
	);
	const results = await Promise.all(
		ranges.map((fiscal) =>
			sumExpensesForCurrency(
				db,
				{
					userId,
					categoryId,
					isAmortizedParent: false,
					date: { gte: fiscal.start, lte: fiscal.end },
				},
				currency,
				periodRateDate(fiscal.end),
			),
		),
	);
	const lastMonthSpend = results[results.length - 1]?.total ?? 0;
	const monthlySpends = results
		.map((r) => r.total)
		.filter((amount) => amount > 0);

	if (monthlySpends.length === 0) {
		return { suggestedAmount: 0, averageSpend: 0, lastMonthSpend: 0 };
	}

	const averageSpend =
		monthlySpends.reduce((sum, v) => sum + v, 0) / monthlySpends.length;

	monthlySpends.sort((a, b) => a - b);
	const mid = Math.floor(monthlySpends.length / 2);

	let median = 0;
	const midValue = monthlySpends[mid];
	const prevMidValue = monthlySpends[mid - 1];

	if (monthlySpends.length % 2 === 0) {
		if (typeof midValue === "number" && typeof prevMidValue === "number") {
			median = (midValue + prevMidValue) / 2;
		}
	} else if (typeof midValue === "number") {
		median = midValue;
	}

	return {
		suggestedAmount: roundMoney(median, currency),
		averageSpend: roundMoney(averageSpend, currency),
		lastMonthSpend: roundMoney(lastMonthSpend, currency),
	};
}

/**
 * Copies category budgets (amount, currency and settings) from the most
 * recent earlier month that has them.
 */
export async function copyFromLastMonth(
	db: typeof PrismaClient,
	userId: string,
	targetMonth: Date,
	timeZone?: string,
) {
	const targetPeriod = budgetPeriod(targetMonth, timeZone);

	const existingBudgets = await db.budget.findMany({
		where: {
			userId,
			period: budgetPeriodRange(targetMonth, timeZone),
			categoryId: { not: null },
		},
	});

	if (existingBudgets.length > 0) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Budgets already exist for this month",
		});
	}

	const budgetsByMonth = await db.budget.groupBy({
		by: ["period"],
		where: { userId, categoryId: { not: null }, period: { lt: targetPeriod } },
		_count: { period: true },
		orderBy: { period: "desc" },
	});

	if (budgetsByMonth.length === 0 || !budgetsByMonth[0]) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "No budgets found to copy from",
		});
	}

	const sourceBudgets = await db.budget.findMany({
		where: {
			userId,
			categoryId: { not: null },
			period: budgetsByMonth[0].period,
		},
	});

	const copiedBudgets = await Promise.all(
		sourceBudgets.map(async (sourceBudget) => {
			return await db.budget.create({
				data: {
					userId,
					categoryId: sourceBudget.categoryId,
					amount: sourceBudget.amount,
					currency: sourceBudget.currency,
					period: targetPeriod,
					isRollover: sourceBudget.isRollover,
					pegToActual: sourceBudget.pegToActual,
					type: sourceBudget.type,
				},
				include: {
					category: {
						select: { id: true, name: true, color: true, icon: true },
					},
				},
			});
		}),
	);

	return copiedBudgets.map((budget) => ({
		...budget,
		amount: toNumber(budget.amount),
		rolloverAmount: toNumber(budget.rolloverAmount),
	}));
}
