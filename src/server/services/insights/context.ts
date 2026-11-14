/**
 * What every Insights read shares: the user's home currency, their fiscal
 * start day and zone, one rate lookup for the whole read, and the two
 * conversions every number goes through. Each read loads its rows once and
 * totals them in @retrospend/domain/insights-compute, so a figure and the
 * page that shows it cannot differ, and a device prints the same digits.
 *
 * A figure is unavailable (null, with the currencies named) when a row
 * cannot be valued: a missing rate is never 1 (R14).
 */
import type { Span } from "@retrospend/domain/insights";
import {
	type InsightsContext as InsightsBase,
	insightsContextOf,
	instantRange,
} from "@retrospend/domain/insights-compute";
import { findRateRows } from "~/server/exchange-rates";
import type { FigureDb } from "~/server/figures/registry";
import type { SpentFilter } from "~/server/services/figures/spent";
import { parsePersonKey } from "~/server/services/payments/view";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { InsightsFilter } from "./types";

export {
	instantRange,
	previousPeriod,
} from "@retrospend/domain/insights-compute";

export interface InsightsContext extends InsightsBase {
	readonly userId: string;
}

export async function insightsContext(
	db: FigureDb,
	userId: string,
	options: { timeZone?: string; now?: Date } = {},
): Promise<InsightsContext> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true, fiscalMonthStartDay: true },
	});
	const home = user?.homeCurrency ?? "USD";
	const rateRows = (await findRateRows(db, [home]))[home] ?? [];
	return {
		userId,
		...insightsContextOf({
			home,
			zone: await userTimeZone(db, userId, options.timeZone),
			startDay: user?.fiscalMonthStartDay ?? 1,
			now: options.now ?? new Date(),
			rateRows,
		}),
	};
}

/** The one spending filter for a span and the page's filters. */
export function spentFilterFor(
	ctx: InsightsContext,
	span: Span,
	filter: InsightsFilter = {},
): SpentFilter {
	const people = filter.personKeys?.flatMap((key) => {
		const ref = parsePersonKey(key);
		return ref ? [ref] : [];
	});
	return {
		userId: ctx.userId,
		date: instantRange(span, ctx.zone),
		...(filter.categoryIds?.length ? { categoryIds: filter.categoryIds } : {}),
		...(filter.projectIds?.length ? { projectIds: filter.projectIds } : {}),
		...(people?.length ? { withPeople: people } : {}),
	};
}
