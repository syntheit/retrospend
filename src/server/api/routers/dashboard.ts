import { z } from "zod";
import { getFiscalMonthProgress, getFiscalMonthRange } from "~/lib/fiscal-month";
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

			const userSettings = await db.user.findUnique({
				where: { id: session.user.id },
				select: { fiscalMonthStartDay: true },
			});
			const fiscalStartDay = userSettings?.fiscalMonthStartDay ?? 1;
			const fiscal = getFiscalMonthRange(selectedDate, fiscalStartDay);
			const fiscalProgress = getFiscalMonthProgress(now, selectedDate, fiscalStartDay);

			const isCurrentMonth = fiscalProgress.isCurrentPeriod;
			const daysRemaining = fiscalProgress.daysRemaining;

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
				{ includeGlobal: true, fiscalMonthStartDay: fiscalStartDay },
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
				select: { monthlyIncome: true, monthlyIncomeCurrency: true },
			});

			const rawIncome = Number(user?.monthlyIncome ?? 0);
			const incomeCurrency = user?.monthlyIncomeCurrency ?? "USD";

			let monthlyIncome = rawIncome;
			if (rawIncome > 0 && incomeCurrency !== homeCurrency) {
				let incomeInUSD: number;
				if (incomeCurrency === "USD") {
					incomeInUSD = rawIncome;
				} else {
					const incomeRate = await getBestExchangeRate(db, incomeCurrency, selectedDate);
					const incomeRateVal = Number(incomeRate?.rate ?? 1);
					const isIncomeCrypto = incomeRate?.type === "crypto";
					incomeInUSD = isIncomeCrypto ? rawIncome * incomeRateVal : rawIncome / incomeRateVal;
				}
				monthlyIncome = isHomeCrypto
					? incomeInUSD / homeCurrencyRate
					: incomeInUSD * homeCurrencyRate;
			}

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

			const userSettings = await db.user.findUnique({
				where: { id: userId },
				select: { fiscalMonthStartDay: true },
			});
			const fiscalStartDay = userSettings?.fiscalMonthStartDay ?? 1;

			const expenseService = new ExpenseService(db);
			const statsService = new StatsService(db);

			const fetchOverviewStats = async () => {
				const selectedDate = month;
				const now = new Date();
				const fiscalProgress = getFiscalMonthProgress(now, selectedDate, fiscalStartDay);

				const isCurrentMonth = fiscalProgress.isCurrentPeriod;
				const daysRemaining = fiscalProgress.daysRemaining;

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
					{ includeGlobal: true, fiscalMonthStartDay: fiscalStartDay },
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

				const incomeUser = await db.user.findUnique({
					where: { id: userId },
					select: { monthlyIncome: true, monthlyIncomeCurrency: true },
				});

				const rawIncome = Number(incomeUser?.monthlyIncome ?? 0);
				const incomeCurrency = incomeUser?.monthlyIncomeCurrency ?? "USD";

				let monthlyIncome = rawIncome;
				if (rawIncome > 0 && incomeCurrency !== homeCurrency) {
					let incomeInUSD: number;
					if (incomeCurrency === "USD") {
						incomeInUSD = rawIncome;
					} else {
						const incomeRate = await getBestExchangeRate(db, incomeCurrency, selectedDate);
						const incomeRateVal = Number(incomeRate?.rate ?? 1);
						const isIncomeCrypto = incomeRate?.type === "crypto";
						incomeInUSD = isIncomeCrypto ? rawIncome * incomeRateVal : rawIncome / incomeRateVal;
					}
					monthlyIncome = isHomeCrypto
						? incomeInUSD / homeCurrencyRate
						: incomeInUSD * homeCurrencyRate;
				}

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
				statsService.getSummaryStats(userId, month, homeCurrency, fiscalStartDay),
				statsService.getCategoryBreakdown(userId, month, homeCurrency, fiscalStartDay),
				statsService.getDailyTrend(userId, month, homeCurrency, fiscalStartDay),
			]);

			return {
				expenses,
				favorites,
				overviewStats,
				earliestBudgetMonth,
				summaryStats,
				categoryData,
				trendData,
				serverTime: new Date(), // Return server's current time for consistent timezone handling
			};
		}),
});
