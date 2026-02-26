import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import * as BudgetService from "~/server/services/budget.service";
import { ExpenseService } from "~/server/services/expense.service";
import { StatsService } from "~/server/services/stats.service";
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

			const bestHomeRate = await getBestExchangeRate(
				db,
				homeCurrency,
				selectedDate,
			);
			const homeCurrencyRate = bestHomeRate?.rate ?? 1;
			const isHomeCrypto = bestHomeRate?.type === "crypto";

			const detailedBudgets = await BudgetService.getBudgets(
				db,
				session.user.id,
				selectedDate,
				{ includeGlobal: true },
			);

			const globalBudget = detailedBudgets.find((b) => b.categoryId === null);
			const globalBudgetLimit = globalBudget
				? isHomeCrypto
					? globalBudget.effectiveAmountInUSD / homeCurrencyRate
					: globalBudget.effectiveAmountInUSD * homeCurrencyRate
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
				.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
					const val = isHomeCrypto
						? b.effectiveAmountInUSD / homeCurrencyRate
						: b.effectiveAmountInUSD * homeCurrencyRate;
					return sum + val;
				}, 0);

			const explicitVariableBudgetsSum = categoryBudgets
				.filter(
					(b: BudgetService.BudgetWithStats) =>
						!(
							b.category?.isFixed ||
							FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? "")
						),
				)
				.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
					const val = isHomeCrypto
						? b.effectiveAmountInUSD / homeCurrencyRate
						: b.effectiveAmountInUSD * homeCurrencyRate;
					return sum + val;
				}, 0);

			// Calculate adjustment for pegged budgets to expand the global limit if used
			// This ensures pegged expenses don't cause an "over budget" state in the global progress card
			const peggedAdjustment = categoryBudgets
				.filter(
					(b: BudgetService.BudgetWithStats) =>
						b.type === "PEG_TO_ACTUAL" || b.pegToActual,
				)
				.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
					const val = isHomeCrypto
						? b.actualSpendInUSD / homeCurrencyRate
						: b.actualSpendInUSD * homeCurrencyRate;
					return sum + val;
				}, 0);

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
				? isHomeCrypto
					? globalBudget.actualSpendInUSD / homeCurrencyRate
					: globalBudget.actualSpendInUSD * homeCurrencyRate
				: categoryBudgets.reduce(
						(sum: number, b: BudgetService.BudgetWithStats) => {
							const val = isHomeCrypto
								? b.actualSpendInUSD / homeCurrencyRate
								: b.actualSpendInUSD * homeCurrencyRate;
							return sum + val;
						},
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
				.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
					const val = isHomeCrypto
						? b.actualSpendInUSD / homeCurrencyRate
						: b.actualSpendInUSD * homeCurrencyRate;
					return sum + val;
				}, 0);

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
	getOverviewData: protectedProcedure
		.input(
			z.object({
				month: z.date(),
				homeCurrency: z.string().length(3),
			}),
		)
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;
			const { month, homeCurrency } = input;
			const userId = session.user.id;

			const expenseService = new ExpenseService(db);
			const statsService = new StatsService(db);

			// We call our own route logic for overviewStats to avoid duplication
			// This is a bit non-idiomatic in tRPC to call other procedures directly,
			// so we would normally extract the logic. But for simplicity and to follow the strategy
			// of shifting burden to server, we can just execute the logic.

			// Helper to get overview stats logic (copied from above for conciseness in Promise.all)
			const fetchOverviewStats = async () => {
				const selectedDate = month;
				const now = new Date();
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

				const bestHomeRate = await getBestExchangeRate(
					db,
					homeCurrency,
					selectedDate,
				);
				const homeCurrencyRate = bestHomeRate?.rate ?? 1;
				const isHomeCrypto = bestHomeRate?.type === "crypto";

				const detailedBudgets = await BudgetService.getBudgets(
					db,
					session.user.id,
					selectedDate,
					{ includeGlobal: true },
				);

				const globalBudget = detailedBudgets.find((b) => b.categoryId === null);
				const globalBudgetLimit = globalBudget
					? isHomeCrypto
						? globalBudget.effectiveAmountInUSD / homeCurrencyRate
						: globalBudget.effectiveAmountInUSD * homeCurrencyRate
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

				const fixedBudgetsSum = categoryBudgets
					.filter(
						(b: BudgetService.BudgetWithStats) =>
							b.category?.isFixed ||
							FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? ""),
					)
					.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
						const val = isHomeCrypto
							? b.effectiveAmountInUSD / homeCurrencyRate
							: b.effectiveAmountInUSD * homeCurrencyRate;
						return sum + val;
					}, 0);

				const explicitVariableBudgetsSum = categoryBudgets
					.filter(
						(b: BudgetService.BudgetWithStats) =>
							!(
								b.category?.isFixed ||
								FIXED_NAMES.includes(b.category?.name.toLowerCase() ?? "")
							),
					)
					.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
						const val = isHomeCrypto
							? b.effectiveAmountInUSD / homeCurrencyRate
							: b.effectiveAmountInUSD * homeCurrencyRate;
						return sum + val;
					}, 0);

				const peggedAdjustment = categoryBudgets
					.filter(
						(b: BudgetService.BudgetWithStats) =>
							b.type === "PEG_TO_ACTUAL" || b.pegToActual,
					)
					.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
						const val = isHomeCrypto
							? b.actualSpendInUSD / homeCurrencyRate
							: b.actualSpendInUSD * homeCurrencyRate;
						return sum + val;
					}, 0);

				const totalBudget =
					globalBudgetLimit > 0
						? globalBudgetLimit + peggedAdjustment
						: fixedBudgetsSum + explicitVariableBudgetsSum;

				const residualVariableBudget = Math.max(
					0,
					totalBudget - fixedBudgetsSum,
				);

				let variableBudget =
					explicitVariableBudgetsSum > 0
						? explicitVariableBudgetsSum
						: residualVariableBudget;

				if (variableBudget === 0 && totalBudget > 0) {
					variableBudget = totalBudget;
				}

				const totalSpent = globalBudget
					? isHomeCrypto
						? globalBudget.actualSpendInUSD / homeCurrencyRate
						: globalBudget.actualSpendInUSD * homeCurrencyRate
					: categoryBudgets.reduce(
							(sum: number, b: BudgetService.BudgetWithStats) => {
								const val = isHomeCrypto
									? b.actualSpendInUSD / homeCurrencyRate
									: b.actualSpendInUSD * homeCurrencyRate;
								return sum + val;
							},
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
					.reduce((sum: number, b: BudgetService.BudgetWithStats) => {
						const val = isHomeCrypto
							? b.actualSpendInUSD / homeCurrencyRate
							: b.actualSpendInUSD * homeCurrencyRate;
						return sum + val;
					}, 0);

				const user = await db.user.findUnique({
					where: { id: userId },
					select: { monthlyIncome: true },
				});

				const monthlyIncome = Number(user?.monthlyIncome ?? 0);

				return {
					last24Hours: last24HoursSpend,
					isCurrentMonth,
					monthTotal: totalSpent,
					dailyBudgetPace: {
						totalBudget,
						totalSpent,
						variableBudget: variableBudget || totalBudget,
						variableSpent,
						daysRemaining,
					},
					workEquivalent: {
						totalSpent,
						monthlyIncome,
					},
				};
			};

			const [
				expenses,
				favorites,
				overviewStats,
				earliestBudgetMonth,
				summaryStats,
				categoryData,
				trendData,
			] = await Promise.all([
				expenseService.listFinalized(userId),
				db.exchangeRateFavorite
					.findMany({
						where: { userId },
						include: { exchangeRate: true },
						orderBy: { order: "asc" },
					})
					.then((favs) =>
						favs.map((f) => ({
							id: f.exchangeRateId,
							order: f.order,
							rate: f.exchangeRate,
						})),
					),
				fetchOverviewStats(),
				db.budget
					.findFirst({
						where: { userId },
						orderBy: { period: "asc" },
						select: { period: true },
					})
					.then((b) => b?.period ?? null),
				statsService.getSummaryStats(userId, month, homeCurrency),
				statsService.getCategoryBreakdown(userId, month, homeCurrency),
				statsService.getDailyTrend(userId, month, homeCurrency),
			]);

			return {
				expenses,
				favorites,
				overviewStats,
				earliestBudgetMonth,
				summaryStats,
				categoryData,
				trendData,
			};
		}),
});
