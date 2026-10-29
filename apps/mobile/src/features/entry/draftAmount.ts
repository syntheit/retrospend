import { parseMoneyInput } from "@retrospend/domain/parse";
import { parseRateText } from "@retrospend/domain/rate-text";

// What every composer draft shares: the exchange rate picked, the amount the
// keypad typed as minor units, and the request a draft becomes.

/**
 * The exchange rate picked for an amount in another currency. The server
 * books the home value from it; the composer only names the choice.
 */
export interface RateChoice {
	/** A type the pair offers (official, blue, MEP...); null is your default. */
	rateType: string | null;
	/** A typed rate instead of a type. */
	custom: boolean;
	/** The typed rate as shown: 1 unit of the currency in home units. */
	customText: string;
}

/** No choice yet: the server books your default type. A new currency starts here. */
export const DEFAULT_RATE: RateChoice = {
	rateType: null,
	custom: false,
	customText: "",
};

/** A write waiting for the outbox: the v1 collection and the request body. */
export interface PendingWrite {
	entity: "expenses" | "shared-expenses" | "income" | "transfers";
	/** An edit of a saved expense is sent at once, never queued. */
	kind?: "create" | "update";
	body: Record<string, unknown>;
	/** What the toast calls it: the title, or the source. */
	label: string;
}

/** The amount in minor units, or null until the keypad text reads as an amount. */
export function amountMinor(
	text: string,
	locale: string,
	currency: string,
): number | null {
	const read = parseMoneyInput(text, locale, currency);
	return read.ok ? read.minor : null;
}

/**
 * The rate part of a write: the typed rate, the picked type, or nothing (the
 * server books your default type). Null while a typed rate does not read as
 * a rate above zero: Save waits for one, and a missing rate is never 1.
 */
export function rateFields(
	d: RateChoice,
	locale: string,
):
	| { customRate: string }
	| { rateType: string }
	| Record<string, never>
	| null {
	if (d.custom) {
		const customRate = parseRateText(d.customText, locale);
		return customRate ? { customRate } : null;
	}
	return d.rateType ? { rateType: d.rateType } : {};
}
