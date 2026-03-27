import { TRPCError } from "@trpc/server";
import { Prisma } from "~prisma";
import { getFiscalMonthRange } from "~/lib/fiscal-month";
import type { db as PrismaClient } from "~/server/db";
import { fromUSD, toUSD } from "../currency";
import {
	getBestExchangeRate,
	sumExpensesForCurrency,
} from "../api/routers/shared-currency";
import { getSharedExpenseShares } from "./shared-expense-integration";
import type { RateCache } from "./rate-cache";

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
	category?: {
		id: string;
		name: string;
		color: string;
		icon?: string | null;
		isFixed: boolean;
	} | null;
}

import { toNumberWithDefault as toNumber } from "~/lib/utils";

/**
 * Fetches budgets for a given month with calculated spend statistics.
 */
export async function getBudgets(
	db: typeof PrismaClient,
	userId: string,
	month: Date,
	options: { includeGlobal?: boolean; fiscalMonthStartDay?: number; rateCache?: RateCache; excludedProjectIds?: string[] } = {},
): Promise<BudgetWithStats[]> {
	const fiscalStartDay = options.fiscalMonthStartDay ?? 1;
	// Budget period lookup: always calendar month
	const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
	const endOfMonth = new Date(
		month.getFullYear(),
		month.getMonth() + 1,
		0,
		23,
		59,
		59,
		999,
	);
	// Expense date boundaries: fiscal month
	const fiscal = getFiscalMonthRange(month, fiscalStartDay);

	const budgets = await db.budget.findMany({
		where: {
			userId,
			...(options.includeGlobal ? {} : { categoryId: { not: null } }),
			period: {
				gte: startOfMonth,
				lte: endOfMonth,
			},
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
		orderBy: {
			category: {
				name: "asc",
			},
		},
	});

	// Fetch all finalized expenses for this fiscal month to aggregate in memory
	const personalExpenses = await db.expense.findMany({
		where: {
			userId,
			status: "FINALIZED",
			isAmortizedParent: false,
			excludeFromAnalytics: false,
			date: {
				gte: fiscal.start,
				lte: fiscal.end,
			},
		},
		select: {
			amount: true,
			currency: true,
			amountInUSD: true,
			categoryId: true,
		},
	});

	// Fetch shared expense shares for this fiscal month
	const sharedShares = await getSharedExpenseShares(db, userId, {
		gte: fiscal.start,
		lte: fiscal.end,
	}, options.rateCache, options.excludedProjectIds);

	// Merge personal and shared expenses into a unified list
	const expenses = [
		...personalExpenses,
		...sharedShares.map((s) => ({
			amount: new Prisma.Decimal(s.amount),
			currency: s.currency,
			amountInUSD: new Prisma.Decimal(s.amountInUSD),
			categoryId: s.categoryId,
		})),
	];

	// Group expenses by category
	const categoryExpensesMap = new Map<string | null, typeof expenses>();
	for (const exp of expenses) {
		const list = categoryExpensesMap.get(exp.categoryId) ?? [];
		list.push(exp);
		categoryExpensesMap.set(exp.categoryId, list);
	}

	// Fetch all expenses for the previous month only if needed
	const hasPegToLastMonth = budgets.some((b) => b.type === "PEG_TO_LAST_MONTH");
	const lastMonthExpensesMap = new Map<string | null, typeof expenses>();

	if (hasPegToLastMonth) {
		const lastMonth = new Date(month);
		lastMonth.setMonth(lastMonth.getMonth() - 1);
		const lastFiscal = getFiscalMonthRange(lastMonth, fiscalStartDay);

		const lastMonthExpenses = await db.expense.findMany({
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedParent: false,
				excludeFromAnalytics: false,
				date: {
					gte: lastFiscal.start,
					lte: lastFiscal.end,
				},
			},
			select: {
				amount: true,
				currency: true,
				amountInUSD: true,
				categoryId: true,
			},
		});

		for (const exp of lastMonthExpenses) {
			const list = lastMonthExpensesMap.get(exp.categoryId) ?? [];
			list.push(exp);
			lastMonthExpensesMap.set(exp.categoryId, list);
		}
	}

	// Cache for exchange rates to avoid repeated lookups
	const localRateCache = new Map<string, { rate: number; type: string | null }>();
	const getCachedRate = async (currency: string, date: Date) => {
		if (options.rateCache) {
			const result = await options.rateCache.get(currency, date);
			return result ?? { rate: 1, type: null };
		}
		const cacheKey = `${currency}-${date.toISOString().slice(0, 7)}`;
		if (localRateCache.has(cacheKey))
			return localRateCache.get(cacheKey) as { rate: number; type: string | null };
		const bestRate = await getBestExchangeRate(db, currency, date);
		const rateData = bestRate
			? { rate: bestRate.rate, type: bestRate.type }
			: { rate: 1, type: null };
		localRateCache.set(cacheKey, rateData);
		return rateData;
	};

	return Promise.all(
		budgets.map(async (budget): Promise<BudgetWithStats> => {
			const catExpenses =
				budget.categoryId === null
					? expenses
					: (categoryExpensesMap.get(budget.categoryId) ?? []);
			const { rate } = await getCachedRate(budget.currency, month);

			let actualSpend = 0;
			let actualSpendInUSD = 0;

			for (const exp of catExpenses) {
				const usd = Number(exp.amountInUSD);
				actualSpendInUSD += usd;
				if (exp.currency === budget.currency) {
					actualSpend += Number(exp.amount);
				} else {
					actualSpend += fromUSD(usd, budget.currency, rate);
				}
			}

			const budgetAmount = toNumber(budget.amount);
			const amountInUSD = toUSD(budgetAmount, budget.currency, rate);

			let effectiveAmount = budgetAmount;
			let effectiveAmountInUSD = amountInUSD;

			if (budget.type === "PEG_TO_ACTUAL" || budget.pegToActual) {
				effectiveAmount = actualSpend;
				effectiveAmountInUSD = actualSpendInUSD;
			} else if (budget.type === "PEG_TO_LAST_MONTH") {
				// If current month has spend, show last month's actuals as the budget
				if (actualSpend > 0) {
					const lastMonthExpenses =
						lastMonthExpensesMap.get(budget.categoryId) ?? [];
					const lastMonth = new Date(month);
					lastMonth.setMonth(lastMonth.getMonth() - 1);
					const lastMonthRate = await getCachedRate(budget.currency, lastMonth);

					let lastMonthSpend = 0;
					let lastMonthSpendInUSD = 0;

					for (const exp of lastMonthExpenses) {
						const usd = Number(exp.amountInUSD);
						lastMonthSpendInUSD += usd;
						if (exp.currency === budget.currency) {
							lastMonthSpend += Number(exp.amount);
						} else {
							lastMonthSpend += fromUSD(usd, budget.currency, lastMonthRate.rate);
						}
					}

					effectiveAmount = lastMonthSpend;
					effectiveAmountInUSD = lastMonthSpendInUSD;
				} else {
					// Hide/zero-out if no spend yet
					effectiveAmount = 0;
					effectiveAmountInUSD = 0;
				}
			}

			return {
				...budget,
				amount: budgetAmount,
				amountInUSD,
				actualSpend,
				actualSpendInUSD: actualSpendInUSD,
				effectiveAmount,
				effectiveAmountInUSD,
				rolloverAmount: toNumber(budget.rolloverAmount),
				type: budget.type as BudgetWithStats["type"],
			};
		}),
	);
}

/**
 * Fetches the global budget for a given month.
 */
export async function getGlobalBudget(
	db: typeof PrismaClient,
	userId: string,
	month: Date,
	options: { fiscalMonthStartDay?: number } = {},
) {
	const fiscalStartDay = options.fiscalMonthStartDay ?? 1;
	// Budget period lookup: calendar month
	const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
	const endOfMonth = new Date(
		month.getFullYear(),
		month.getMonth() + 1,
		0,
		23,
		59,
		59,
		999,
	);
	// Expense boundaries: fiscal month
	const fiscal = getFiscalMonthRange(month, fiscalStartDay);

	const globalBudget = await db.budget.findFirst({
		where: {
			userId,
			categoryId: null,
			period: {
				gte: startOfMonth,
				lte: endOfMonth,
			},
		},
	});

	if (!globalBudget) return null;

	const { totalInUSD: totalSpendAsNumber } = await sumExpensesForCurrency(
		db,
		{
			userId,
			isAmortizedParent: false,
			date: {
				gte: fiscal.start,
				lte: fiscal.end,
			},
		},
		globalBudget.currency,
	);

	const budgetAmount = toNumber(globalBudget.amount);
	const bestRate = await getBestExchangeRate(
		db,
		globalBudget.currency,
		new Date(),
	);
	const rate = bestRate?.rate ?? 1;

	const amountInUSD = toUSD(budgetAmount, globalBudget.currency, rate);

	return {
		...globalBudget,
		amount: budgetAmount,
		amountInUSD,
		actualSpend: totalSpendAsNumber,
		rolloverAmount: toNumber(globalBudget.rolloverAmount),
	};
}

/**
 * Generates budget suggestions based on the last 3 months of spending.
 */
export async function getSuggestions(
	db: typeof PrismaClient,
	userId: string,
	categoryId: string,
	currency = "USD",
	fiscalMonthStartDay = 1,
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

	const threeMonthsAgo = new Date();
	threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

	// Fetch all 3 months in parallel
	const monthLabels = Array.from({ length: 3 }, (_, i) =>
		new Date(threeMonthsAgo.getFullYear(), threeMonthsAgo.getMonth() + i, 1),
	);
	const results = await Promise.all(
		monthLabels.map((monthLabel) => {
			const fiscal = getFiscalMonthRange(monthLabel, fiscalMonthStartDay);
			return sumExpensesForCurrency(
				db,
				{
					userId,
					categoryId,
					isAmortizedParent: false,
					date: { gte: fiscal.start, lte: fiscal.end },
				},
				currency,
			);
		}),
	);
	const monthlySpends = results
		.map((r) => r.total)
		.filter((amount) => amount > 0);

	if (monthlySpends.length === 0) {
		return { suggestedAmount: 0, averageSpend: 0, lastMonthSpend: 0 };
	}

	const averageSpend =
		monthlySpends.reduce((sum, v) => sum + v, 0) / monthlySpends.length;
	const lastMonthSpend = monthlySpends[monthlySpends.length - 1] ?? 0;

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
		suggestedAmount: Math.round(median * 100) / 100,
		averageSpend: Math.round(averageSpend * 100) / 100,
		lastMonthSpend: Math.round(lastMonthSpend * 100) / 100,
	};
}

/**
 * Copies budgets from the most recent month that has them.
 */
export async function copyFromLastMonth(
	db: typeof PrismaClient,
	userId: string,
	targetMonth: Date,
) {
	const targetPeriod = new Date(
		targetMonth.getFullYear(),
		targetMonth.getMonth(),
		1,
	);

	const existingBudgets = await db.budget.findMany({
		where: { userId, period: targetPeriod, categoryId: { not: null } },
	});

	if (existingBudgets.length > 0) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Budgets already exist for this month",
		});
	}

	const budgetsByMonth = await db.budget.groupBy({
		by: ["period"],
		where: { userId, categoryId: { not: null }, period: { not: targetPeriod } },
		_count: { period: true },
		orderBy: { period: "desc" },
	});

	if (budgetsByMonth.length === 0 || !budgetsByMonth[0]) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "No budgets found to copy from",
		});
	}

	const sourceMonth = budgetsByMonth[0].period;
	const sourceMonthStart = new Date(
		sourceMonth.getFullYear(),
		sourceMonth.getMonth(),
		1,
	);
	const sourceMonthEnd = new Date(
		sourceMonth.getFullYear(),
		sourceMonth.getMonth() + 1,
		0,
		23,
		59,
		59,
		999,
	);

	const sourceBudgets = await db.budget.findMany({
		where: {
			userId,
			categoryId: { not: null },
			period: { gte: sourceMonthStart, lte: sourceMonthEnd },
		},
	});

	const copiedBudgets = await Promise.all(
		sourceBudgets.map(async (sourceBudget) => {
			return await db.budget.create({
				data: {
					userId,
					categoryId: sourceBudget.categoryId,
					amount: sourceBudget.amount,
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
