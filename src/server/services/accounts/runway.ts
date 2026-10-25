/**
 * Runway: average monthly spending over up to the last six months, in the
 * target currency (moved out of routers/wealth.ts unchanged). Same spending
 * as every other total: finalized, not excluded, amortized purchases counted
 * once through their monthly parts.
 */
import { sumIn } from "@retrospend/domain/money";
import { addMonthsClamped } from "@retrospend/domain/recurring";
import { findExchangeRate } from "~/server/exchange-rates";
import { spentItems } from "~/server/services/figures/spent";
import { getExcludedProjectIds } from "~/server/services/shared-expense-integration";
import { reportSpendingWhere } from "~/server/services/spending";
import type { PrismaClient } from "~prisma";

const DAYS_PER_MONTH = 30.436875;

export async function runwayStats(
	db: PrismaClient,
	userId: string,
	targetCurrency: string,
) {
	const today = new Date();
	const sixMonthsAgo = addMonthsClamped(today, -6);
	const [oldestExpenseOverall, excludedProjectIds] = await Promise.all([
		db.expense.findFirst({
			where: reportSpendingWhere(userId),
			orderBy: { date: "asc" },
			select: { date: true },
		}),
		getExcludedProjectIds(db, userId),
	]);

	let monthsActive = 1;
	if (oldestExpenseOverall) {
		const msDiff = today.getTime() - oldestExpenseOverall.date.getTime();
		const monthsDiff = msDiff / (1000 * 60 * 60 * 24 * DAYS_PER_MONTH);
		monthsActive = Math.min(6, Math.max(1, monthsDiff));
	}

	const [items, targetRate] = await Promise.all([
		spentItems(db, {
			userId,
			date: { gte: sixMonthsAgo, lte: today },
			excludedProjectIds,
		}),
		findExchangeRate(db, targetCurrency, today),
	]);

	return {
		averageMonthlySpend:
			sumIn(items, targetCurrency, targetRate?.rate) / monthsActive,
		monthsActive: Math.round(monthsActive),
	};
}
