import type { RatePrice } from "./types";

/**
 * How a price shows: whole units from 100 up (ARS 1,555), the currency's
 * digits below (BRL 5.35, KWD 0.307), and every digit the server sent for a
 * rate under one minor unit (USD 0.00064, BTC 0.00001493). A comparison
 * only: the formatter rounds.
 */
export function priceCents(price: RatePrice): false | "auto" {
	const hundred = 100 * 10 ** price.places;
	return Math.abs(price.minor) >= hundred ? false : "auto";
}
