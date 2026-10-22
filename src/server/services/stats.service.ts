import { format } from "date-fns";
import { getFiscalMonthRange, shiftMonth } from "~/lib/fiscal-month";
import { type MoneyItem, periodRateDate, sumIn } from "~/lib/money";
import { calendarDaysBetween, dayKey, wallTime } from "~/lib/time-zone";
import type { PrismaClient } from "~prisma";
import { getBestExchangeRate } from "../api/routers/shared-currency";
import type { RateCache } from "./rate-cache";
import { type SpentGrouping, spentItems } from "./figures/spent";

const FIXED_NAMES = ["rent", "utilities", "mortgage", "bills", "insurance"];

/**
 * Spending statistics in the home currency. Every total follows the totals
 * rule in ~/lib/money: home-currency expenses count as entered, the rest
 * convert from amountInUSD at the home rate for the period.
 */
export class StatsService {
	constructor(
		private db: PrismaClient,
		private rateCache?: RateCache,
		private excludedProjectIds?: string[],
		/** User's IANA zone for month and day boundaries (undefined = server zone). */
		private timeZone?: string,
	) {}

	/** Your spending in a range, from the one definition (figures/spent.ts). */
	private spent(
		userId: string,
		range: { start: Date; end: Date } | null,
		by: SpentGrouping = "currency",
		personalOnly = false,
	) {
		return spentItems(
			this.db,
			{
				userId,
				...(range ? { date: { gte: range.start, lte: range.end } } : {}),
				excludedProjectIds: this.excludedProjectIds,
				personalOnly,
			},
			by,
		);
	}

	private async getRate(currency: string, date: Date): Promise<number | null> {
		if (this.rateCache) return this.rateCache.rate(currency, date);
		return (await getBestExchangeRate(this.db, currency, date))?.rate ?? null;
	}

	private async periodTotal(
		userId: string,
		range: { start: Date; end: Date },
		homeCurrency: string,
	): Promise<number> {
		const [items, rate] = await Promise.all([
			this.spent(userId, range),
			this.getRate(homeCurrency, periodRateDate(range.end)),
		]);
		return sumIn(items, homeCurrency, rate);
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
		const tz = this.timeZone;
		const current = getFiscalMonthRange(month, fiscalMonthStartDay, tz);
		const history = [1, 2, 3].map((i) =>
			getFiscalMonthRange(shiftMonth(month, -i, tz), fiscalMonthStartDay, tz),
		);

		const [totalThisMonth, ...historyTotals] = await Promise.all([
			this.periodTotal(userId, current, homeCurrency),
			...history.map((range) => this.periodTotal(userId, range, homeCurrency)),
		]);
		const lastMonthTotal = historyTotals[0] ?? 0;

		const changeVsLastMonth =
			lastMonthTotal > 0
				? ((totalThisMonth - lastMonthTotal) / lastMonthTotal) * 100
				: null;

		// Trailing average of the 3 months before this one that had spending
		// (not a projection). 0 when none had any: there is nothing to average.
		const spentMonths = historyTotals.filter((t) => t > 0);
		const projectedSpend =
			spentMonths.length > 0
				? spentMonths.reduce((a, b) => a + b, 0) / spentMonths.length
				: 0;

		// Daily average over the days elapsed (the whole period once it is over).
		const now = new Date();
		const isCurrentMonth = now >= current.start && now <= current.end;
		const daysElapsed =
			calendarDaysBetween(
				current.start,
				isCurrentMonth ? now : current.end,
				tz,
			) + 1;
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
		const { start, end } = getFiscalMonthRange(
			month,
			fiscalMonthStartDay,
			this.timeZone,
		);

		const [items, rate] = await Promise.all([
			this.spent(userId, { start, end }, "category"),
			this.getRate(homeCurrency, periodRateDate(end)),
		]);

		const itemsByCategory = new Map<string | null, MoneyItem[]>();
		for (const item of items) {
			const list = itemsByCategory.get(item.categoryId) ?? [];
			list.push(item);
			itemsByCategory.set(item.categoryId, list);
		}

		const allCategoryIds = [...itemsByCategory.keys()].filter(
			(id): id is string => !!id,
		);

		const categoryDetails = await this.db.category.findMany({
			where: {
				id: { in: allCategoryIds },
			},
		});

		const breakdown = [...itemsByCategory.entries()]
			.map(([categoryId, items]) => {
				const detail = categoryDetails.find((d) => d.id === categoryId);
				return {
					id: categoryId ?? "uncategorized",
					name: detail?.name ?? "Uncategorized",
					value: sumIn(items, homeCurrency, rate),
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
		const tz = this.timeZone;
		const { start, end } = getFiscalMonthRange(month, fiscalMonthStartDay, tz);

		// Group by both date and category to distinguish fixed/variable
		const [dailyItems, rate] = await Promise.all([
			this.spent(userId, { start, end }, "day"),
			this.getRate(homeCurrency, periodRateDate(end)),
		]);

		// Fixed categories: isFixed=true or names like Rent, Utilities, Mortgage
		const categoryIds = [
			...new Set(
				dailyItems.map((a) => a.categoryId).filter((id): id is string => !!id),
			),
		];
		const categories = await this.db.category.findMany({
			where: { id: { in: categoryIds } },
			select: { id: true, isFixed: true, name: true },
		});
		const fixedCategoryIds = new Set(
			categories
				.filter((c) => c.isFixed || FIXED_NAMES.includes(c.name.toLowerCase()))
				.map((c) => c.id),
		);

		const byDay = new Map<
			string,
			{ total: number; fixed: number; variable: number }
		>();

		for (const item of dailyItems) {
			// "day" grouping always carries the entry date.
			const key = dayKey(item.date ?? start, tz);
			const amount = sumIn([item], homeCurrency, rate);
			const isFixed = item.categoryId && fixedCategoryIds.has(item.categoryId);

			const current = byDay.get(key) ?? { total: 0, fixed: 0, variable: 0 };
			current.total += amount;
			if (isFixed) {
				current.fixed += amount;
			} else {
				current.variable += amount;
			}
			byDay.set(key, current);
		}

		const now = new Date();
		const isCurrentMonth = now >= start && now <= end;
		const lastDay = isCurrentMonth ? now : end;
		const dayCount = calendarDaysBetween(start, lastDay, tz) + 1;
		const first = wallTime(start, tz);

		let cumulativeTotal = 0;
		let cumulativeFixed = 0;
		let cumulativeVariable = 0;

		return Array.from({ length: dayCount }, (_, i) => {
			// A plain local date for the label; the key comes from the zone.
			const day = new Date(first.year, first.month, first.day + i);
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
	}

	/**
	 * Gets lifetime statistics for a user
	 */
	async getLifetimeStats(userId: string, homeCurrency: string) {
		// Lifetime has always counted personal rows only; shares stay out so
		// the number people know does not move. Refunds lower the total but
		// are not transactions (spent items count them 0), like the profile's
		// entry count.
		const [items, rate] = await Promise.all([
			this.spent(userId, null, "currency", true),
			this.getRate(homeCurrency, new Date()),
		]);

		return {
			totalSpent: sumIn(items, homeCurrency, rate),
			totalTransactions: items.reduce((n, item) => n + item.count, 0),
		};
	}
}
