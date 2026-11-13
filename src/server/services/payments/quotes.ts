/**
 * Quotes for a payment: how many units of the payment currency one unit of
 * each other currency is worth, built from stored rates (fiat per USD,
 * crypto USD per coin, see ~/lib/money) with Decimal math.
 *
 * The reference rate type is the user's default per currency once M2 lands
 * (N73); until then it is the stored-rate preference (blue, then official),
 * the rule settle-all already used. A custom rate the user typed overrides
 * one currency. A currency with no rate gets no quote: the allocator leaves
 * it untouched and names it (a missing rate is never 1).
 */

import { USD } from "@retrospend/domain/money";
import { crossFractionDec } from "@retrospend/domain/money-dec";
import type { Decimal } from "@retrospend/domain/precise-decimal";
import { findExchangeRate } from "~/server/exchange-rates";
import { dec } from "~/server/services/envelope/units";
import type { Prisma } from "~prisma";
import { quote, quoteOf } from "./allocate";
import type { Quote } from "./types";

type RateDb = Pick<Prisma.TransactionClient, "exchangeRate">;

export interface QuoteRequest {
	/** The currency everything is valued in (the payment's, or home for Owed to you). */
	readonly into: string;
	readonly currencies: Iterable<string>;
	readonly date: Date;
	/** Rate type to prefer (blue, official, mep, card); null = the reference type. */
	readonly rateType?: string | null;
	/** A typed rate: `rate` units of `into` per 1 unit of `rateCurrency`. */
	readonly custom?: { readonly rate: string; readonly currency: string } | null;
}

/** A currency's stored rate (fiat per USD, crypto USD per coin) and its type. */
interface Leg {
	rate: Decimal;
	type: string;
}

async function legOf(
	db: RateDb,
	currency: string,
	date: Date,
	rateType: string | null | undefined,
): Promise<Leg | null> {
	if (currency === USD) return { rate: dec(1), type: "official" };
	const picked = await findExchangeRate(db, currency, date, rateType);
	if (!picked || !(picked.rate > 0)) return null;
	return { rate: dec(String(picked.rate)), type: picked.type };
}

/**
 * The type a cross rate is labeled with: the type actually picked for the leg
 * that is not Official, if any (a requested type a currency lacks falls back).
 */
const labelOf = (a: Leg, b: Leg) => (a.type !== "official" ? a.type : b.type);

export async function loadQuotes(
	db: RateDb,
	request: QuoteRequest,
): Promise<Map<string, Quote>> {
	const quotes = new Map<string, Quote>();
	const wanted = [...new Set(request.currencies)].filter(
		(c) => c !== request.into,
	);
	if (wanted.length === 0) return quotes;
	const into = await legOf(db, request.into, request.date, request.rateType);
	for (const currency of wanted) {
		if (request.custom && request.custom.currency === currency) {
			quotes.set(currency, quote(request.custom.rate, "custom"));
			continue;
		}
		const leg = await legOf(db, currency, request.date, request.rateType);
		if (!leg || !into) continue;
		// The quote keeps the cross rate as an undivided fraction: an amount
		// converts as amount x num / den, one division, so a tie stays a tie
		// (3 NOK at 9 per USD into JPY at 16.5 is 3 x 16.5 / 9 = 5.5, not
		// 3 x 1.8333...3 = 5.4999...9). perUnit, the quotient, is only the rate
		// that is stored or shown.
		quotes.set(
			currency,
			quoteOf(
				crossFractionDec(currency, leg.rate, request.into, into.rate),
				labelOf(into, leg),
			),
		);
	}
	return quotes;
}
