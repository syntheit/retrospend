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
						date: {
							gte: last24Hours,
						},
					},
					homeCurrency,
				);
				last24HoursSpend = total;
			}

			const globalBudget = await db.budget.findFirst({
				where: {
					userId: session.user.id,
					categoryId: null,
					period: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
				},
				select: {
					amount: true,
				},
			});

			const totalBudget = globalBudget ? Number(globalBudget.amount) : 0;

			const { total: totalSpent } = await sumExpensesForCurrency(
				db,
				{
					userId: session.user.id,
					date: {
						gte: startOfMonth,
						lte: endOfMonth,
					},
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
					daysRemaining,
				},
				workEquivalent: {
					totalSpent,
					monthlyIncome,
				},
			};
		}),
});
