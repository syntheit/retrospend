/**
 * The pure half of Home's spending glance (kit `pace()`, `monthSpend`): this
 * and the last fiscal period per day in the home currency, and the numbers
 * the glance.* figures read from it. The server loads the inputs with SQL
 * (server/services/figures/spend-pace.ts); a device loads rows from its own
 * store (spendPaceInputsFromRows). Both feed spendPaceFrom, and a pg test
 * holds the two loaders to each other digit for digit.
 *
 * Spending is the one definition (spent.ts) grouped per entry instant, and
 * the totals rule (money.ts sumIn) prices it: a foreign row without a home
 * rate makes a number unavailable and names the currency, never a guess.
 * Days are read in the zone the caller decides, the user's saved one for a
 * figure.
 */
import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "./fiscal-month";
import {
	cumulativeMinor,
	type DatedItem,
	dailyHome,
	type IsoDate,
	missingIn,
	type PeriodSpan,
	spanOf,
} from "./glance-pace";
import {
	type MoneyItem,
	missingRatesIn,
	periodRateDate,
	pickBestRate,
	type RateRow,
	sumIn,
	USD,
} from "./money";
import { toMinor } from "./money-minor";
import {
	countsAsIncome,
	groupSpentRows,
	type SpentExpenseRow,
	type SpentGroup,
	type SpentInputs,
	type SpentRange,
	type SpentShareRow,
	spentInputsFromRows,
	spentItemOf,
	spentItemsOf,
} from "./spent";
import { dayKey } from "./time-zone";

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
	/** Income this period in home minor units (Just track's "Money in vs spent"). Null: missing rate. */
	readonly moneyIn: number | null;
	readonly missingRates: string[];
}

/** What a loader hands the compute: spending over both periods, this period's income, and the home rate each period's totals use. */
export interface SpendPaceInputs {
	/** Spending and refunds grouped per entry instant, from the start of the last period to the end of this one. */
	spending: SpentInputs;
	/** Income groups of this period. */
	income: SpentGroup[];
	/** Units of the home currency per USD on each period's rate date (spendPaceRateDates); null: no rate at all. */
	thisRate: number | null;
	lastRate: number | null;
}

const rangeKeys = (range: SpentRange, timeZone: string) =>
	spanOf(dayKey(range.start, timeZone), dayKey(range.end, timeZone));

/** This and the last fiscal period as instants and as calendar days. */
export function spendPacePeriods(
	now: Date,
	startDay: number,
	timeZone: string,
) {
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

/** The dates whose home rate prices each period: its end, or now while it still runs. */
export function spendPaceRateDates(
	periods: { thisRange: SpentRange; lastRange: SpentRange },
	now: Date,
) {
	return {
		thisDate: periodRateDate(periods.thisRange.end, now),
		lastDate: periodRateDate(periods.lastRange.end, now),
	};
}

/** The home currency's rate on `date` from rows held in memory (the server fetches the same rows with SQL, exchange-rates.ts). */
export function homeRateOn(
	home: string,
	rows: readonly RateRow[],
	date: Date,
): number | null {
	return home === USD ? 1 : (pickBestRate(rows, { date })?.rate ?? null);
}

/** Income groups as items for the totals rule. */
export const incomeItemsOf = (groups: readonly SpentGroup[]): MoneyItem[] =>
	groups.map(spentItemOf(1));

/**
 * The inputs from rows held in memory: what a device loader returns.
 * `homeRates` are the home currency's rate rows (any dates, all types).
 */
export function spendPaceInputsFromRows(args: {
	expenses: readonly SpentExpenseRow[];
	shares: readonly SpentShareRow[];
	hiddenProjectIds: readonly string[];
	home: string;
	homeRates: readonly RateRow[];
	now: Date;
	startDay: number;
	timeZone: string;
	rateFor?: (s: SpentShareRow) => number | null;
}): SpendPaceInputs {
	const p = spendPacePeriods(args.now, args.startDay, args.timeZone);
	const dates = spendPaceRateDates(p, args.now);
	return {
		spending: spentInputsFromRows({
			expenses: args.expenses,
			shares: args.shares,
			hiddenProjectIds: args.hiddenProjectIds,
			range: { start: p.lastRange.start, end: p.thisRange.end },
			rateFor: args.rateFor,
			by: "day",
		}),
		income: groupSpentRows(
			args.expenses.filter((r) => countsAsIncome(r, p.thisRange)),
		),
		thisRate: homeRateOn(args.home, args.homeRates, dates.thisDate),
		lastRate: homeRateOn(args.home, args.homeRates, dates.lastDate),
	};
}

/**
 * Rows as dated items in a fixed order. The sums are floats, so the order
 * they are added in must not depend on how a loader happened to return them.
 */
function datedRows(inputs: SpentInputs, timeZone: string): DatedItem[] {
	const rows = spentItemsOf(inputs).flatMap((item) =>
		item.date ? [{ day: dayKey(item.date, timeZone), item }] : [],
	);
	const key = (r: DatedItem) =>
		[
			r.day,
			r.item.currency,
			r.item.booked?.currency ?? "",
			String(r.item.amount),
		].join("|");
	return rows
		.map((r) => ({ r, k: key(r) }))
		.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
		.map(({ r }) => r);
}

/** The glance's spending numbers at `now`, from a loader's inputs. */
export function spendPaceFrom(args: {
	home: string;
	startDay: number;
	now: Date;
	timeZone: string;
	inputs: SpendPaceInputs;
}): SpendPace {
	const { home, inputs } = args;
	const p = spendPacePeriods(args.now, args.startDay, args.timeZone);
	const rows = datedRows(inputs.spending, args.timeZone);
	const { thisRate, lastRate } = inputs;
	const thisDaily = dailyHome(rows, p.period, home, thisRate);
	const lastDaily = dailyHome(rows, p.last, home, lastRate);
	const income = incomeItemsOf(inputs.income);
	const incomeMissing = missingRatesIn(income, home, thisRate);
	const missing = new Set([
		...missingIn(rows, p.period, home, thisRate),
		...missingIn(rows, p.last, home, lastRate),
		...incomeMissing,
	]);
	const total = (daily: number[] | null) =>
		daily ? (cumulativeMinor(daily, daily.length, home).at(-1) ?? 0) : null;
	return {
		home,
		today: p.today,
		period: p.period,
		last: p.last,
		thisSeries: thisDaily && cumulativeMinor(thisDaily, p.period.day, home),
		lastSeries: lastDaily && cumulativeMinor(lastDaily, p.last.days, home),
		thisTotal: total(thisDaily),
		lastTotal: total(lastDaily),
		moneyIn: incomeMissing.length
			? null
			: toMinor(sumIn(income, home, thisRate), home),
		missingRates: [...missing].sort(),
	};
}

/** Last period's running total on this period's day (its last day when it was shorter). */
export function lastToDate(pace: SpendPace): number | null {
	if (!pace.lastSeries) return null;
	return pace.lastSeries[Math.min(pace.period.day, pace.last.days) - 1] ?? 0;
}
