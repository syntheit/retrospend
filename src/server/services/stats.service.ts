import {
	eachDayOfInterval,
	endOfMonth,
	format,
	startOfMonth,
	subMonths,
} from "date-fns";
import { getFiscalMonthRange } from "~/lib/fiscal-month";
import { Prisma, type PrismaClient } from "~prisma";
import { fromUSD, toUSD } from "../currency";
import { getBestExchangeRate } from "../api/routers/shared-currency";
import {
	getSharedExpenseShares,
	getSharedExpenseTotalInUSD,
} from "./shared-expense-integration";
import type { RateCache } from "./rate-cache";

export class StatsService {
	constructor(
		private db: PrismaClient,
		private rateCache?: RateCache,
		private excludedProjectIds?: string[],
	) {}

	private async getRate(currency: string, date: Date) {
		if (this.rateCache) return this.rateCache.get(currency, date);
		return getBestExchangeRate(this.db, currency, date);
	}

	/**
	 * Gets summary statistics for a given month.
	 */
	async getSummaryStats(
		userId: string,
		month: Date,
		homeCurrency: string,
		fiscalMonthStartDay = 1,
	) {
		const fiscal = getFiscalMonthRange(month, fiscalMonthStartDay);
		const start = fiscal.start;
		const end = fiscal.end;
		const lastMonth = subMonths(month, 1);
		const lastFiscal = getFiscalMonthRange(lastMonth, fiscalMonthStartDay);
		const lastMonthStart = lastFiscal.start;
		const lastMonthEnd = lastFiscal.end;

		// Get total for current month (personal + shared)
		const [currentMonthAgg, currentSharedUSD] = await Promise.all([
			this.db.expense.aggregate({
				where: {
					userId,
					status: "FINALIZED",
					isAmortizedParent: false,
					excludeFromAnalytics: false,
					date: { gte: start, lte: end },
				},
				_sum: {
					amountInUSD: true,
				},
			}),
			getSharedExpenseTotalInUSD(this.db, userId, {
				gte: start,
				lte: end,
			}, this.rateCache, this.excludedProjectIds),
		]);

		// Get total for last month (personal + shared)
		const [lastMonthAgg, lastSharedUSD] = await Promise.all([
			this.db.expense.aggregate({
				where: {
					userId,
					status: "FINALIZED",
					isAmortizedParent: false,
					excludeFromAnalytics: false,
					date: { gte: lastMonthStart, lte: lastMonthEnd },
				},
				_sum: {
					amountInUSD: true,
				},
			}),
			getSharedExpenseTotalInUSD(this.db, userId, {
				gte: lastMonthStart,
				lte: lastMonthEnd,
			}, this.rateCache, this.excludedProjectIds),
		]);

		// Get last 3 months for projection — batched into 2 queries instead of 6
		const histMonths = [1, 2, 3].map((i) => {
			const f = getFiscalMonthRange(subMonths(month, i), fiscalMonthStartDay);
			return { start: f.start, end: f.end };
		});
		const histEarliest = histMonths[2]!.start;
		const histLatest = histMonths[0]!.end;

		const [histPersonalAggs, histSharedTotals] = await Promise.all([
			this.db.expense.groupBy({
				by: ["date"],
				where: {
					userId,
					status: "FINALIZED",
					isAmortizedParent: false,
					excludeFromAnalytics: false,
					date: { gte: histEarliest, lte: histLatest },
				},
				_sum: { amountInUSD: true },
			}),
			getSharedExpenseShares(this.db, userId, {
				gte: histEarliest,
				lte: histLatest,
			}, this.rateCache, this.excludedProjectIds),
		]);

		// Bucket results into each historical month
		const historicalTotals: number[] = [];
		for (const hm of histMonths) {
			let personalUSD = 0;
			for (const agg of histPersonalAggs) {
				if (agg.date >= hm.start && agg.date <= hm.end) {
					personalUSD += Number(agg._sum.amountInUSD ?? 0);
				}
			}
			let sharedUSD = 0;
			for (const s of histSharedTotals) {
				if (s.date >= hm.start && s.date <= hm.end) {
					sharedUSD += s.amountInUSD;
				}
			}
			const total = personalUSD + sharedUSD;
			if (total > 0) {
				historicalTotals.push(total);
			}
		}

		const bestRate = await this.getRate(homeCurrency, month);
		const rate = bestRate?.rate ?? 1;

		const currentTotalUSD =
			Number(currentMonthAgg._sum.amountInUSD ?? 0) + currentSharedUSD;
		const lastTotalUSD =
			Number(lastMonthAgg._sum.amountInUSD ?? 0) + lastSharedUSD;

		// Convert from USD to homeCurrency
		const totalThisMonth = fromUSD(currentTotalUSD, homeCurrency, rate);
		const changeVsLastMonth =
			lastTotalUSD > 0
				? ((currentTotalUSD - lastTotalUSD) / lastTotalUSD) * 100
				: null;

		const projectedUSD =
			historicalTotals.length > 0
				? historicalTotals.reduce((a, b) => a + b, 0) / historicalTotals.length
				: currentTotalUSD;

		const projectedSpend = fromUSD(projectedUSD, homeCurrency, rate);

		// Daily average
		const now = new Date();
		const isCurrentMonth = now >= start && now <= end;

		const daysElapsed = isCurrentMonth
			? Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
				1
			: eachDayOfInterval({ start, end }).length;

		const dailyAverage = totalThisMonth / Math.max(1, daysElapsed);

		return {
			totalThisMonth,
			changeVsLastMonth,
			dailyAverage,
			projectedSpend,
		};
	}

	/**
	 * Gets category breakdown for a given month.
	 */
	async getCategoryBreakdown(
		userId: string,
		month: Date,
		homeCurrency: string,
		fiscalMonthStartDay = 1,
	) {
		const fiscal = getFiscalMonthRange(month, fiscalMonthStartDay);
		const start = fiscal.start;
		const end = fiscal.end;

		const [personalCategories, sharedShares] = await Promise.all([
			this.db.expense.groupBy({
				by: ["categoryId"],
				where: {
					userId,
					status: "FINALIZED",
					isAmortizedParent: false,
					excludeFromAnalytics: false,
					date: { gte: start, lte: end },
				},
				_sum: {
					amountInUSD: true,
				},
			}),
			getSharedExpenseShares(this.db, userId, {
				gte: start,
				lte: end,
			}, this.rateCache, this.excludedProjectIds),
		]);

		// Merge shared expenses into category totals
		const categoryTotalsUSD = new Map<string | null, number>();
		for (const c of personalCategories) {
			categoryTotalsUSD.set(c.categoryId, Number(c._sum.amountInUSD ?? 0));
		}
		for (const s of sharedShares) {
			const existing = categoryTotalsUSD.get(s.categoryId) ?? 0;
			categoryTotalsUSD.set(s.categoryId, existing + s.amountInUSD);
		}

		const allCategoryIds = [
			...new Set(
				[...categoryTotalsUSD.keys()].filter((id): id is string => !!id),
			),
		];

		const categoryDetails = await this.db.category.findMany({
			where: {
				id: { in: allCategoryIds },
			},
		});

		const bestRate = await this.getRate(homeCurrency, month);
		const rate = bestRate?.rate ?? 1;

		const breakdown = [...categoryTotalsUSD.entries()]
			.map(([categoryId, totalUSD]) => {
				const detail = categoryDetails.find((d) => d.id === categoryId);
				return {
					id: categoryId ?? "uncategorized",
					name: detail?.name ?? "Uncategorized",
					value: fromUSD(totalUSD, homeCurrency, rate),
					color: detail?.color ?? undefined,
				icon: detail?.icon ?? null,
				};
			})
			.sort((a, b) => b.value - a.value);

		return breakdown;
	}

	/**
	 * Gets daily trend (cumulative) for a given month with fixed/variable split.
	 */
	async getDailyTrend(
		userId: string,
		month: Date,
		homeCurrency: string,
		fiscalMonthStartDay = 1,
	) {
		const fiscal = getFiscalMonthRange(month, fiscalMonthStartDay);
		const start = fiscal.start;
		const end = fiscal.end;

		// Group by both date and category to distinguish fixed/variable
		const [personalDailyAggs, sharedShares] = await Promise.all([
			this.db.expense.groupBy({
				by: ["date", "categoryId"],
				where: {
					userId,
					status: "FINALIZED",
					isAmortizedParent: false,
					excludeFromAnalytics: false,
					date: { gte: start, lte: end },
				},
				_sum: {
					amountInUSD: true,
				},
			}),
			getSharedExpenseShares(this.db, userId, {
				gte: start,
				lte: end,
			}, this.rateCache, this.excludedProjectIds),
		]);

		// Merge shared expenses into daily aggregates
		const dailyAggs = [
			...personalDailyAggs,
			...sharedShares.map((s) => ({
				date: s.date,
				categoryId: s.categoryId,
				_sum: {
					amountInUSD: new Prisma.Decimal(s.amountInUSD),
				},
			})),
		];

		// Get Fixed Categories (Logic: isFixed=true OR names like Rent, Utilities, Mortgage)
		const categoryIds = [
			...new Set(
				dailyAggs.map((a) => a.categoryId).filter((id): id is string => !!id),
			),
		];
		const FIXED_NAMES = ["rent", "utilities", "mortgage", "bills", "insurance"];
		const categories = await this.db.category.findMany({
			where: { id: { in: categoryIds } },
			select: { id: true, isFixed: true, name: true },
		});
		const fixedCategoryIds = new Set(
			categories
				.filter((c) => c.isFixed || FIXED_NAMES.includes(c.name.toLowerCase()))
				.map((c) => c.id),
		);

		const bestRate = await this.getRate(homeCurrency, month);
		const rate = bestRate?.rate ?? 1;

		const byDay = new Map<
			string,
			{ total: number; fixed: number; variable: number }
		>();

		for (const agg of dailyAggs) {
			const dayKey = format(agg.date, "yyyy-MM-dd");
			const amount = fromUSD(Number(agg._sum.amountInUSD ?? 0), homeCurrency, rate);
			const isFixed = agg.categoryId && fixedCategoryIds.has(agg.categoryId);

			const current = byDay.get(dayKey) ?? { total: 0, fixed: 0, variable: 0 };
			current.total += amount;
			if (isFixed) {
				current.fixed += amount;
			} else {
				current.variable += amount;
			}
			byDay.set(dayKey, current);
		}

		const now = new Date();
		const isCurrentMonth = now >= start && now <= end;
		const endDate = isCurrentMonth ? now : end;

		let cumulativeTotal = 0;
		let cumulativeFixed = 0;
		let cumulativeVariable = 0;

		const trend = eachDayOfInterval({ start, end: endDate }).map((day) => {
			const key = format(day, "yyyy-MM-dd");
			const stats = byDay.get(key) ?? { total: 0, fixed: 0, variable: 0 };

			cumulativeTotal += stats.total;
			cumulativeFixed += stats.fixed;
			cumulativeVariable += stats.variable;

			return {
				day: format(day, "MMM d"),
				dateLabel: format(day, "PP"),
				value: cumulativeTotal, // Default/Legacy
				total: cumulativeTotal,
				fixed: cumulativeFixed,
				variable: cumulativeVariable,
			};
		});

		return trend;
	}
	/**
	 * Gets lifetime statistics for a user
	 */
	async getLifetimeStats(userId: string, homeCurrency: string) {
		// Get total spend
		const totalSpentAgg = await this.db.expense.aggregate({
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedParent: false,
				excludeFromAnalytics: false,
			},
			_sum: {
				amountInUSD: true,
			},
			_count: true,
		});

		// Get current exchange rate
		const bestRate = await this.getRate(homeCurrency, new Date());
		const rate = bestRate?.rate ?? 1;

		return {
			totalSpent: fromUSD(Number(totalSpentAgg._sum.amountInUSD ?? 0), homeCurrency, rate),
			totalTransactions: totalSpentAgg._count,
		};
	}
}
