/**
 * The spending half of Home's glance (kit `pace()`, `monthSpend`): this and
 * the last fiscal period per day in the home currency, and the three
 * figures registered from it (src/server/figures/registry.ts):
 * - glance.spent: this period's spending, the whole period (kit monthSpend).
 * - glance.spentLastToDate: last period up to the same day (the pace line).
 * - glance.spentLast: last period's total.
 *
 * Spending follows the one definition (spentItems) and the totals rule; a
 * foreign row without a home rate makes a figure unavailable and names the
 * currency, never a guess (R14). Figures read days in the zone the server
 * decides for the user (userTimeZone), as glance() does without a request zone.
 */
import { MissingRateError, periodRateDate } from "@retrospend/domain/money";
import type { Money } from "@retrospend/domain/money-minor";
import { dayKey } from "@retrospend/domain/time-zone";
import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "~/lib/fiscal-month";
import { findExchangeRate } from "~/server/exchange-rates";
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
} from "~/server/figures/registry";
import { userTimeZone } from "~/server/services/user-time-zone";
import {
	cumulativeMinor,
	dailyHome,
	type IsoDate,
	type PeriodSpan,
	spanOf,
} from "./glance-pace";
import { type SpentItem, spentItems } from "./spent";

export const GLANCE_SPENT = "glance.spent";
export const GLANCE_SPENT_LAST_TO_DATE = "glance.spentLastToDate";
export const GLANCE_SPENT_LAST = "glance.spentLast";

/** A number as Home shows it, tagged with its figure id for the display audit. */
export interface GlanceFigure {
	readonly id: string;
	/** Null when unavailable (a missing rate); never 0 in its place. */
	readonly value: Money | null;
}

export interface SpendPace {
	readonly home: string;
	readonly today: IsoDate;
	readonly period: PeriodSpan & { readonly day: number };
	readonly last: PeriodSpan;
	/** Running totals in home minor units: this period to today, the last in full. Null: missing rate. */
	readonly thisSeries: number[] | null;
	readonly lastSeries: number[] | null;
	/** Whole-period totals (rows dated later this period count, as in Activity). */
	readonly thisTotal: number | null;
	readonly lastTotal: number | null;
	readonly missingRates: string[];
}

const rangeKeys = (range: { start: Date; end: Date }, tz: string) =>
	spanOf(dayKey(range.start, tz), dayKey(range.end, tz));

/** This and the last fiscal period as instants and as calendar days. */
function periodsAt(now: Date, startDay: number, timeZone: string) {
	const label = getCurrentFiscalMonth(now, startDay, timeZone);
	const thisRange = getFiscalMonthRange(label, startDay, timeZone);
	const lastRange = getFiscalMonthRange(
		shiftMonth(label, -1, timeZone),
		startDay,
		timeZone,
	);
	const today = dayKey(now, timeZone);
	const period = rangeKeys(thisRange, timeZone);
	const day = Math.min(
		period.days,
		Math.max(1, spanOf(period.from, today).days),
	);
	return {
		thisRange,
		lastRange,
		today,
		period: { ...period, day },
		last: rangeKeys(lastRange, timeZone),
	};
}

const UNAVAILABLE = {
	thisSeries: null,
	lastSeries: null,
	thisTotal: null,
	lastTotal: null,
} as const;

/** Spending of this and the last fiscal period, per day, in the home currency. */
export async function loadSpendPace(
	db: FigureDb,
	userId: string,
	now: Date,
	timeZone: string,
): Promise<SpendPace> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true, fiscalMonthStartDay: true },
	});
	const home = user?.homeCurrency ?? "USD";
	const p = periodsAt(now, user?.fiscalMonthStartDay ?? 1, timeZone);
	const base = { home, today: p.today, period: p.period, last: p.last };
	let items: SpentItem[];
	try {
		items = await spentItems(
			db,
			{ userId, date: { gte: p.lastRange.start, lte: p.thisRange.end } },
			"day",
		);
	} catch (error) {
		// A share whose currency has no rate at all cannot be valued: name it.
		if (!(error instanceof MissingRateError)) throw error;
		return { ...base, ...UNAVAILABLE, missingRates: [error.currency] };
	}
	const rows = items.flatMap((item) =>
		item.date ? [{ day: dayKey(item.date, timeZone), item }] : [],
	);
	const rateOn = async (end: Date) =>
		(await findExchangeRate(db, home, periodRateDate(end, now)))?.rate ?? null;
	const thisDaily = dailyHome(
		rows,
		p.period,
		home,
		await rateOn(p.thisRange.end),
	);
	const lastDaily = dailyHome(
		rows,
		p.last,
		home,
		await rateOn(p.lastRange.end),
	);
	const total = (daily: number[] | null) =>
		daily ? (cumulativeMinor(daily, daily.length, home).at(-1) ?? 0) : null;
	return {
		...base,
		thisSeries: thisDaily && cumulativeMinor(thisDaily, p.period.day, home),
		lastSeries: lastDaily && cumulativeMinor(lastDaily, p.last.days, home),
		thisTotal: total(thisDaily),
		lastTotal: total(lastDaily),
		missingRates: thisDaily && lastDaily ? [] : [home],
	};
}

/** Last period's running total on this period's day (its last day when it was shorter). */
export function lastToDate(pace: SpendPace): number | null {
	if (!pace.lastSeries) return null;
	return pace.lastSeries[Math.min(pace.period.day, pace.last.days) - 1] ?? 0;
}

function paceOnce(db: FigureDb, userId: string, pass?: FigurePass) {
	const load = async () =>
		loadSpendPace(db, userId, new Date(), await userTimeZone(userId));
	return pass ? pass.once(`glance:pace:${userId}`, load) : load();
}

const paceFigure = (
	id: string,
	pick: (pace: SpendPace) => number | null,
): FigureDefinition => ({
	id,
	scope: [],
	compute: async (db, scope, pass) => {
		const pace = await paceOnce(db, scope.userId, pass);
		const minor = pick(pace);
		return minor === null ? null : { minor, currency: pace.home };
	},
});

export const glanceFigures: FigureDefinition[] = [
	paceFigure(GLANCE_SPENT, (p) => p.thisTotal),
	paceFigure(GLANCE_SPENT_LAST_TO_DATE, lastToDate),
	paceFigure(GLANCE_SPENT_LAST, (p) => p.lastTotal),
];
