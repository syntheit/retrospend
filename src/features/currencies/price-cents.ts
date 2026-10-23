import { currencyDecimals } from "@retrospend/domain/money";
import type { MoneyValue } from "~/components/money/format";

/**
 * How a price shows: whole units from 100 up (ARS 1,468), cents below
 * (ARS 35.20), as the mockup reads. A comparison only: the formatter rounds.
 */
export function priceCents(price: MoneyValue): false | "auto" {
	const hundred = 100 * 10 ** currencyDecimals(price.currency);
	return Math.abs(price.minor) >= hundred ? false : "auto";
}
