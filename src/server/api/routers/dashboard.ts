import { z } from "zod";
import { toUSD } from "~/lib/money";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import {
	getOverviewSettings,
	getOverviewStats,
} from "~/server/services/overview.service";
import { RateCache } from "~/server/services/rate-cache";
import {
	getExcludedProjectIds,
	listSharedParticipationsForUser,
} from "~/server/services/shared-expense-integration";
import { StatsService } from "~/server/services/stats.service";

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
			const [settings, excludedProjectIds] = await Promise.all([
				getOverviewSettings(db, session.user.id),
				getExcludedProjectIds(db, session.user.id),
			]);
			return getOverviewStats(db, session.user.id, {
				...settings,
				month: input?.month ?? new Date(),
				homeCurrency: input?.homeCurrency ?? "USD",
				excludedProjectIds,
				rateCache: new RateCache(db),
				timeZone: ctx.timeZone,
			});
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

			const [settings, excludedProjectIds] = await Promise.all([
				getOverviewSettings(db, userId),
				getExcludedProjectIds(db, userId),
			]);
			const { fiscalStartDay } = settings;

			// Per-request exchange rate cache to avoid duplicate lookups
			const rateCache = new RateCache(db);
			const statsService = new StatsService(
				db,
				rateCache,
				excludedProjectIds,
				ctx.timeZone,
			);

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
				getOverviewStats(db, userId, {
					...settings,
					month,
					homeCurrency,
					excludedProjectIds,
					rateCache,
					timeZone: ctx.timeZone,
				}),
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
							// Offset rows move no money (see settlement-groups.ts).
							isOffset: false,
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

			// USD value of each settlement at the rate for its own date
			const settlementRate = await findExchangeRatesForDates(
				db,
				settlements.map((s) => s.currency),
			);

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
					paidByType?: string;
					paidById?: string;
					iPayedThis: boolean;
					transactionId: string;
					projectId?: string;
					projectName?: string;
				};
				settlementContext?: {
					direction: "incoming" | "outgoing";
					otherParticipantName: string;
					otherParticipantType?: string;
					otherParticipantId?: string;
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

			// Settlements: one item per payment. A payment split over several
			// projects is one row per project with a shared paymentGroupId.
			const payments = new Map<
				string,
				(typeof settlements)[number] & { total: number }
			>();
			for (const s of settlements) {
				const key = s.paymentGroupId
					? `${s.paymentGroupId}|${s.currency}`
					: s.id;
				const existing = payments.get(key);
				if (existing) existing.total += Number(s.amount);
				else payments.set(key, { ...s, total: Number(s.amount) });
			}
			for (const s of payments.values()) {
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
				const amount = s.total;

				items.push({
					type: "settlement",
					id: `settlement:${s.id}`,
					title: isFrom
						? `Payment to ${otherName}`
						: `Payment from ${otherName}`,
					amount,
					currency: s.currency,
					amountInUSD: (() => {
						const rate = settlementRate(s.currency, s.initiatedAt);
						return rate ? toUSD(amount, s.currency, rate.rate) : null;
					})(),
					date: s.initiatedAt,
					category: null,
					settlementContext: {
						direction,
						otherParticipantName: otherName,
						otherParticipantType: otherType,
						otherParticipantId: otherId,
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
