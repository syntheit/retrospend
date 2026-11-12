/**
 * Runway: average monthly spending over up to the last six months, in the
 * target currency (moved out of routers/wealth.ts unchanged). Same spending
 * as every other total: finalized, not excluded, amortized purchases counted
 * once through their monthly parts.
 */
import { fromMinorUnits } from "@retrospend/domain/money";
import { sumInDec } from "@retrospend/domain/money-dec";
import { roundedMinor } from "@retrospend/domain/money-minor";
import { dec } from "@retrospend/domain/precise-decimal";
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

	// monthsActive is a count of months, not money; the exact average rounds
	// once to the currency's minor units, which is what the wire carries.
	const average = sumInDec(items, targetCurrency, targetRate?.rate).div(
		dec(monthsActive),
	);
	return {
		averageMonthlySpend: fromMinorUnits(
			roundedMinor(average, targetCurrency),
			targetCurrency,
		),
		monthsActive: Math.round(monthsActive),
	};
}
