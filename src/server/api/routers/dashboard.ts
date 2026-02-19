import { z } from "zod";
import * as BudgetService from "~/server/services/budget.service";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getBestExchangeRate, sumExpensesForCurrency } from "./shared-currency";

export const dashboardRouter = createTRPCRouter({
	getOverviewStats: protectedProcedure
		.input(
			z
				.object({
					month: z.date().optional(),
					homeCurrency: z.string().length(3).optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;

			const selectedDate = input?.month ?? new Date();
			const now = new Date();
			const homeCurrency = input?.homeCurrency ?? "USD";

			const endOfMonth = new Date(
				selectedDate.getFullYear(),
				selectedDate.getMonth() + 1,
				0,
				23,
				59,
				59,
				999,
			);

			const isCurrentMonth =
				selectedDate.getFullYear() === now.getFullYear() &&
				selectedDate.getMonth() === now.getMonth();

			const daysInMonth = endOfMonth.getDate();
			const currentDay = now.getDate();
			const daysRemaining = isCurrentMonth
				? Math.max(0, daysInMonth - currentDay + 1)
				: 0;

			let last24HoursSpend = 0;
			if (isCurrentMonth) {
				const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
				const { total } = await sumExpensesForCurrency(
					db,
					{
						userId: session.user.id,
						isAmortizedParent: false,
						date: {
							gte: last24Hours,
						},
					},
					homeCurrency,
				);
				last24HoursSpend = total;
			}

			const homeCurrencyRate = (await getBestExchangeRate(db, homeCurrency, selectedDate)) ?? 1;

			const detailedBudgets = await BudgetService.getBudgets(
				db,
				session.user.id,
				selectedDate,
				{ includeGlobal: true },
			);

			const globalBudget = detailedBudgets.find((b) => b.categoryId === null);
			const globalBudgetLimit = globalBudget
				? globalBudget.effectiveAmountInUSD * homeCurrencyRate
				: 0;

			const categoryBudgets = detailedBudgets.filter(
				(b) => b.categoryId !== null,
			);

			const FIXED_NAMES = [
				"rent",
				"utilities",
				"mortgage",
				"bills",
				"insurance",
			];

			// 1. Calculate Sums
			const fixedBudgetsSum = categoryBudgets
				.filter(
					(b: BudgetService.BudgetWithStats) =>
						b.category?.isFixed ||
						FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? ""),
				)
				.reduce(
					(sum: number, b: BudgetService.BudgetWithStats) =>
						sum + b.effectiveAmountInUSD * homeCurrencyRate,
					0,
				);

			const explicitVariableBudgetsSum = categoryBudgets
				.filter(
					(b: BudgetService.BudgetWithStats) =>
						!(
							b.category?.isFixed ||
							FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? "")
						),
				)
				.reduce(
					(sum: number, b: BudgetService.BudgetWithStats) =>
						sum + b.effectiveAmountInUSD * homeCurrencyRate,
					0,
				);

			// Calculate adjustment for pegged budgets to expand the global limit if used
			// This ensures pegged expenses don't cause an "over budget" state in the global progress card
			const peggedAdjustment = categoryBudgets
				.filter(
					(b: BudgetService.BudgetWithStats) =>
						b.type === "PEG_TO_ACTUAL" || b.pegToActual,
				)
				.reduce(
					(sum: number, b: BudgetService.BudgetWithStats) =>
						sum + b.actualSpendInUSD * homeCurrencyRate,
					0,
				);

			// 2. Determine "Total Budget" for the month
			// If no global budget limit is set, we use the sum of all category budgets as the total
			const totalBudget =
				globalBudgetLimit > 0
					? globalBudgetLimit + peggedAdjustment
					: fixedBudgetsSum + explicitVariableBudgetsSum;

			// 3. Determine "Variable Budget"
			// Logic: use sum of explicit variable categories if present,
			// otherwise residual from the total budget minuse fixed costs.
			const residualVariableBudget = Math.max(0, totalBudget - fixedBudgetsSum);

			let variableBudget =
				explicitVariableBudgetsSum > 0
					? explicitVariableBudgetsSum
					: residualVariableBudget;

			// Final fallback: if everything is 0 but we have a totalBudget,
			// use totalBudget as the variable budget line to prevent flatline.
			if (variableBudget === 0 && totalBudget > 0) {
				variableBudget = totalBudget;
			}

			// Get total spent and variable spent from the detailed budgets
			const totalSpent = globalBudget
				? globalBudget.actualSpendInUSD * homeCurrencyRate
				: categoryBudgets.reduce(
						(sum: number, b: BudgetService.BudgetWithStats) =>
							sum + b.actualSpendInUSD * homeCurrencyRate,
						0,
					);

			const variableSpent = categoryBudgets
				.filter(
					(b: BudgetService.BudgetWithStats) =>
						!(
							b.category?.isFixed ||
							FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? "")
						),
				)
				.reduce(
					(sum: number, b: BudgetService.BudgetWithStats) =>
						sum + b.actualSpendInUSD * homeCurrencyRate,
					0,
				);

			const user = await db.user.findUnique({
				where: { id: session.user.id },
				select: {
					monthlyIncome: true,
				},
			});

			const monthlyIncome = Number(user?.monthlyIncome ?? 0);

			return {
				last24Hours: last24HoursSpend,
				isCurrentMonth,
				monthTotal: totalSpent,
				dailyBudgetPace: {
					totalBudget,
					totalSpent,
					variableBudget: variableBudget || totalBudget, // Fallback to total if no fixed
					variableSpent,
					daysRemaining,
				},
				workEquivalent: {
					totalSpent,
					monthlyIncome,
				},
			};
		}),
});
