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

import type { Decimal } from "@prisma/client/runtime/index-browser";
import { isCrypto } from "~/lib/currency-format";
import { USD } from "~/lib/money";
import { findExchangeRate } from "~/server/exchange-rates";
import { dec } from "~/server/services/envelope/units";
import type { Prisma } from "~prisma";
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

interface Leg {
	usdPerUnit: Decimal;
	type: string;
}

async function legOf(
	db: RateDb,
	currency: string,
	date: Date,
	rateType: string | null | undefined,
): Promise<Leg | null> {
	if (currency === USD) return { usdPerUnit: dec(1), type: "official" };
	const picked = await findExchangeRate(db, currency, date, rateType);
	if (!picked || !(picked.rate > 0)) return null;
	const stored = dec(String(picked.rate));
	return {
		usdPerUnit: isCrypto(currency) ? stored : dec(1).div(stored),
		type: picked.type,
	};
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
			quotes.set(currency, {
				perUnit: dec(request.custom.rate),
				rateType: "custom",
			});
			continue;
		}
		const leg = await legOf(db, currency, request.date, request.rateType);
		if (!leg || !into) continue;
		quotes.set(currency, {
			perUnit: leg.usdPerUnit.div(into.usdPerUnit),
			rateType: labelOf(into, leg),
		});
	}
	return quotes;
}
