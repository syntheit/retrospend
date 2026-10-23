/**
 * The Activity footer and day totals, read from `spent(filter)`, the one
 * spending definition (IMPLEMENTATION §1.4, figures/spent.ts). Nothing here
 * sums rows of its own: the list only picks the filter and the currency.
 * Money in and transfers add nothing; refunds subtract; shares count yours.
 */
import { amountIn, isValidRate, USD } from "@retrospend/domain/money";
import {
	dayKey,
	parseDateOnlyIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import type { Prisma } from "~prisma";
import { type SpentFilter, type SpentItem, spentItems } from "../figures/spent";
import { numberMoney } from "./money";
import type { ListBounds, RowKey } from "./query";
import type { ActivityTotalDTO, ListV2Filter } from "./types";

type Db = Prisma.TransactionClient;

export type TotalsContext = {
	userId: string;
	home: string;
	/** Units of the home currency per USD; null when there is none. */
	homeRate: number | null;
	excludedProjectIds: string[];
	timeZone: string | undefined;
};

/**
 * Whether spent() can total this filter: dates and categories only. People,
 * projects, payer, a type or search text narrow the list to rows spent()
 * cannot pick out, so the footer shows no total rather than a wrong one.
 */
export function spentExpresses(filter: ListV2Filter): boolean {
	return !(
		filter.people?.length ||
		filter.projectIds?.length ||
		filter.paidBy?.length ||
		filter.kinds?.length ||
		filter.q?.trim()
	);
}

/** spent() takes inclusive bounds; the list's upper bound is exclusive. */
function inclusive(bounds: ListBounds): SpentFilter["date"] {
	return {
		...(bounds.gte ? { gte: bounds.gte } : {}),
		...(bounds.lt ? { lte: new Date(bounds.lt.getTime() - 1) } : {}),
	};
}

function spentFilter(
	c: TotalsContext,
	filter: ListV2Filter,
	bounds: ListBounds,
): SpentFilter {
	return {
		userId: c.userId,
		date: inclusive(bounds),
		excludedProjectIds: c.excludedProjectIds,
		...(filter.categoryIds?.length ? { categoryIds: filter.categoryIds } : {}),
	};
}

/**
 * Items in the home currency, or null when one needs a home rate that is
 * missing: a missing rate is never 1 (GUIDELINE §7), so no total shows.
 */
function homeSum(items: SpentItem[], c: TotalsContext): number | null {
	const rateless = c.home !== USD && !isValidRate(c.homeRate);
	let total = 0;
	for (const item of items) {
		const own = item.currency === c.home || item.booked?.currency === c.home;
		if (rateless && !own) return null;
		total += amountIn(item, c.home, c.homeRate);
	}
	return total;
}

/** Your spending for the filter's dates and categories, in the home currency. */
export async function activitySpent(
	db: Db,
	c: TotalsContext,
	filter: ListV2Filter,
	bounds: ListBounds,
): Promise<ActivityTotalDTO | null> {
	const v = homeSum(await spentItems(db, spentFilter(c, filter, bounds)), c);
	return v === null ? null : { figure: "spent", value: numberMoney(v, c.home) };
}

/**
 * Your spending per day for the days a page shows, whole days from spent()
 * (a day split across two pages gets the same total on both).
 */
export async function activityDayTotals(
	db: Db,
	c: TotalsContext,
	filter: ListV2Filter,
	bounds: ListBounds,
	keys: RowKey[],
): Promise<Record<string, ActivityTotalDTO["value"]> | null> {
	const days = keys.map((k) => dayKey(k.date, c.timeZone)).sort();
	const first = days[0];
	const last = days[days.length - 1];
	if (!first || !last) return {};
	const gte = parseDateOnlyIn(first, c.timeZone);
	const lt = startOfNextDayIn(parseDateOnlyIn(last, c.timeZone), c.timeZone);
	const range: ListBounds = {
		gte: bounds.gte && bounds.gte > gte ? bounds.gte : gte,
		lt: bounds.lt && bounds.lt < lt ? bounds.lt : lt,
	};
	const items = await spentItems(db, spentFilter(c, filter, range), "day");
	const byDay = new Map<string, SpentItem[]>();
	for (const item of items) {
		if (!item.date) continue;
		const day = dayKey(item.date, c.timeZone);
		byDay.set(day, [...(byDay.get(day) ?? []), item]);
	}
	const out: Record<string, ActivityTotalDTO["value"]> = {};
	for (const day of new Set(days)) {
		const v = homeSum(byDay.get(day) ?? [], c);
		if (v === null) return null;
		out[day] = numberMoney(v, c.home);
	}
	return out;
}
