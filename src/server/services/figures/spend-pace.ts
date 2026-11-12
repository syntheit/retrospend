/**
 * The spending half of Home's glance (kit `pace()`, `monthSpend`): this and
 * the last fiscal period per day in the home currency, and the figures
 * registered from it (src/server/figures/registry.ts):
 * - glance.spent: this period's spending, the whole period (kit monthSpend).
 * - glance.spentLastToDate: last period up to the same day (the pace line).
 * - glance.spentLast: last period's total.
 * - glance.moneyIn: income this period (Just track's "Money in vs spent", SPEC §6.11).
 *
 * This file is the server loader: it reads the rows with SQL and hands them to
 * the pure compute in @retrospend/domain/spend-pace, which a device runs over
 * its own rows. Spending follows the one definition (spent.ts) and the totals
 * rule; a foreign row without a home rate makes a figure unavailable and names
 * the currency, never a guess (R14). Figures read days in the zone the server
 * decides for the user (userTimeZone), as glance() does without a request zone.
 */
import type { MoneyItemDec } from "@retrospend/domain/money-dec";
import type { Money } from "@retrospend/domain/money-minor";
import {
	incomeItemsOf,
	lastToDate,
	type SpendPace,
	type SpendPaceInputs,
	spendPaceFrom,
	spendPacePeriods,
	spendPaceRateDates,
} from "@retrospend/domain/spend-pace";
import type { SpentGroup } from "@retrospend/domain/spent";
import { findExchangeRate } from "~/server/exchange-rates";
import type {
	FigureDb,
	FigureDefinition,
	FigurePass,
} from "~/server/figures/registry";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { userTimeZone } from "~/server/services/user-time-zone";
import { loadSpentInputs } from "./spent";

export const GLANCE_SPENT = "glance.spent";
export const GLANCE_SPENT_LAST_TO_DATE = "glance.spentLastToDate";
export const GLANCE_SPENT_LAST = "glance.spentLast";
export const GLANCE_MONEY_IN = "glance.moneyIn";

export { lastToDate, type SpendPace };

/** A number as Home shows it, tagged with its figure id for the display audit. */
export interface GlanceFigure {
	readonly id: string;
	/** Null when unavailable (a missing rate); never 0 in its place. */
	readonly value: Money | null;
}

/** Income groups of a range, read with SQL (the device groups its rows with countsAsIncome). */
async function incomeGroups(
	db: FigureDb,
	userId: string,
	range: { start: Date; end: Date },
): Promise<SpentGroup[]> {
	const rows = await db.expense.groupBy({
		by: ["currency", "homeCurrency"],
		where: {
			userId,
			status: "FINALIZED",
			direction: "IN",
			entryKind: "STANDARD",
			inType: "INCOME",
			excludeFromAnalytics: false,
			date: { gte: range.start, lte: range.end },
		},
		_sum: { amount: true, amountInUSD: true, homeAmount: true },
		_count: { _all: true },
	});
	return rows.map((r) => ({
		currency: r.currency,
		homeCurrency: r.homeCurrency,
		categoryId: null,
		date: null,
		amount: r._sum.amount ?? 0,
		amountInUSD: r._sum.amountInUSD ?? 0,
		homeAmount: r._sum.homeAmount ?? 0,
		count: r._count._all,
	}));
}

/**
 * Income in a range as items for the totals rule: money in typed as
 * income, kept in Wealth or not, outside Hide from reports. Refunds are
 * spending's (they net there); own transfers and adjustments are nothing.
 */
export async function incomeItems(
	db: FigureDb,
	userId: string,
	range: { start: Date; end: Date },
): Promise<MoneyItemDec[]> {
	return incomeItemsOf(await incomeGroups(db, userId, range));
}

/** The server loader of the pace: SQL groups per entry instant, this period's income, and the home rate on each period's rate date. */
export async function loadSpendPaceInputs(
	db: FigureDb,
	userId: string,
	now: Date,
	home: string,
	startDay: number,
	timeZone: string,
): Promise<SpendPaceInputs> {
	const p = spendPacePeriods(now, startDay, timeZone);
	const dates = spendPaceRateDates(p, now);
	const rateOn = async (date: Date) =>
		(await findExchangeRate(db, home, date))?.rate ?? null;
	return {
		spending: await loadSpentInputs(
			db,
			{ userId, date: { gte: p.lastRange.start, lte: p.thisRange.end } },
			"day",
		),
		income: await incomeGroups(db, userId, p.thisRange),
		thisRate: await rateOn(dates.thisDate),
		lastRate: await rateOn(dates.lastDate),
	};
}

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
	const startDay = user?.fiscalMonthStartDay ?? 1;
	return spendPaceFrom({
		home,
		startDay,
		now,
		timeZone,
		inputs: await loadSpendPaceInputs(
			db,
			userId,
			now,
			home,
			startDay,
			timeZone,
		),
	});
}

function paceOnce(db: FigureDb, userId: string, pass?: FigurePass) {
	const load = async () =>
		loadSpendPace(db, userId, new Date(), await userTimeZone(db, userId));
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
		if (minor === null) return new FigureUnavailable(pace.missingRates);
		return { minor, currency: pace.home };
	},
});

export const glanceFigures: FigureDefinition[] = [
	paceFigure(GLANCE_SPENT, (p) => p.thisTotal),
	paceFigure(GLANCE_SPENT_LAST_TO_DATE, lastToDate),
	paceFigure(GLANCE_SPENT_LAST, (p) => p.lastTotal),
	paceFigure(GLANCE_MONEY_IN, (p) => p.moneyIn),
];
