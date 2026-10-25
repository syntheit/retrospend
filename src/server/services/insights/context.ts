/**
 * What every Insights read shares: the user's home currency, their fiscal
 * start day and zone, one rate lookup for the whole read, and the two
 * conversions every number goes through. Each read loads its rows once and
 * totals them here, so a figure and the page that shows it cannot differ.
 *
 * A figure is unavailable (null, with the currencies named) when a row
 * cannot be valued: a missing rate is never 1 (R14).
 */
import { previousSpan, type Span } from "@retrospend/domain/insights";
import {
	type MoneyItem,
	missingRatesIn,
	periodRateDate,
	sumIn,
} from "@retrospend/domain/money";
import { type Money, toMinor } from "@retrospend/domain/money-minor";
import {
	dayKey,
	parseDateOnlyIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "@retrospend/domain/fiscal-month";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import type { FigureDb } from "~/server/figures/registry";
import type { SpentFilter } from "~/server/services/figures/spent";
import { parsePersonKey } from "~/server/services/payments/view";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { InsightsFilter } from "./types";

export interface InsightsContext {
	readonly userId: string;
	readonly home: string;
	readonly zone: string;
	/** The fiscal month's first day (1 to 28). */
	readonly startDay: number;
	readonly now: Date;
	/** Units of home per 1 USD at `date`, or null when home has no rate at all. */
	readonly homeRateAt: (date: Date) => number | null;
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
	const lookup = await findExchangeRatesForDates(db, [home]);
	return {
		userId,
		home,
		zone: await userTimeZone(db, userId, options.timeZone),
		startDay: user?.fiscalMonthStartDay ?? 1,
		now: options.now ?? new Date(),
		homeRateAt: (date) => lookup(home, date)?.rate ?? null,
	};
}

/**
 * What Compare to previous period compares with. A span that is exactly one
 * of the user's fiscal periods meets the fiscal period before it, as Home's
 * last period does (with a start day of 15, Oct 15 to Nov 14 meets Sep 15 to
 * Oct 14). Any other span follows previousSpan.
 */
export function previousPeriod(ctx: InsightsContext, span: Span): Span {
	const { zone, startDay } = ctx;
	const label = getCurrentFiscalMonth(
		parseDateOnlyIn(span.from, zone),
		startDay,
		zone,
	);
	const period = getFiscalMonthRange(label, startDay, zone);
	if (
		dayKey(period.start, zone) !== span.from ||
		dayKey(period.end, zone) !== span.to
	)
		return previousSpan(span);
	const before = getFiscalMonthRange(
		shiftMonth(label, -1, zone),
		startDay,
		zone,
	);
	return { from: dayKey(before.start, zone), to: dayKey(before.end, zone) };
}

/** The instants a span covers in the viewer's zone: its first midnight to its last millisecond. */
export function instantRange(span: Span, zone: string) {
	return {
		gte: parseDateOnlyIn(span.from, zone),
		lte: new Date(
			startOfNextDayIn(parseDateOnlyIn(span.to, zone), zone).getTime() - 1,
		),
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

/** A total, or the currencies that kept it out. */
export type Valued =
	| { readonly money: Money; readonly missing: readonly [] }
	| { readonly money: null; readonly missing: readonly string[] };

/**
 * Items totaled in `currency` under the totals rule (frozen booked values
 * first, then each item's stored USD value at `rate`), rounded once to
 * minor units.
 */
export function valueIn(
	items: readonly MoneyItem[],
	currency: string,
	rate: number | null,
): Valued {
	const missing = missingRatesIn(items, currency, rate);
	if (missing.length) return { money: null, missing };
	return {
		money: { minor: toMinor(sumIn(items, currency, rate), currency), currency },
		missing: [],
	};
}

/** The rate that converts a span's totals: the one at its end, or now if sooner. */
export function spanRate(ctx: InsightsContext, span: Span): number | null {
	const end = instantRange(span, ctx.zone).lte;
	return ctx.homeRateAt(periodRateDate(end, ctx.now));
}
