import { z } from "zod";
import {
	getFiscalMonthProgress,
	getFiscalMonthRange,
} from "~/lib/fiscal-month";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import * as BudgetService from "~/server/services/budget.service";
import {
	getExcludedProjectIds,
	getSharedExpenseShares,
	getSharedExpenseTotalInUSD,
	listSharedParticipationsForUser,
} from "~/server/services/shared-expense-integration";
import { RateCache } from "~/server/services/rate-cache";
import { StatsService } from "~/server/services/stats.service";
import { fromUSD, toUSD } from "~/server/currency";
import { getBestExchangeRate, sumExpensesForCurrency } from "./shared-currency";

/** Category names treated as "fixed" for budget pacing calculations */
const FIXED_CATEGORY_NAMES = ["rent", "utilities", "mortgage", "bills", "insurance"];

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

			const rateCache = new RateCache(db);

			// Single query for all user settings needed by this procedure
			const [userSettings, excludedProjectIds] = await Promise.all([
				db.user.findUnique({
					where: { id: session.user.id },
					select: {
						fiscalMonthStartDay: true,
						monthlyIncome: true,
						monthlyIncomeCurrency: true,
					},
				}),
				getExcludedProjectIds(db, session.user.id),
			]);
			const fiscalStartDay = userSettings?.fiscalMonthStartDay ?? 1;
			const fiscal = getFiscalMonthRange(selectedDate, fiscalStartDay);
			const fiscalProgress = getFiscalMonthProgress(
				now,
				selectedDate,
				fiscalStartDay,
			);

			const isCurrentMonth = fiscalProgress.isCurrentPeriod;
			const daysRemaining = fiscalProgress.daysRemaining;

			let last24HoursSpend = 0;
			if (isCurrentMonth) {
				const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
				const [{ total: personalTotal }, sharedTotalUSD] = await Promise.all([
					sumExpensesForCurrency(
						db,
						{
							userId: session.user.id,
							isAmortizedParent: false,
							date: {
								gte: last24Hours,
							},
						},
						homeCurrency,
					),
					getSharedExpenseTotalInUSD(db, session.user.id, {
						gte: last24Hours,
					}, rateCache, excludedProjectIds),
				]);
				const homeRate = await rateCache.get(homeCurrency, selectedDate);
				const hRate = homeRate?.rate ?? 1;
				const sharedInHome = fromUSD(sharedTotalUSD, homeCurrency, hRate);
				last24HoursSpend = personalTotal + sharedInHome;
			}

			const bestHomeRate = await rateCache.get(homeCurrency, selectedDate);
			const homeCurrencyRate = bestHomeRate?.rate ?? 1;

			const detailedBudgets = await BudgetService.getBudgets(
				db,
				session.user.id,
				selectedDate,
				{ includeGlobal: true, fiscalMonthStartDay: fiscalStartDay, rateCache, excludedProjectIds },
			);

			const toHome = (usd: number) => fromUSD(usd, homeCurrency, homeCurrencyRate);

			const globalBudget = detailedBudgets.find((b) => b.categoryId === null);
			const globalBudgetLimit = globalBudget
				? toHome(globalBudget.effectiveAmountInUSD)
				: 0;

			const categoryBudgets = detailedBudgets.filter(
				(b) => b.categoryId !== null,
			);

			const isFixed = (b: BudgetService.BudgetWithStats) =>
				b.category?.isFixed ||
				FIXED_CATEGORY_NAMES.includes(b.category?.name.toLowerCase() ?? "");

			// 1. Calculate Sums
			const fixedBudgetsSum = categoryBudgets
				.filter(isFixed)
				.reduce((sum: number, b) => sum + toHome(b.effectiveAmountInUSD), 0);

			const explicitVariableBudgetsSum = categoryBudgets
				.filter((b) => !isFixed(b))
				.reduce((sum: number, b) => sum + toHome(b.effectiveAmountInUSD), 0);

			const peggedAdjustment = categoryBudgets
				.filter((b) => b.type === "PEG_TO_ACTUAL" || b.pegToActual)
				.reduce((sum: number, b) => sum + toHome(b.actualSpendInUSD), 0);

			// 2. Determine "Total Budget" for the month
			const totalBudget =
				globalBudgetLimit > 0
					? globalBudgetLimit + peggedAdjustment
					: fixedBudgetsSum + explicitVariableBudgetsSum;

			// 3. Determine "Variable Budget"
			const residualVariableBudget = Math.max(0, totalBudget - fixedBudgetsSum);

			let variableBudget =
				explicitVariableBudgetsSum > 0
					? explicitVariableBudgetsSum
					: residualVariableBudget;

			if (variableBudget === 0 && totalBudget > 0) {
				variableBudget = totalBudget;
			}

			const totalSpent = globalBudget
				? toHome(globalBudget.actualSpendInUSD)
				: categoryBudgets.reduce(
						(sum: number, b) => sum + toHome(b.actualSpendInUSD),
						0,
					);

			const variableSpent = categoryBudgets
				.filter((b) => !isFixed(b))
				.reduce((sum: number, b) => sum + toHome(b.actualSpendInUSD), 0);

			const rawIncome = Number(userSettings?.monthlyIncome ?? 0);
			const incomeCurrency = userSettings?.monthlyIncomeCurrency ?? "USD";

			let monthlyIncome = rawIncome;
			if (rawIncome > 0 && incomeCurrency !== homeCurrency) {
				let incomeInUSD: number;
				if (incomeCurrency === "USD") {
					incomeInUSD = rawIncome;
				} else {
					const incomeRate = await rateCache.get(incomeCurrency, selectedDate);
					const incomeRateVal = Number(incomeRate?.rate ?? 1);
					incomeInUSD = toUSD(rawIncome, incomeCurrency, incomeRateVal);
				}
				monthlyIncome = fromUSD(incomeInUSD, homeCurrency, homeCurrencyRate);
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

			// Single query for all user settings (avoids duplicate fetches)
			const [userSettings, excludedProjectIds] = await Promise.all([
				db.user.findUnique({
					where: { id: userId },
					select: {
						fiscalMonthStartDay: true,
						monthlyIncome: true,
						monthlyIncomeCurrency: true,
					},
				}),
				getExcludedProjectIds(db, userId),
			]);
			const fiscalStartDay = userSettings?.fiscalMonthStartDay ?? 1;

			// Per-request exchange rate cache to avoid duplicate lookups
			const rateCache = new RateCache(db);
			const statsService = new StatsService(db, rateCache, excludedProjectIds);

			const fetchOverviewStats = async () => {
				const selectedDate = month;
				const now = new Date();
				const fiscalProgress = getFiscalMonthProgress(
					now,
					selectedDate,
					fiscalStartDay,
				);

				const isCurrentMonth = fiscalProgress.isCurrentPeriod;
				const daysRemaining = fiscalProgress.daysRemaining;

				let last24HoursSpend = 0;
				if (isCurrentMonth) {
					const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
					const [{ total: personalTotal2 }, sharedTotalUSD2] =
						await Promise.all([
							sumExpensesForCurrency(
								db,
								{
									userId: session.user.id,
									isAmortizedParent: false,
									date: {
										gte: last24Hours,
									},
								},
								homeCurrency,
							),
							getSharedExpenseTotalInUSD(db, session.user.id, {
								gte: last24Hours,
							}, rateCache, excludedProjectIds),
						]);
					const homeRate2 = await rateCache.get(homeCurrency, month);
					const hRate2 = homeRate2?.rate ?? 1;
					const sharedInHome2 = fromUSD(sharedTotalUSD2, homeCurrency, hRate2);
					last24HoursSpend = personalTotal2 + sharedInHome2;
				}

				const bestHomeRate = await rateCache.get(homeCurrency, selectedDate);
				const homeCurrencyRate = bestHomeRate?.rate ?? 1;

				const toHome = (usd: number) => fromUSD(usd, homeCurrency, homeCurrencyRate);

				const detailedBudgets = await BudgetService.getBudgets(
					db,
					session.user.id,
					selectedDate,
					{ includeGlobal: true, fiscalMonthStartDay: fiscalStartDay, rateCache, excludedProjectIds },
				);

				const globalBudget = detailedBudgets.find((b) => b.categoryId === null);
				const globalBudgetLimit = globalBudget
					? toHome(globalBudget.effectiveAmountInUSD)
					: 0;

				const categoryBudgets = detailedBudgets.filter(
					(b) => b.categoryId !== null,
				);

				const isFixed = (b: BudgetService.BudgetWithStats) =>
					b.category?.isFixed ||
					FIXED_CATEGORY_NAMES.includes(b.category?.name.toLowerCase() ?? "");

				const fixedBudgetsSum = categoryBudgets
					.filter(isFixed)
					.reduce((sum: number, b) => sum + toHome(b.effectiveAmountInUSD), 0);

				const explicitVariableBudgetsSum = categoryBudgets
					.filter((b) => !isFixed(b))
					.reduce((sum: number, b) => sum + toHome(b.effectiveAmountInUSD), 0);

				const peggedAdjustment = categoryBudgets
					.filter((b) => b.type === "PEG_TO_ACTUAL" || b.pegToActual)
					.reduce((sum: number, b) => sum + toHome(b.actualSpendInUSD), 0);

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
					? toHome(globalBudget.actualSpendInUSD)
					: categoryBudgets.reduce(
							(sum: number, b) => sum + toHome(b.actualSpendInUSD),
							0,
						);

				const variableSpent = categoryBudgets
					.filter((b) => !isFixed(b))
					.reduce((sum: number, b) => sum + toHome(b.actualSpendInUSD), 0);

				const rawIncome = Number(userSettings?.monthlyIncome ?? 0);
				const incomeCurrency = userSettings?.monthlyIncomeCurrency ?? "USD";

				let monthlyIncome = rawIncome;
				if (rawIncome > 0 && incomeCurrency !== homeCurrency) {
					let incomeInUSD: number;
					if (incomeCurrency === "USD") {
						incomeInUSD = rawIncome;
					} else {
						const incomeRate = await rateCache.get(incomeCurrency, selectedDate);
						const incomeRateVal = Number(incomeRate?.rate ?? 1);
						incomeInUSD = toUSD(rawIncome, incomeCurrency, incomeRateVal);
					}
					monthlyIncome = toHome(incomeInUSD);
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
				hasExpenses,
				favorites,
				overviewStats,
				earliestBudgetMonth,
				summaryStats,
				categoryData,
				trendData,
			] = await Promise.all([
				db.expense.count({
					where: { userId, status: "FINALIZED", isAmortizedChild: false },
					take: 1,
				}).then((c) => c > 0),
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
				statsService.getSummaryStats(
					userId,
					month,
					homeCurrency,
					fiscalStartDay,
				),
				statsService.getCategoryBreakdown(
					userId,
					month,
					homeCurrency,
					fiscalStartDay,
				),
				statsService.getDailyTrend(userId, month, homeCurrency, fiscalStartDay),
			]);

			return {
				hasExpenses,
				favorites,
				overviewStats,
				earliestBudgetMonth,
				summaryStats,
				categoryData,
				trendData,
				serverTime: new Date(), // Return server's current time for consistent timezone handling
			};
		}),

	getDailySpending: protectedProcedure
		.input(z.object({ homeCurrency: z.string().length(3), days: z.number().min(1).max(365).default(90) }))
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;
			const userId = session.user.id;
			const { homeCurrency, days } = input;

			const startDate = new Date();
			startDate.setDate(startDate.getDate() - days);
			startDate.setHours(0, 0, 0, 0);

			const excludedProjectIds = await getExcludedProjectIds(db, userId);

			const [personalAggs, sharedShares] = await Promise.all([
				db.expense.groupBy({
					by: ["date"],
					where: {
						userId,
						status: "FINALIZED",
						isAmortizedParent: false,
						excludeFromAnalytics: false,
						date: { gte: startDate },
					},
					_sum: { amountInUSD: true },
				}),
				getSharedExpenseShares(db, userId, { gte: startDate }, undefined, excludedProjectIds),
			]);

			const bestRate = await getBestExchangeRate(db, homeCurrency, new Date());
			const rate = bestRate?.rate ?? 1;

			// Merge personal + shared by day
			const byDay = new Map<string, number>();
			for (const agg of personalAggs) {
				const key = agg.date.toISOString().slice(0, 10);
				const amount = fromUSD(
					Number(agg._sum.amountInUSD ?? 0),
					homeCurrency,
					rate,
				);
				byDay.set(key, (byDay.get(key) ?? 0) + amount);
			}
			for (const share of sharedShares) {
				const key = share.date.toISOString().slice(0, 10);
				const amount = fromUSD(share.amountInUSD, homeCurrency, rate);
				byDay.set(key, (byDay.get(key) ?? 0) + amount);
			}

			return Array.from(byDay.entries())
				.map(([date, total]) => ({ date, total }))
				.sort((a, b) => a.date.localeCompare(b.date));
		}),

	getRecentActivity: protectedProcedure
		.input(z.object({ homeCurrency: z.string().length(3) }))
		.query(async ({ ctx, input }) => {
			const { session, db } = ctx;
			const userId = session.user.id;
			const { homeCurrency } = input;

			const excludedProjectIds = await getExcludedProjectIds(db, userId);

			// Fetch personal expenses, shared participations, and settlements in parallel
			const [recentPersonal, sharedParticipations, settlements] =
				await Promise.all([
					db.expense.findMany({
						where: {
							userId,
							status: "FINALIZED",
							isAmortizedChild: false,
						},
						orderBy: { date: "desc" },
						take: 20,
						include: { category: true },
					}),
					listSharedParticipationsForUser(db, userId, excludedProjectIds),
					db.settlement.findMany({
						where: {
							OR: [
								{
									fromParticipantType: "user",
									fromParticipantId: userId,
								},
								{
									toParticipantType: "user",
									toParticipantId: userId,
								},
							],
						},
						orderBy: { initiatedAt: "desc" },
						take: 20,
					}),
				]);

			// Resolve settlement participant names
			const settlementUserIds = new Set<string>();
			const settlementShadowIds = new Set<string>();
			for (const s of settlements) {
				const isFrom =
					s.fromParticipantType === "user" &&
					s.fromParticipantId === userId;
				const otherType = isFrom
					? s.toParticipantType
					: s.fromParticipantType;
				const otherId = isFrom
					? s.toParticipantId
					: s.fromParticipantId;
				if (otherType === "user") settlementUserIds.add(otherId);
				else if (otherType === "shadow")
					settlementShadowIds.add(otherId);
			}

			const [sUsers, sShadows] = await Promise.all([
				settlementUserIds.size > 0
					? db.user.findMany({
							where: { id: { in: [...settlementUserIds] } },
							select: { id: true, name: true },
						})
					: [],
				settlementShadowIds.size > 0
					? db.shadowProfile.findMany({
							where: { id: { in: [...settlementShadowIds] } },
							select: { id: true, name: true },
						})
					: [],
			]);

			const nameMap = new Map<string, string>();
			for (const u of sUsers)
				nameMap.set(`user:${u.id}`, u.name ?? "Unknown");
			for (const s of sShadows) nameMap.set(`shadow:${s.id}`, s.name);

			// Compute amountInUSD for settlements — batch fetch rates in parallel
			const settlementCurrencies = [
				...new Set(settlements.map((s) => s.currency)),
			];
			const nonUsdCurrencies = settlementCurrencies.filter((c) => c !== "USD");
			const fetchedRates = await Promise.all(
				nonUsdCurrencies.map((c) => getBestExchangeRate(db, c, new Date())),
			);
			const settlementRateCache = new Map<string, number | null>();
			settlementRateCache.set("USD", 1);
			for (let i = 0; i < nonUsdCurrencies.length; i++) {
				settlementRateCache.set(nonUsdCurrencies[i]!, fetchedRates[i]?.rate ?? null);
			}

			// Build unified activity items
			type ActivityItem = {
				type: "personal" | "shared" | "settlement";
				id: string;
				title: string;
				amount: number;
				currency: string;
				amountInUSD: number | null;
				date: Date;
				category: {
					id: string;
					name: string;
					color: string;
					icon: string | null;
				} | null;
				sharedContext?: {
					totalAmount: number;
					participantCount: number;
					paidByName: string;
					paidByAvatarUrl?: string | null;
					iPayedThis: boolean;
					transactionId: string;
					projectId?: string;
					projectName?: string;
				};
				settlementContext?: {
					direction: "incoming" | "outgoing";
					otherParticipantName: string;
					status: string;
					note?: string;
				};
			};

			const items: ActivityItem[] = [];

			// Personal expenses
			for (const e of recentPersonal) {
				items.push({
					type: "personal",
					id: e.id,
					title: e.title ?? "Untitled expense",
					amount: Number(e.amount),
					currency: e.currency,
					amountInUSD: e.amountInUSD ? Number(e.amountInUSD) : null,
					date: e.date,
					category: e.category
						? {
								id: e.category.id,
								name: e.category.name,
								color: e.category.color,
								icon: e.category.icon,
							}
						: null,
				});
			}

			// Shared expenses
			for (const s of sharedParticipations) {
				items.push({
					type: "shared",
					id: s.id,
					title: s.description ?? "Untitled",
					amount: s.amount,
					currency: s.currency,
					amountInUSD: s.amountInUSD,
					date: s.date,
					category: s.category,
					sharedContext: s.sharedContext,
				});
			}

			// Settlements
			for (const s of settlements) {
				const isFrom =
					s.fromParticipantType === "user" &&
					s.fromParticipantId === userId;
				const otherType = isFrom
					? s.toParticipantType
					: s.fromParticipantType;
				const otherId = isFrom
					? s.toParticipantId
					: s.fromParticipantId;
				const otherName =
					nameMap.get(`${otherType}:${otherId}`) ?? "Unknown";
				const direction = isFrom ? "outgoing" : "incoming";
				const amount = Number(s.amount);

				items.push({
					type: "settlement",
					id: `settlement:${s.id}`,
					title: isFrom
						? `Payment to ${otherName}`
						: `Payment from ${otherName}`,
					amount,
					currency: s.currency,
					amountInUSD: (() => {
						const cachedRate = settlementRateCache.get(s.currency);
						if (cachedRate == null) return null;
						return toUSD(amount, s.currency, cachedRate);
					})(),
					date: s.initiatedAt,
					category: null,
					settlementContext: {
						direction,
						otherParticipantName: otherName,
						status: s.status,
						note: s.note ?? undefined,
					},
				});
			}

			// Sort by date descending, take 20
			items.sort(
				(a, b) =>
					new Date(b.date).getTime() - new Date(a.date).getTime(),
			);

			return items.slice(0, 20);
		}),
});
