import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const dashboardRouter = createTRPCRouter({
	getOverviewStats: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		// Get current month dates
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const endOfMonth = new Date(
			now.getFullYear(),
			now.getMonth() + 1,
			0,
			23,
			59,
			59,
			999,
		);

		// Calculate days remaining in the month
		const daysInMonth = endOfMonth.getDate();
		const currentDay = now.getDate();
		const daysRemaining = Math.max(0, daysInMonth - currentDay + 1);

		// 1. last24Hours: Sum of expenses in the last 24 hours
		const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const last24HoursSpend = await db.expense.aggregate({
			where: {
				userId: session.user.id,
				date: {
					gte: last24Hours,
				},
				status: "FINALIZED",
			},
			_sum: {
				amountInUSD: true,
			},
		});

		// 2. dailyBudgetPace: Global budget and total spent for current month
		const globalBudget = await db.budget.findFirst({
			where: {
				userId: session.user.id,
				categoryId: null, // Global budget has no category
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

		const monthSpend = await db.expense.aggregate({
			where: {
				userId: session.user.id,
				date: {
					gte: startOfMonth,
					lte: endOfMonth,
				},
				status: "FINALIZED",
			},
			_sum: {
				amountInUSD: true,
			},
		});

		const totalSpent = Number(monthSpend._sum.amountInUSD ?? 0);

		// 3. workEquivalent: Total spent and monthly income
		const user = await db.user.findUnique({
			where: { id: session.user.id },
			select: {
				monthlyIncome: true,
			},
		});

		const monthlyIncome = Number(user?.monthlyIncome ?? 0);

		return {
			last24Hours: Number(last24HoursSpend._sum.amountInUSD ?? 0),
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
