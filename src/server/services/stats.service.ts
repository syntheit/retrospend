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
	 * Gets daily trend (cumulative) for a given month.
	 */
	async getDailyTrend(userId: string, month: Date, homeCurrency: string) {
		const start = startOfMonth(month);
		const end = endOfMonth(month);

		const dailyAggs = await this.db.expense.groupBy({
			by: ["date"],
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

		const rate = (await getBestExchangeRate(this.db, homeCurrency, month)) ?? 1;

		const byDay = new Map<string, number>();
		for (const agg of dailyAggs) {
			const dayKey = format(agg.date, "yyyy-MM-dd");
			byDay.set(
				dayKey,
				(byDay.get(dayKey) ?? 0) + Number(agg._sum.amountInUSD ?? 0) * rate,
			);
		}

		const now = new Date();
		const isCurrentMonth =
			month.getMonth() === now.getMonth() &&
			month.getFullYear() === now.getFullYear();
		const endDate = isCurrentMonth ? now : end;

		let cumulativeTotal = 0;
		const trend = eachDayOfInterval({ start, end: endDate }).map((day) => {
			const key = format(day, "yyyy-MM-dd");
			const dailyAmount = byDay.get(key) ?? 0;
			cumulativeTotal += dailyAmount;
			return {
				day: format(day, "MMM d"),
				dateLabel: format(day, "PP"),
				value: cumulativeTotal,
			};
		});

		return trend;
	}
}
