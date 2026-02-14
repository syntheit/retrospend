import {
	eachDayOfInterval,
	endOfMonth,
	format,
	startOfMonth,
	subMonths,
} from "date-fns";
import type { PrismaClient } from "~prisma";
import { getBestExchangeRate } from "../api/routers/shared-currency";

export class StatsService {
	constructor(private db: PrismaClient) {}

	/**
	 * Gets summary statistics for a given month.
	 */
	async getSummaryStats(userId: string, month: Date, homeCurrency: string) {
		const start = startOfMonth(month);
		const end = endOfMonth(month);
		const lastMonthStart = startOfMonth(subMonths(month, 1));
		const lastMonthEnd = endOfMonth(subMonths(month, 1));

		// Get total for current month
		const currentMonthAgg = await this.db.expense.aggregate({
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedParent: false,
				date: { gte: start, lte: end },
			},
			_sum: {
				amountInUSD: true,
			},
		});

		// Get total for last month
		const lastMonthAgg = await this.db.expense.aggregate({
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedParent: false,
				date: { gte: lastMonthStart, lte: lastMonthEnd },
			},
			_sum: {
				amountInUSD: true,
			},
		});

		// Get last 3 months for projection
		const historicalTotals: number[] = [];
		for (let i = 1; i <= 3; i++) {
			const mStart = startOfMonth(subMonths(month, i));
			const mEnd = endOfMonth(subMonths(month, i));
			const agg = await this.db.expense.aggregate({
				where: {
					userId,
					status: "FINALIZED",
					isAmortizedParent: false,
					date: { gte: mStart, lte: mEnd },
				},
				_sum: { amountInUSD: true },
			});
			if (agg._sum.amountInUSD !== null) {
				historicalTotals.push(Number(agg._sum.amountInUSD));
			}
		}

		const rate = (await getBestExchangeRate(this.db, homeCurrency, month)) ?? 1;

		const currentTotalUSD = Number(currentMonthAgg._sum.amountInUSD ?? 0);
		const lastTotalUSD = Number(lastMonthAgg._sum.amountInUSD ?? 0);

		const totalThisMonth = currentTotalUSD * rate;
		const changeVsLastMonth =
			lastTotalUSD > 0
				? ((currentTotalUSD - lastTotalUSD) / lastTotalUSD) * 100
				: null;

		const projectedUSD =
			historicalTotals.length > 0
				? historicalTotals.reduce((a, b) => a + b, 0) / historicalTotals.length
				: currentTotalUSD;

		const projectedSpend = projectedUSD * rate;

		// Daily average
		const now = new Date();
		const isCurrentMonth =
			month.getMonth() === now.getMonth() &&
			month.getFullYear() === now.getFullYear();

		const daysElapsed = isCurrentMonth
			? now.getDate()
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
	) {
		const start = startOfMonth(month);
		const end = endOfMonth(month);

		const categories = await this.db.expense.groupBy({
			by: ["categoryId"],
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedParent: false,
				date: { gte: start, lte: end },
			},
			_sum: {
				amountInUSD: true,
			},
		});

		const categoryDetails = await this.db.category.findMany({
			where: {
				id: {
					in: categories
						.map((c) => c.categoryId)
						.filter((id): id is string => !!id),
				},
			},
		});

		const rate = (await getBestExchangeRate(this.db, homeCurrency, month)) ?? 1;

		const breakdown = categories
			.map((c) => {
				const detail = categoryDetails.find((d) => d.id === c.categoryId);
				return {
					id: c.categoryId ?? "uncategorized",
					name: detail?.name ?? "Uncategorized",
					value: Number(c._sum.amountInUSD ?? 0) * rate,
					color: detail?.color ?? undefined,
				};
			})
			.sort((a, b) => b.value - a.value);

		return breakdown;
	}

	/**
	 * Gets daily trend (cumulative) for a given month with fixed/variable split.
	 */
	async getDailyTrend(userId: string, month: Date, homeCurrency: string) {
		const start = startOfMonth(month);
		const end = endOfMonth(month);

		// Group by both date and category to distinguish fixed/variable
		const dailyAggs = await this.db.expense.groupBy({
			by: ["date", "categoryId"],
			where: {
				userId,
				status: "FINALIZED",
				isAmortizedParent: false,
				date: { gte: start, lte: end },
			},
			_sum: {
				amountInUSD: true,
			},
		});

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
				.filter(
					(c) =>
						c.isFixed || FIXED_NAMES.includes(c.name.toLowerCase()),
				)
				.map((c) => c.id),
		);

		const rate = (await getBestExchangeRate(this.db, homeCurrency, month)) ?? 1;

		const byDay = new Map<
			string,
			{ total: number; fixed: number; variable: number }
		>();

		for (const agg of dailyAggs) {
			const dayKey = format(agg.date, "yyyy-MM-dd");
			const amount = Number(agg._sum.amountInUSD ?? 0) * rate;
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
		const isCurrentMonth =
			month.getMonth() === now.getMonth() &&
			month.getFullYear() === now.getFullYear();
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
}
