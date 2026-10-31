/**
 * The Budget page's insights read: the month shown, plus the months before
 * it for the trend, each through the same month read the page uses.
 */
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { BudgetInsights } from "~/lib/schemas/envelope-insights";
import { insightsOf, trendMonths } from "./insights";
import { getMonth } from "./read.service";
import type { MonthKey } from "./types";

/** Null without a budget. */
export async function getBudgetInsights(
	userId: string,
	month?: MonthKey,
	now = new Date(),
	timeZone: string | null = null,
): Promise<BudgetInsights | null> {
	const current = await getMonth(userId, month, now, timeZone);
	if (!current) return null;
	const earlier = await Promise.all(
		trendMonths(current.month.key, current.book.startMonth)
			.filter((m) => m !== current.month.key)
			.map((m) => getMonth(userId, m, now, timeZone)),
	);
	return insightsOf(
		current,
		earlier.filter((m): m is GetMonthOutput => m !== null),
	);
}
