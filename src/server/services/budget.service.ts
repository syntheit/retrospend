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
	} | null;
}

export const toNumber = (value: unknown): number => {
	return typeof value === "object" && value !== null && "toNumber" in value
		? (value as { toNumber: () => number }).toNumber()
		: Number(value);
};

/**
 * Fetches budgets for a given month with calculated spend statistics.
 */
export async function getBudgets(
	db: typeof PrismaClient,
	userId: string,
	month: Date,
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
			categoryId: { not: null },
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
				},
			},
		},
		orderBy: {
			category: {
				name: "asc",
			},
		},
	});

	return Promise.all(
		budgets.map(async (budget): Promise<BudgetWithStats> => {
			const { total: actualSpend, totalInUSD: spendInUSDNumber } =
				await sumExpensesForCurrency(
					db,
					{
						userId,
						categoryId: budget.categoryId,
						isAmortizedParent: false,
						date: {
							gte: startOfMonth,
							lte: endOfMonth,
						},
					},
					budget.currency,
					month,
				);

			const rate =
				(await getBestExchangeRate(db, budget.currency, new Date())) ?? 1;

			const budgetAmount = toNumber(budget.amount);
			const amountInUSD = rate > 0 ? budgetAmount / rate : budgetAmount;

			let effectiveAmount = budgetAmount;
			let effectiveAmountInUSD = amountInUSD;

			if (budget.type === "PEG_TO_ACTUAL" || budget.pegToActual) {
				effectiveAmount = actualSpend;
				effectiveAmountInUSD = spendInUSDNumber;
			} else if (budget.type === "PEG_TO_LAST_MONTH") {
				// If current month has spend, show last month's actuals as the budget
				if (actualSpend > 0) {
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

					const { total: lastMonthSpend, totalInUSD: lastMonthSpendInUSD } =
						await sumExpensesForCurrency(
							db,
							{
								userId,
								categoryId: budget.categoryId,
								isAmortizedParent: false,
								date: {
									gte: startOfLastMonth,
									lte: endOfLastMonth,
								},
							},
							budget.currency,
							lastMonth,
						);

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
				actualSpendInUSD: spendInUSDNumber,
				effectiveAmount,
				effectiveAmountInUSD,
				rolloverAmount: toNumber(budget.rolloverAmount),
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

	const globalBudgetAmount = toNumber(globalBudget.amount);
	const rate =
		(await getBestExchangeRate(db, globalBudget.currency, new Date())) ?? 1;
	const amountInUSD = rate > 0 ? globalBudgetAmount / rate : globalBudgetAmount;

	return {
		...globalBudget,
		amount: globalBudgetAmount,
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
					category: { select: { id: true, name: true, color: true } },
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
