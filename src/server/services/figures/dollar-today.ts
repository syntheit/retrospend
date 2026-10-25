/**
 * Dollar today (Home's glance row, mockup `D.rate('USD', type)`): the price
 * of USD 1 in the home currency, at the rate type the person set as their
 * default for that home currency (blue for ARS until they pick), as of
 * today. Read from the rate table through the same rate service as every
 * conversion; a home currency with no rates reads unavailable, never 1.
 *
 * Not for a USD home (the price is 1 by definition) nor a crypto home (its
 * rate is stored the other way round), so the row is left out there.
 */

import { isCrypto } from "@retrospend/domain/currency-format";
import { USD } from "@retrospend/domain/money";
import { type Money, toMinor } from "@retrospend/domain/money-minor";
import { dayKey } from "@retrospend/domain/time-zone";
import { findExchangeRate } from "~/server/exchange-rates";
import type { FigureDb, FigureDefinition } from "~/server/figures/registry";
import { FigureUnavailable } from "~/server/figures/unavailable";
import { loadRateContext } from "~/server/services/rate-types";
import { userTimeZone } from "~/server/services/user-time-zone";

export const DOLLAR_TODAY = "rate.dollarToday";

export interface DollarToday {
	readonly id: typeof DOLLAR_TODAY;
	/** USD 1 in the home currency; null while home has no rate at all. */
	readonly value: Money | null;
	/** The rate type used ("blue"); null with no value. The client names it. */
	readonly rateType: string | null;
	/** The day the rate is from (it may be older than today). */
	readonly rateDate: string | null;
	readonly home: string;
}

/** Null when the row does not apply (USD or crypto home). */
export async function dollarTodayIn(
	db: FigureDb,
	userId: string,
	now: Date,
	timeZone?: string,
): Promise<DollarToday | null> {
	const { homeCurrency, preferred } = await loadRateContext(db, userId);
	if (homeCurrency === USD || isCrypto(homeCurrency)) return null;
	const picked = await findExchangeRate(db, homeCurrency, now, preferred);
	const none = {
		id: DOLLAR_TODAY,
		value: null,
		rateType: null,
		rateDate: null,
		home: homeCurrency,
	} as const;
	if (!picked) return none;
	const zone = await userTimeZone(db, userId, timeZone);
	return {
		id: DOLLAR_TODAY,
		value: {
			minor: toMinor(picked.rate, homeCurrency),
			currency: homeCurrency,
		},
		rateType: picked.type,
		rateDate: dayKey(picked.date, zone),
		home: homeCurrency,
	};
}

export const dollarTodayFigure: FigureDefinition = {
	id: DOLLAR_TODAY,
	scope: [],
	compute: async (db, scope) => {
		const dollar = await dollarTodayIn(db, scope.userId, new Date());
		if (!dollar) return null;
		return dollar.value ?? new FigureUnavailable([dollar.home]);
	},
};
