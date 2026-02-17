import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sumExpensesForCurrency } from "./shared-currency";

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

			const startOfMonth = new Date(
				selectedDate.getFullYear(),
				selectedDate.getMonth(),
				1,
			);
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

			const allBudgets = await db.budget.findMany({
				where: {
					userId: session.user.id,
					period: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
				},
				include: {
					category: {
						select: {
							name: true,
							isFixed: true,
						},
					},
				},
			});

			const globalBudget = allBudgets.find((b) => b.categoryId === null);
			const globalBudgetLimit = globalBudget ? Number(globalBudget.amount) : 0;

			const FIXED_NAMES = [
				"rent",
				"utilities",
				"mortgage",
				"bills",
				"insurance",
			];

			// 1. Calculate Sums
			const fixedBudgetsSum = allBudgets
				.filter(
					(b) =>
						b.categoryId !== null &&
						(b.category?.isFixed ||
							FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? "")),
				)
				.reduce((sum, b) => sum + Number(b.amount), 0);

			const explicitVariableBudgetsSum = allBudgets
				.filter(
					(b) =>
						b.categoryId !== null &&
						!(
							b.category?.isFixed ||
							FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? "")
						),
				)
				.reduce((sum, b) => sum + Number(b.amount), 0);

			// 2. Determine "Total Budget" for the month
			// If no global budget limit is set, we use the sum of all category budgets as the total
			const totalBudget =
				globalBudgetLimit > 0
					? globalBudgetLimit
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

			// If STILL 0, check if there's ANY income to use as a "reasonable default" gauge?
			// Or just accept the user has no budgets.
			// But the user specifically wants the ~$600 one to show.

			const { total: totalSpent } = await sumExpensesForCurrency(
				db,
				{
					userId: session.user.id,
					isAmortizedParent: false,
					date: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
				},
				homeCurrency,
			);

			// Also calculate variable spent for the header stat
			// We'll need a way to sum expenses for non-fixed categories
			const fixedCategories = await db.category.findMany({
				where: {
					userId: session.user.id,
					OR: [
						{ isFixed: true },
						{
							name: {
								in: FIXED_NAMES,
								mode: "insensitive",
							},
						},
					],
				},
				select: { id: true },
			});
			const fixedCategoryIds = fixedCategories.map((c) => c.id);

			const { total: variableSpent } = await sumExpensesForCurrency(
				db,
				{
					userId: session.user.id,
					isAmortizedParent: false,
					date: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
					OR: [
						{ categoryId: { notIn: fixedCategoryIds } },
						{ categoryId: null }, // Uncategorized is usually variable
					],
				},
				homeCurrency,
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
