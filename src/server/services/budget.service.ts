import { TRPCError } from "@trpc/server";
import type { db as PrismaClient } from "~/server/db";
import {
	getBestExchangeRate,
	sumExpensesForCurrency,
} from "../api/routers/shared-currency";

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
	options: { includeGlobal?: boolean } = {},
): Promise<BudgetWithStats[]> {
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

	// Fetch all finalized expenses for this month to aggregate in memory
	const expenses = await db.expense.findMany({
		where: {
			userId,
			status: "FINALIZED",
			isAmortizedParent: false,
			date: {
				gte: startOfMonth,
				lte: endOfMonth,
			},
		},
		select: {
			amount: true,
			currency: true,
			amountInUSD: true,
			categoryId: true,
		},
	});

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
		const startOfLastMonth = new Date(
			lastMonth.getFullYear(),
			lastMonth.getMonth(),
			1,
		);
		const endOfLastMonth = new Date(
			lastMonth.getFullYear(),
			lastMonth.getMonth() + 1,
			0,
			23,
			59,
			59,
			999,
		);

		const lastMonthExpenses = await db.expense.findMany({
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedParent: false,
				date: {
					gte: startOfLastMonth,
					lte: endOfLastMonth,
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
	const rateCache = new Map<string, { rate: number; type: string | null }>();
	const getCachedRate = async (currency: string, date: Date) => {
		const cacheKey = `${currency}-${date.toISOString().slice(0, 7)}`;
		if (rateCache.has(cacheKey))
			return rateCache.get(cacheKey) as { rate: number; type: string | null };
		const bestRate = await getBestExchangeRate(db, currency, date);
		const rateData = bestRate
			? { rate: bestRate.rate, type: bestRate.type }
			: { rate: 1, type: null };
		rateCache.set(cacheKey, rateData);
		return rateData;
	};

	return Promise.all(
		budgets.map(async (budget): Promise<BudgetWithStats> => {
			const catExpenses =
				budget.categoryId === null
					? expenses
					: (categoryExpensesMap.get(budget.categoryId) ?? []);
			const { rate, type } = await getCachedRate(budget.currency, month);
			const isCrypto = type === "crypto";

			let actualSpend = 0;
			let actualSpendInUSD = 0;

			for (const exp of catExpenses) {
				const usd = Number(exp.amountInUSD);
				actualSpendInUSD += usd;
				if (exp.currency === budget.currency) {
					actualSpend += Number(exp.amount);
				} else {
					// USD to Native: multiply for fiat, divide for crypto
					actualSpend += isCrypto ? usd / rate : usd * rate;
				}
			}

			const budgetAmount = toNumber(budget.amount);
			// Native to USD: divide for fiat, multiply for crypto
			const amountInUSD = isCrypto ? budgetAmount * rate : budgetAmount / rate;

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
							lastMonthSpend +=
								lastMonthRate.type === "crypto"
									? usd / lastMonthRate.rate
									: usd * lastMonthRate.rate;
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
) {
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
				gte: startOfMonth,
				lte: endOfMonth,
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
	const isCrypto = bestRate?.type === "crypto";

	const amountInUSD = isCrypto ? budgetAmount * rate : budgetAmount / rate;

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

	const monthlySpends: number[] = [];

	for (let i = 0; i < 3; i++) {
		const monthStart = new Date(
			threeMonthsAgo.getFullYear(),
			threeMonthsAgo.getMonth() + i,
			1,
		);
		const monthEnd = new Date(
			threeMonthsAgo.getFullYear(),
			threeMonthsAgo.getMonth() + i + 1,
			0,
			23,
			59,
			59,
			999,
		);

		const { total: amount } = await sumExpensesForCurrency(
			db,
			{
				userId,
				categoryId,
				isAmortizedParent: false,
				date: {
					gte: monthStart,
					lte: monthEnd,
				},
			},
			currency,
		);

		if (amount > 0) monthlySpends.push(amount);
	}

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
